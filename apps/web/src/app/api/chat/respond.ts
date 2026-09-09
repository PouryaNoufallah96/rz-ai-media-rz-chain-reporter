import "server-only";

import { randomUUID } from "node:crypto";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { matchesAppliedCustomerTemplate } from "@rz-chain-reporter/db/repositories/customer-template-identity";
import { readLiveDraftOrigin } from "@rz-chain-reporter/db/repositories/draft-origin";
import { env } from "@rz-chain-reporter/env/server";
import { createModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import * as Sentry from "@sentry/nextjs";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
} from "ai";
import { revalidateTag } from "next/cache";
import {
  MAX_SOURCE_NOTES,
  REQUEST_DEADLINE_MS,
  SYNTHESIS_MAX_OUTPUT_TOKENS,
} from "@/features/assistant/constants";
import {
  type AssistantMarketPromptContext,
  chatInstructions,
  chatPrompt,
} from "@/features/assistant/lib/chat-prompt";
import { assistantReadContext } from "@/features/assistant/lib/read-context.server";
import {
  brandOptions,
  type KnowledgeExcerpt,
  selectKnowledge,
} from "@/features/assistant/lib/retrieval";
import {
  brandName,
  readRunContext,
} from "@/features/assistant/lib/run-context";
import {
  ASK_USER_TOOL,
  askUserTool,
  assistantToolRegistry,
} from "@/features/assistant/lib/tool-registry.server";
import {
  ASSISTANT_READ_TOOL_NAMES,
  assistantReadTools,
} from "@/features/assistant/lib/tools/read-tools.server";
import { MARKET_ACTION_TOOL } from "@/features/assistant/schemas/approval";
import type {
  AssistantActiveCard,
  AssistantChatRequest,
} from "@/features/assistant/schemas/chat-request";
import {
  type AssistantCitation,
  type AssistantUIMessage,
  isAssistantNativeToolError,
} from "@/features/assistant/schemas/ui-message";
import { getMarketAnalysisCatalog } from "@/features/market-analysis/api/server/get-catalog";
import { getMarketAnalysisOptions } from "@/features/market-analysis/api/server/get-options";
import { marketTemplate } from "@/features/market-analysis/lib/template";
import {
  customerEditorial,
  customerReviewedKnowledge,
  customerTemplate,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import {
  closeSynthesisOperation,
  openSynthesisOperation,
} from "./synthesis-operation";

const SHORT_FINGERPRINT = customerTemplateFingerprint.slice(0, 16);

export async function respondToAssistantTurn(
  request: AssistantChatRequest,
  userId: string,
  workspaceId: string,
  abortSignal: AbortSignal,
) {
  const question = request.message.parts[0]?.text ?? "";
  const executor = rpcDb();
  // Quote only a live draft from this operator's origin run with matching
  // platform and brand; the browser-supplied ID is untrusted.
  const [card, run, market] = await Promise.all([
    request.card
      ? authorizedCard(executor, workspaceId, userId, request)
      : Promise.resolve(null),
    readRunContext(request.runId, request.locale),
    readMarketPromptContext(),
  ]);
  const readContext = assistantReadContext(request.locale);
  const knowledge = selectKnowledge({
    brandKeys: request.brandKeys,
    brands: customerEditorial.brands,
    cardBrandKey: card?.brandKey ?? null,
    knowledge: customerReviewedKnowledge,
    locale: request.locale,
    question,
  });

  const options = brandOptions(customerEditorial.brands, request.brandKeys);
  const clarifiable = knowledge.brandChoice === null && options.length > 1;

  const stream = createUIMessageStream<AssistantUIMessage>({
    onError: (error) => {
      Sentry.captureException(error);
      return "ASSISTANT_UNAVAILABLE";
    },
    execute: async ({ writer }) => {
      const answered = await streamAnswer(writer, {
        abortSignal,
        executor,
        instructions: chatInstructions({
          brandChoice: knowledge.brandChoice !== null,
          clarifyTool: clarifiable,
          locale: request.locale,
          pendingMarket: request.pendingMarket !== null,
          pendingRun: request.pendingRun !== null,
        }),
        locale: request.locale,
        prompt: chatPrompt({
          brandChoices: request.brandKeys.map((key) => ({
            key,
            name: brandName(key),
          })),
          card: card?.card ?? null,
          context: request.context,
          knowledge,
          modelChoices: customerEditorial.models,
          market,
          marketAnalysisId: request.marketAnalysisId,
          pendingMarket: request.pendingMarket,
          pendingRun: request.pendingRun,
          platforms: customerEditorial.platforms,
          promoBrandChoices: customerEditorial.brands.filter(
            (brand) => brand.promoEnabled,
          ),
          question,
          readContext,
          run,
        }),
        askUser: clarifiable ? askUserTool(options.map(choiceOf)) : undefined,
        currentDraftId: card?.card.draftId ?? null,
        currentMarketAnalysisId: request.marketAnalysisId,
        currentRunId: run?.id ?? null,
        userId,
        workspaceId,
      });

      if (answered) {
        for (const note of sourceNotes(knowledge)) {
          writer.write({ type: "data-citation", data: note });
        }
      }

      const chooser = knowledge.brandChoice
        ? {
            input: { choices: knowledge.brandChoice.map(choiceOf) },
            toolCallId: randomUUID(),
          }
        : null;

      if (chooser) {
        writer.write({
          type: "tool-input-available",
          toolCallId: chooser.toolCallId,
          toolName: ASK_USER_TOOL,
          input: {},
        });
        writer.write({
          type: "tool-output-available",
          toolCallId: chooser.toolCallId,
          output: chooser.input,
        });
      }
    },
  });

  return createUIMessageStreamResponse({
    stream,
    headers: { "cache-control": "private, no-store" },
  });
}

type Writer = Parameters<
  NonNullable<
    Parameters<typeof createUIMessageStream<AssistantUIMessage>>[0]
  >["execute"]
>[0]["writer"];

function choiceOf(brand: { key: string; name: string }) {
  return { id: brand.key, label: brand.name };
}

function sourceNotes(knowledge: {
  bibles: readonly KnowledgeExcerpt[];
  faqSource: KnowledgeExcerpt | null;
  matches: readonly KnowledgeExcerpt[];
  overview: readonly KnowledgeExcerpt[];
}) {
  const notes = new Map<string, AssistantCitation>();

  for (const excerpt of [
    ...(knowledge.faqSource ? [knowledge.faqSource] : []),
    ...knowledge.overview,
    ...knowledge.matches,
    ...knowledge.bibles,
  ]) {
    const sourceId = excerpt.sha256.slice(0, 16);

    if (!notes.has(sourceId)) {
      notes.set(sourceId, {
        sourceId,
        title: excerpt.title,
        locale: excerpt.locale,
        templateFingerprint: SHORT_FINGERPRINT,
      });
    }
  }

  return [...notes.values()].slice(0, MAX_SOURCE_NOTES);
}

async function streamAnswer(
  writer: Writer,
  context: {
    askUser?: ReturnType<typeof askUserTool>;
    abortSignal: AbortSignal;
    executor: Executor;
    instructions: string;
    locale: AssistantChatRequest["locale"];
    prompt: string;
    currentDraftId: string | null;
    currentMarketAnalysisId: string | null;
    currentRunId: string | null;
    userId: string;
    workspaceId: string;
  },
): Promise<boolean> {
  const { abortSignal, executor, workspaceId } = context;
  const operation = await openSynthesisOperation(
    executor,
    workspaceId,
    context.userId,
  );

  const gateway = createModelGateway({
    assertTemplateCurrent: async (candidateWorkspaceId) => {
      const current = await matchesAppliedCustomerTemplate(
        executor,
        candidateWorkspaceId,
        customerTemplateFingerprint,
      );

      if (!current) {
        throw new Error("template drift");
      }
    },
    bindings: { OPENROUTER_API_KEY: env.OPENROUTER_API_KEY },
    executor,
    logger: { warn: () => undefined },
    template: customerTemplate,
  });

  let succeeded = false;

  try {
    const tools = {
      ...assistantToolRegistry({
        askUser: context.askUser,
        marketEnabled: marketTemplate.enabled,
      }),
      ...assistantReadTools({
        currentDraftId: context.currentDraftId,
        currentMarketAnalysisId: context.currentMarketAnalysisId,
        currentRunId: context.currentRunId,
        locale: context.locale,
      }),
    };
    const activeTools = context.askUser
      ? ([
          "start_run",
          ...(marketTemplate.enabled ? [MARKET_ACTION_TOOL] : []),
          ASK_USER_TOOL,
          ...ASSISTANT_READ_TOOL_NAMES,
        ] as const)
      : ([
          "start_run",
          ...(marketTemplate.enabled ? [MARKET_ACTION_TOOL] : []),
          ...ASSISTANT_READ_TOOL_NAMES,
        ] as const);
    const synthesis = await gateway.streamSynthesis<
      typeof tools,
      AssistantUIMessage
    >({
      activeTools,
      bindAgentTools: (settings) => ({ ...settings, tools }),
      abortSignal,
      deadlineMs: REQUEST_DEADLINE_MS,
      instructions: context.instructions,
      invocationKey: "primary",
      maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
      operationAttemptId: operation.attemptId,
      operationId: operation.operationId,
      prepareStep: ({ stepNumber }) => ({
        activeTools: stepNumber === 0 ? activeTools : [],
      }),
      prompt: context.prompt,
      stopWhen: isStepCount(3),
      taskKey: "assistant-synthesis",
      toolApproval: {
        start_run: "user-approval",
        ...(marketTemplate.enabled
          ? { market_action: "user-approval" as const }
          : {}),
      },
      toolApprovalSecret: env.ASSISTANT_APPROVAL_SECRET,
      workspaceId,
    });
    const reader = synthesis.uiStream.getReader();
    let answered = false;
    let nativeToolFailed = false;
    let responseErrorWritten = false;
    let streamFailed = false;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      if (isAssistantNativeToolError(chunk.value)) {
        nativeToolFailed = true;
        streamFailed = true;
        if (!responseErrorWritten) {
          writer.write({ type: "data-response-error", data: true });
          responseErrorWritten = true;
        }
        continue;
      }
      if (chunk.value.type === "error") streamFailed = true;
      if (
        nativeToolFailed &&
        (chunk.value.type.startsWith("text-") ||
          chunk.value.type.startsWith("reasoning-") ||
          chunk.value.type.startsWith("source-") ||
          chunk.value.type === "file" ||
          chunk.value.type === "error")
      ) {
        continue;
      }
      if (chunk.value.type === "text-delta") answered = true;
      writer.write(chunk.value);
    }
    succeeded = !streamFailed;
    return answered && succeeded;
  } finally {
    try {
      await closeSynthesisOperation(
        executor,
        workspaceId,
        operation,
        succeeded,
      );
    } finally {
      // `updateTag` throws outside a Server Action, so this Route Handler drops
      // the workspace Usage tag the way the internal Lane 2 handler does.
      revalidateTag(workspaceCacheTag(workspaceId, "usage"), { expire: 0 });
      writer.write({
        type: "data-usage-settled",
        data: true,
        transient: true,
      });
    }
  }
}

async function readMarketPromptContext(): Promise<AssistantMarketPromptContext> {
  if (!marketTemplate.enabled) {
    return { enabled: false, options: null };
  }
  const [options, catalog] = await Promise.all([
    getMarketAnalysisOptions(),
    getMarketAnalysisCatalog(),
  ]);
  return {
    enabled: true,
    options: {
      instruments: options.instruments.map(({ id, key, name, symbol }) => ({
        id,
        key,
        name,
        symbol,
      })),
      periods: options.enabledPeriods,
      scales: options.enabledScales,
      formats: ["portrait", "square", "story", "landscape"],
      imageModels: options.imageOptions.map(({ key, name }) => ({ key, name })),
      copyModels: options.copyModels.map(({ key, name }) => ({ key, name })),
      comparisons: catalog.entries.map(
        ({ canonicalIdentity, displayName, symbol }) => ({
          canonicalIdentity,
          displayName,
          symbol,
        }),
      ),
    },
  };
}

async function authorizedCard(
  executor: Executor,
  workspaceId: string,
  userId: string,
  request: AssistantChatRequest,
): Promise<{ brandKey: string; card: AssistantActiveCard } | null> {
  const claimed = request.card;

  if (!claimed) {
    return null;
  }

  const origin = await readLiveDraftOrigin(
    executor,
    workspaceId,
    userId,
    claimed.draftId,
  );

  return origin &&
    origin.platform === claimed.platform &&
    (request.brandKeys.length === 0 ||
      request.brandKeys.includes(origin.brandKey))
    ? { brandKey: origin.brandKey, card: claimed }
    : null;
}
