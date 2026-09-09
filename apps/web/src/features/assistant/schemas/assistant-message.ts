import { runCardOriginReferenceSchema } from "@rz-chain-reporter/contracts";
import { z } from "zod";
import {
  publishingQuerySchema,
  savedQuerySchema,
} from "@/features/publishing/schemas/history";
import { usageQuerySchema } from "@/features/usage/schemas/usage";
import { MAX_QUESTION_CHARS } from "../constants";

export const READ_WORKSPACE_TOOL = "read_workspace";
export const MAX_ASSISTANT_READ_ITEMS = 20;

const cursorSchema = z.string().min(1).max(512).nullable().optional();

export const assistantReadInputSchema = z.discriminatedUnion("target", [
  z.strictObject({ target: z.literal("installation") }),
  z.strictObject({
    target: z.literal("runs"),
    scope: z.enum(["current", "recent"]),
  }),
  z.strictObject({ target: z.literal("run"), runId: z.uuid().optional() }),
  z.strictObject({ target: z.literal("run_report"), runId: z.uuid() }),
  z.strictObject({ target: z.literal("card"), draftId: z.uuid().optional() }),
  z.strictObject({ target: z.literal("account") }),
  z.strictObject({ target: z.literal("activity") }),
  z.strictObject({
    target: z.literal("activity_ledger"),
    cursor: cursorSchema,
  }),
  z.strictObject({ target: z.literal("topics") }),
  z.strictObject({
    target: z.literal("saved"),
    state: savedQuerySchema.shape.state.default("active"),
    cursor: cursorSchema,
  }),
  z.strictObject({
    target: z.literal("publishing"),
    view: publishingQuerySchema.shape.view,
    cursor: cursorSchema,
  }),
  z.strictObject({
    target: z.literal("usage"),
    facet: z.enum(["summary", "details"]).default("summary"),
    period: usageQuerySchema.shape.period.default("7d"),
    model: usageQuerySchema.shape.model.optional(),
    backend: usageQuerySchema.shape.backend.optional(),
    provider: usageQuerySchema.shape.provider.optional(),
    task: usageQuerySchema.shape.task.optional(),
    status: usageQuerySchema.shape.status.optional(),
    cursor: usageQuerySchema.shape.cursor.optional(),
  }),
  z.strictObject({ target: z.literal("market_options") }),
  z.strictObject({ target: z.literal("market_catalog") }),
  z.strictObject({ target: z.literal("market_history"), cursor: cursorSchema }),
  z.strictObject({
    target: z.literal("market_analysis"),
    analysisId: z.uuid().optional(),
  }),
  z.strictObject({
    target: z.literal("market_report"),
    analysisId: z.uuid().optional(),
  }),
]);

export type AssistantReadInput = z.infer<typeof assistantReadInputSchema>;

export const assistantReadToolInputSchema = z.strictObject({
  request: assistantReadInputSchema,
});

export const ASSISTANT_READ_KINDS = [
  "installation",
  "runs",
  "run",
  "runReport",
  "card",
  "account",
  "activity",
  "activityLedger",
  "topics",
  "saved",
  "publishing",
  "usage",
  "marketOptions",
  "marketCatalog",
  "marketHistory",
  "marketAnalysis",
  "marketReport",
] as const;

export const MAX_ASSISTANT_CONTEXT_BYTES = 12 * 1_024;
export const MAX_ASSISTANT_CONTEXT_TURNS = 6;
export const MAX_ASSISTANT_READ_REFERENTS = 6;

const assistantContextTurnSchema = z.strictObject({
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});

const assistantReadReferentSchema = z.strictObject({
  kind: z.enum(ASSISTANT_READ_KINDS),
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  href: z.string().startsWith("/").max(1_000),
  origin: runCardOriginReferenceSchema.optional(),
});

export const assistantConversationContextSchema = z
  .strictObject({
    turns: z.array(assistantContextTurnSchema).max(MAX_ASSISTANT_CONTEXT_TURNS),
    referents: z
      .array(assistantReadReferentSchema)
      .max(MAX_ASSISTANT_READ_REFERENTS),
  })
  .superRefine((context, refinement) => {
    if (
      new TextEncoder().encode(JSON.stringify(context)).byteLength >
      MAX_ASSISTANT_CONTEXT_BYTES
    ) {
      refinement.addIssue({
        code: "custom",
        message: "Assistant conversation context is too large",
      });
    }
  });

export type AssistantConversationContext = z.infer<
  typeof assistantConversationContextSchema
>;

export const ASSISTANT_READ_FACTS = [
  "workspace",
  "template",
  "timeZone",
  "brands",
  "sources",
  "enabledSources",
  "destinations",
  "marketAnalysis",
  "profile",
  "email",
  "createdAt",
  "generatedDrafts",
  "scheduled",
  "saved",
  "kind",
  "lifecycle",
  "startedAt",
  "modelLanes",
  "telegramCards",
  "candidates",
  "promoIdeas",
  "selections",
  "fetched",
  "admitted",
  "output",
  "period",
  "scale",
  "requestedModel",
  "resolvedModel",
  "backend",
  "provider",
  "task",
  "invocationKey",
  "status",
  "invocations",
  "recordedInvocations",
  "promptTokens",
  "completionTokens",
  "totalTokens",
  "recordedCost",
  "costAuthority",
  "models",
  "returned",
  "pendingCount",
  "unknownCount",
  "instruments",
  "comparisons",
  "periods",
  "scales",
  "outputFormat",
  "analyses",
  "stage",
  "contentLocale",
  "linkedDrafts",
  "media",
  "activeRevision",
  "copyPreview",
  "image",
  "approval",
  "publication",
  "schedule",
  "updatedAt",
  "items",
] as const;

const assistantReadFactSchema = z.strictObject({
  key: z.enum(ASSISTANT_READ_FACTS),
  value: z.string().max(1_000),
});

const assistantReadItemSchema = z.strictObject({
  id: z.string().min(1).max(128),
  title: z.string().min(1).max(500),
  status: z.string().min(1).max(120).nullable(),
  occurredAt: z.iso.datetime().nullable(),
  href: z.string().startsWith("/").max(1_000).nullable(),
  facts: z.array(assistantReadFactSchema).max(12),
});

export const assistantReadResultSchema = z.strictObject({
  kind: z.enum(ASSISTANT_READ_KINDS),
  observedAt: z.iso.datetime(),
  href: z.string().startsWith("/").max(1_000),
  facts: z.array(assistantReadFactSchema).max(20),
  items: z.array(assistantReadItemSchema).max(MAX_ASSISTANT_READ_ITEMS),
  cursors: z
    .strictObject({
      older: z.string().min(1).max(512).nullable(),
      newer: z.string().min(1).max(512).nullable(),
    })
    .nullable(),
  notice: z
    .enum([
      "none",
      "currentRunRequired",
      "cardRequired",
      "notFound",
      "marketDisabled",
    ])
    .default("none"),
});

export type AssistantReadResult = z.infer<typeof assistantReadResultSchema>;
