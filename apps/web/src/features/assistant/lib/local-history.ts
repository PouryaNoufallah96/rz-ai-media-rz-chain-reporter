import { z } from "zod";

import { HISTORY_SCHEMA_VERSION, HISTORY_TTL_MS } from "../constants";
import type { AssistantUIMessage } from "../schemas/assistant-message";
import {
  assistantAskUserSchema,
  assistantCitationSchema,
  assistantMessageMetadataSchema,
} from "../schemas/ui-message";

const MAX_PARTS = 24;
const MAX_MESSAGES = 40;

// Stored history is a projection, not a mirror: the SDK owns the live message
// shape and adds fields, so unknown keys are stripped and an unknown part or
// message is dropped instead of failing the whole envelope.
const partSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().max(20_000),
    state: z.string().optional(),
  }),
  z.object({
    type: z.literal("data-citation"),
    id: z.string().optional(),
    data: assistantCitationSchema,
  }),
  z.object({
    type: z.literal("tool-ask_user"),
    toolCallId: z.string().max(128),
    state: z.string(),
    input: assistantAskUserSchema.optional(),
    output: z.object({ choiceId: z.string().max(128) }).optional(),
  }),
]);

function owned<Value>(schema: z.ZodType<Value>, values: readonly unknown[]) {
  return values.flatMap((value) => {
    const parsed = schema.safeParse(value);

    return parsed.success ? [parsed.data] : [];
  });
}

const messageSchema = z.object({
  id: z.string().max(128),
  role: z.enum(["user", "assistant"]),
  metadata: assistantMessageMetadataSchema.optional(),
  parts: z
    .array(z.unknown())
    .transform((parts) => owned(partSchema, parts).slice(0, MAX_PARTS)),
});

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
    globalThis.localStorage?.removeItem(key);
    return [];
  }

  return envelope.data.messages as AssistantUIMessage[];
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
