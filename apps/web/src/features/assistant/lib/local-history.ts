import { runCardOriginReferenceSchema } from "@rz-chain-reporter/contracts";
import { z } from "zod";

import {
  HISTORY_SCHEMA_VERSION,
  HISTORY_TTL_MS,
  MAX_QUESTION_CHARS,
} from "../constants";
import {
  type AssistantPendingMarket,
  type AssistantPendingRun,
  assistantMarketResultSchema,
  assistantMarketToolInputSchema,
  assistantPendingMarketSchema,
  assistantPendingRunSchema,
  assistantRunToolInputSchema,
  signedApprovalEnvelopeSchema,
  signedMarketApprovalEnvelopeSchema,
} from "../schemas/approval";
import {
  type AssistantConversationContext,
  type AssistantReadResult,
  assistantReadResultSchema,
  assistantReadToolInputSchema,
  MAX_ASSISTANT_CONTEXT_BYTES,
  MAX_ASSISTANT_CONTEXT_TURNS,
  MAX_ASSISTANT_READ_REFERENTS,
} from "../schemas/assistant-message";
import {
  type AssistantUIMessage,
  assistantAskUserSchema,
  assistantCitationSchema,
  assistantMessageMetadataSchema,
  assistantSupersededSchema,
} from "../schemas/ui-message";

const MAX_PARTS = 24;
const MAX_MESSAGES = 40;
const MARKET_ACTION_WITHOUT_RECORDED_RESULT =
  "No result for the prior Market action is recorded in this conversation.";

// Stored history is a projection: unknown SDK fields are stripped, while an
// unknown part or message is dropped instead of failing the whole envelope.
const partSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().max(20_000),
    state: z.enum(["streaming", "done"]).optional(),
  }),
  z.object({
    type: z.literal("data-citation"),
    id: z.string().optional(),
    data: assistantCitationSchema,
  }),
  z.object({
    type: z.literal("data-response-error"),
    id: z.string().optional(),
    data: z.literal(true),
  }),
  z.object({
    type: z.literal("tool-ask_user"),
    toolCallId: z.string().max(128),
    state: z.literal("output-available"),
    input: z.strictObject({}),
    output: assistantAskUserSchema,
  }),
  z.object({
    type: z.literal("tool-start_run"),
    toolCallId: z.string().max(128),
    state: z.literal("approval-requested"),
    input: assistantRunToolInputSchema,
    approval: z.object({
      id: z.string().max(128),
      signature: z.string().max(512),
      requestReason: z.string().max(256).optional(),
    }),
  }),
  z.object({
    type: z.literal("tool-market_action"),
    toolCallId: z.string().max(128),
    state: z.literal("approval-requested"),
    input: assistantMarketToolInputSchema,
    approval: z.object({
      id: z.string().max(128),
      signature: z.string().max(512),
      requestReason: z.string().max(256).optional(),
    }),
  }),
  z.object({
    type: z.literal("tool-read_workspace"),
    toolCallId: z.string().max(128),
    state: z.literal("output-available"),
    input: assistantReadToolInputSchema,
    output: assistantReadResultSchema,
  }),
  z.object({
    type: z.literal("data-run-proposal"),
    id: z.string().optional(),
    data: z.strictObject({
      envelope: signedApprovalEnvelopeSchema,
      toolCallId: z.string().max(128),
    }),
  }),
  z.object({
    type: z.literal("data-run-intent"),
    id: z.string().optional(),
    data: assistantPendingRunSchema.extend({
      toolCallId: z.string().max(128),
    }),
  }),
  z.object({
    type: z.literal("data-run-result"),
    id: z.string().optional(),
    data: z
      .strictObject({
        status: z.enum(["created", "replayed"]),
        analysisRunId: z.uuid(),
        operationId: z.uuid(),
        href: z.string().startsWith("/").optional(),
        toolCallId: z.string().max(128),
      })
      .transform((data) => ({
        ...data,
        href:
          data.href ??
          `/dashboard?run=${encodeURIComponent(data.analysisRunId)}`,
      })),
  }),
  z.object({
    type: z.literal("data-run-superseded"),
    id: z.string().optional(),
    data: assistantSupersededSchema,
  }),
  z.object({
    type: z.literal("data-market-intent"),
    id: z.string().optional(),
    data: assistantPendingMarketSchema.extend({
      toolCallId: z.string().max(128),
    }),
  }),
  z.object({
    type: z.literal("data-market-proposal"),
    id: z.string().optional(),
    data: z.strictObject({
      envelope: signedMarketApprovalEnvelopeSchema,
      toolCallId: z.string().max(128),
    }),
  }),
  z.object({
    type: z.literal("data-market-result"),
    id: z.string().optional(),
    data: assistantMarketResultSchema.extend({
      toolCallId: z.string().max(128),
    }),
  }),
  z.object({
    type: z.literal("data-market-superseded"),
    id: z.string().optional(),
    data: assistantSupersededSchema,
  }),
]);

function owned<Value>(schema: z.ZodType<Value>, values: readonly unknown[]) {
  return values.flatMap((value) => {
    const parsed = schema.safeParse(value);

    return parsed.success ? [parsed.data] : [];
  });
}

const messageSchema = z
  .object({
    id: z.string().max(128),
    role: z.enum(["user", "assistant"]),
    metadata: assistantMessageMetadataSchema.optional(),
    parts: z
      .array(z.unknown())
      .transform((parts) => owned(partSchema, parts).slice(0, MAX_PARTS)),
  })
  .transform((message) =>
    message.role === "assistant" &&
    message.parts.some(
      (part) => part.type === "data-response-error" && part.data,
    )
      ? {
          ...message,
          parts: message.parts.filter((part) => part.type !== "text"),
        }
      : message,
  );

const envelopeSchema = z.object({
  schemaVersion: z.literal(HISTORY_SCHEMA_VERSION),
  expiresAt: z.number().int().positive(),
  messages: z
    .array(z.unknown())
    .transform((messages) =>
      owned(messageSchema, messages).slice(-MAX_MESSAGES),
    ),
});

export function historyKey(workspaceId: string, operatorId: string) {
  return `chainreporter.assistant.${workspaceId}.${operatorId}`;
}

function noop() {
  return;
}

export function subscribeToStoredHistory() {
  return noop;
}

export function readHistory(key: string): AssistantUIMessage[] {
  const raw = globalThis.localStorage?.getItem(key);

  if (!raw) {
    return [];
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const envelope = envelopeSchema.safeParse(parsed);

  if (!envelope.success) {
    return [];
  }

  if (envelope.data.expiresAt <= Date.now()) {
    return [];
  }

  return envelope.data.messages;
}

export function expiresAt(key: string) {
  const raw = globalThis.localStorage?.getItem(key);

  if (!raw) {
    return null;
  }

  try {
    const envelope = envelopeSchema.safeParse(JSON.parse(raw));
    return envelope.success ? envelope.data.expiresAt : null;
  } catch {
    return null;
  }
}

export function saveHistory(
  key: string,
  messages: readonly AssistantUIMessage[],
) {
  const envelope = envelopeSchema.safeParse({
    schemaVersion: HISTORY_SCHEMA_VERSION,
    expiresAt: Date.now() + HISTORY_TTL_MS,
    messages,
  });

  // A write the projection cannot represent leaves the stored turns untouched;
  // only expiry and the operator's Clear ever remove them.
  if (
    !envelope.success ||
    (messages.length > 0 && envelope.data.messages.length === 0)
  ) {
    return;
  }

  globalThis.localStorage?.setItem(key, JSON.stringify(envelope.data));
}

export function clearHistory(key: string) {
  globalThis.localStorage?.removeItem(key);
}

export function latestPendingRun(messages: readonly AssistantUIMessage[]) {
  let pending: AssistantPendingRun | null = null;
  let toolCallId: string | null = null;

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-run-intent") {
        pending = { intent: part.data.intent, question: part.data.question };
        toolCallId = part.data.toolCallId;
      } else if (
        (part.type === "data-run-result" ||
          (part.type === "data-run-superseded" &&
            part.data.reason !== "edit")) &&
        part.data.toolCallId === toolCallId
      ) {
        pending = null;
        toolCallId = null;
      }
    }
  }

  return pending;
}

export function latestPendingMarket(messages: readonly AssistantUIMessage[]) {
  let pending: AssistantPendingMarket | null = null;
  let toolCallId: string | null = null;

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-market-intent") {
        pending = {
          intent: part.data.intent,
          question: part.data.question,
          values: part.data.values,
        };
        toolCallId = part.data.toolCallId;
      } else if (
        (part.type === "data-market-result" ||
          (part.type === "data-market-superseded" &&
            part.data.reason !== "edit")) &&
        part.data.toolCallId === toolCallId
      ) {
        pending = null;
        toolCallId = null;
      }
    }
  }

  return pending;
}

export function projectAssistantContext(
  messages: readonly AssistantUIMessage[],
): AssistantConversationContext {
  const latestUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  );
  const priorMessages = messages.slice(
    0,
    latestUserIndex === -1 ? messages.length : latestUserIndex,
  );
  const marketResultToolCallIds = new Set(
    priorMessages.flatMap((message) =>
      message.parts.flatMap((part) =>
        part.type === "data-market-result" ? [part.data.toolCallId] : [],
      ),
    ),
  );
  const turns = priorMessages
    .flatMap((message) => {
      if (message.role !== "user" && message.role !== "assistant") return [];
      if (message.role === "assistant") {
        const missingResultCount = message.parts.filter(
          (part) =>
            part.type === "tool-market_action" &&
            part.state === "approval-requested" &&
            !marketResultToolCallIds.has(part.toolCallId),
        ).length;

        if (missingResultCount > 0) {
          return Array.from({ length: missingResultCount }, () => ({
            role: "assistant" as const,
            text: MARKET_ACTION_WITHOUT_RECORDED_RESULT,
          }));
        }
      }
      const text = message.parts
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
        .trim();

      return text
        ? [
            {
              role: message.role,
              text: text.slice(0, MAX_QUESTION_CHARS),
            },
          ]
        : [];
    })
    .slice(-MAX_ASSISTANT_CONTEXT_TURNS);
  const referentsByIdentity = new Map<
    string,
    AssistantConversationContext["referents"][number]
  >();

  for (const message of priorMessages) {
    for (const part of message.parts) {
      if (
        part.type !== "tool-read_workspace" ||
        part.state !== "output-available"
      ) {
        continue;
      }

      const root = rootReadReferent(part.output);
      const itemReferents: AssistantConversationContext["referents"] =
        part.output.items.flatMap((item) => {
          const itemKind = item.facts.find(
            (fact) => fact.key === "kind",
          )?.value;
          const origin =
            part.output.kind === "run"
              ? runCardOriginReferenceSchema.safeParse(
                  itemKind === "selection"
                    ? {
                        kind: "editorial_selection",
                        editorialSelectionId: item.id,
                      }
                    : itemKind === "telegram"
                      ? {
                          kind: "telegram_filter_result",
                          telegramFilterResultId: item.id,
                        }
                      : itemKind === "promo"
                        ? { kind: "promo_idea", promoIdeaId: item.id }
                        : null,
                )
              : null;

          if (!(item.href || origin?.success)) return [];

          return [
            {
              kind: part.output.kind,
              id: item.id,
              title: item.title,
              href: item.href ?? part.output.href,
              ...(origin?.success ? { origin: origin.data } : {}),
            },
          ];
        });
      const originReferents = itemReferents
        .filter((referent) => referent.origin)
        .slice(0, MAX_ASSISTANT_READ_REFERENTS - (root ? 1 : 0));
      const referents =
        originReferents.length > 0
          ? [
              ...itemReferents.filter((referent) => !referent.origin),
              ...(root ? [root] : []),
              ...originReferents,
            ]
          : [...(root ? [root] : []), ...itemReferents];

      for (const referent of referents) {
        const identity = `${referent.kind}:${referent.id}`;
        referentsByIdentity.delete(identity);
        referentsByIdentity.set(identity, referent);
      }
    }
  }

  const context: AssistantConversationContext = {
    turns,
    referents: [...referentsByIdentity.values()].slice(
      -MAX_ASSISTANT_READ_REFERENTS,
    ),
  };

  while (contextBytes(context) > MAX_ASSISTANT_CONTEXT_BYTES) {
    if (context.turns.length > 0) {
      context.turns.shift();
    } else if (context.referents.length > 0) {
      context.referents.shift();
    } else {
      break;
    }
  }

  return context;
}

function rootReadReferent(
  result: AssistantReadResult,
): AssistantConversationContext["referents"][number] | null {
  const id =
    result.kind === "run" || result.kind === "runReport"
      ? result.href.match(
          /(?:[?&]run=|\/dashboard\/runs\/)([0-9a-f]{8}-[0-9a-f-]{27})/iu,
        )?.[1]
      : result.kind === "marketAnalysis" || result.kind === "marketReport"
        ? result.href.match(
            /\/market-analysis\/([0-9a-f]{8}-[0-9a-f-]{27})/iu,
          )?.[1]
        : undefined;

  return id ? { kind: result.kind, id, title: id, href: result.href } : null;
}

function contextBytes(context: AssistantConversationContext) {
  return new TextEncoder().encode(JSON.stringify(context)).byteLength;
}
