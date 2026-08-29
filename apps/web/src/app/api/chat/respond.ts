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
  type ToolSet,
} from "ai";
import { revalidateTag } from "next/cache";
import {
  MAX_SOURCE_NOTES,
  REQUEST_DEADLINE_MS,
  SYNTHESIS_MAX_OUTPUT_TOKENS,
} from "@/features/assistant/constants";
import {
  chatInstructions,
  chatPrompt,
} from "@/features/assistant/lib/chat-prompt";
import {
  brandOptions,
  type KnowledgeExcerpt,
  selectKnowledge,
} from "@/features/assistant/lib/retrieval";
import {
  brandName,
  readRunContext,
} from "@/features/assistant/lib/run-context";
import type { AssistantUIMessage } from "@/features/assistant/schemas/assistant-message";
import type {
  AssistantActiveCard,
  AssistantChatRequest,
} from "@/features/assistant/schemas/chat-request";
import {
  type AssistantAskUser,
  type AssistantCitation,
  assistantAskUserSchema,
} from "@/features/assistant/schemas/ui-message";
import {
  customerEditorial,
  customerReviewedKnowledge,
  customerTemplate,
  customerTemplateFingerprint,
} from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";
import { ASK_USER_TOOL, askUserTool } from "./clarify-tool";
import {
  closeSynthesisOperation,
  openSynthesisOperation,
} from "./synthesis-operation";

const SHORT_FINGERPRINT = customerTemplateFingerprint.slice(0, 16);

export async function respondToAssistantTurn(
  request: AssistantChatRequest,
  userId: string,
  abortSignal: AbortSignal,
) {
  const question = request.message.parts[0]?.text ?? "";
  const executor = rpcDb();
  const workspaceId = await resolveInstallationWorkspaceId(executor);
  // Quote only a live draft from this operator's origin run with matching
  // platform, brand, and content locale; the browser-supplied ID is untrusted.
  const card = request.card
    ? await authorizedCard(executor, workspaceId, userId, request)
    : null;
  const run = await readRunContext(
    executor,
    workspaceId,
    userId,
    request.runId,
  );
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
      writer.write({ type: "start" });

      const answer = await streamAnswer(writer, {
        abortSignal,
        executor,
        instructions: chatInstructions({
          brandChoice: knowledge.brandChoice !== null,
          clarifyTool: clarifiable,
          locale: request.locale,
        }),
        prompt: chatPrompt({
          brandNames: request.brandKeys.map(brandName),
          card: card?.card ?? null,
          knowledge,
          question,
          run,
        }),
        tools: clarifiable
          ? { [ASK_USER_TOOL]: askUserTool(options.map(choiceOf)) }
          : undefined,
        userId,
        workspaceId,
      });

      if (answer.answered) {
        for (const note of sourceNotes(knowledge)) {
          writer.write({ type: "data-citation", data: note });
        }
      }

      const chooser = knowledge.brandChoice
        ? {
            input: { choices: knowledge.brandChoice.map(choiceOf) },
            toolCallId: randomUUID(),
          }
        : answer.ask;

      if (chooser) {
        writer.write({
          type: "tool-input-available",
          toolCallId: chooser.toolCallId,
          toolName: ASK_USER_TOOL,
          input: chooser.input,
        });
      }

      writer.write({
        type: "finish",
        messageMetadata: { createdAt: Date.now() },
      });
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
  matches: readonly KnowledgeExcerpt[];
}) {
  const notes = new Map<string, AssistantCitation>();

  for (const excerpt of [...knowledge.matches, ...knowledge.bibles]) {
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
    abortSignal: AbortSignal;
    executor: Executor;
    instructions: string;
    prompt: string;
    tools: ToolSet | undefined;
    userId: string;
    workspaceId: string;
  },
): Promise<{
  answered: boolean;
  ask: { input: AssistantAskUser; toolCallId: string } | null;
}> {
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

  const textId = randomUUID();
  let succeeded = false;

  try {
    const synthesis = await gateway.streamSynthesis({
      abortSignal,
      deadlineMs: REQUEST_DEADLINE_MS,
      instructions: context.instructions,
      invocationKey: "primary",
      maxOutputTokens: SYNTHESIS_MAX_OUTPUT_TOKENS,
      operationAttemptId: operation.attemptId,
      operationId: operation.operationId,
      prompt: context.prompt,
      stopWhen: isStepCount(1),
      taskKey: "assistant-synthesis",
      tools: context.tools,
      workspaceId,
    });

    // A turn that only calls the tool streams no text; the transcript answers
    // that with its own line rather than an empty bubble.
    let started = false;

    for await (const delta of synthesis.textStream) {
      if (!started) {
        writer.write({ type: "text-start", id: textId });
        started = true;
      }

      writer.write({ type: "text-delta", delta, id: textId });
    }

    if (started) {
      writer.write({ type: "text-end", id: textId });
    }

    succeeded = true;

    // The model may call the tool but never owns its output: the choices come
    // from the workspace and are re-parsed before they reach the transcript.
    for (const call of synthesis.toolCalls()) {
      const output = assistantAskUserSchema.safeParse(call.output);

      if (call.toolName === ASK_USER_TOOL && output.success) {
        return {
          answered: started,
          ask: { input: output.data, toolCallId: call.toolCallId },
        };
      }
    }

    return { answered: started, ask: null };
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
    }
  }
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
    origin.contentLocale === claimed.contentLocale &&
    (request.brandKeys.length === 0 ||
      request.brandKeys.includes(origin.brandKey))
    ? { brandKey: origin.brandKey, card: claimed }
    : null;
}
