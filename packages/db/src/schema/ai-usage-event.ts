import type { InvocationKey } from "@rz-chain-reporter/contracts";
import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  modelBackend,
  usageApiKind,
  usageCostAuthority,
  usageProviderGateway,
  usageSource,
  usageStatus,
} from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

export type AiUsageRawMetadata = {
  isByok?: boolean | null;
  nativeFinishReason?: string | null;
  route?: string | null;
  routingAttempts?: number | null;
};

export const aiUsageEvent = pgTable(
  "ai_usage_event",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    operationId: uuid("operation_id").notNull(),
    operationAttemptId: uuid("operation_attempt_id").notNull(),
    invocationKey: text("invocation_key").$type<InvocationKey>().notNull(),
    taskKey: text("task_key").notNull(),
    apiKind: usageApiKind("api_kind").notNull(),
    backend: modelBackend("backend").notNull(),
    providerGateway: usageProviderGateway("provider_gateway").notNull(),
    requestedModel: text("requested_model").notNull(),
    resolvedModel: text("resolved_model"),
    upstreamProvider: text("upstream_provider"),
    generationId: text("generation_id"),
    providerRequestId: text("provider_request_id"),
    status: usageStatus("status").default("pending").notNull(),
    finishReason: text("finish_reason"),
    promptTokens: bigint("prompt_tokens", { mode: "number" }),
    completionTokens: bigint("completion_tokens", { mode: "number" }),
    reasoningTokens: bigint("reasoning_tokens", { mode: "number" }),
    cacheReadTokens: bigint("cache_read_tokens", { mode: "number" }),
    cacheWriteTokens: bigint("cache_write_tokens", { mode: "number" }),
    totalTokens: bigint("total_tokens", { mode: "number" }),
    openrouterCost: numeric("openrouter_cost", {
      precision: 20,
      scale: 10,
    }),
    upstreamInferenceCost: numeric("upstream_inference_cost", {
      precision: 20,
      scale: 10,
    }),
    currency: text("currency").default("USD").notNull(),
    costAuthority: usageCostAuthority("cost_authority")
      .default("unknown")
      .notNull(),
    usageSource: usageSource("usage_source").default("inline").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    reconciledAt: timestamp("reconciled_at", { withTimezone: true }),
    rawUsage: jsonb("raw_usage").$type<AiUsageRawMetadata>(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_ai_usage_event_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_ai_usage_event_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_ai_usage_event_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("cascade"),
    check(
      "ck_ai_usage_event_invocation_key",
      sql`${t.invocationKey} in ('primary', 'retry-1', 'fallback')`,
    ),
    check(
      "ck_ai_usage_event_raw_usage",
      sql`${t.rawUsage} is null or (jsonb_typeof(${t.rawUsage}) = 'object' and ${t.rawUsage} - array['isByok', 'nativeFinishReason', 'route', 'routingAttempts'] = '{}'::jsonb)`,
    ),
    unique("uq_ai_usage_event_operation_attempt_id_invocation_key").on(
      t.operationAttemptId,
      t.invocationKey,
    ),
    uniqueIndex("uq_ai_usage_event_provider_gateway_generation_id_present")
      .on(t.providerGateway, t.generationId)
      .where(sql`${t.generationId} is not null`),
    index("ix_ai_usage_event_workspace_id_occurred_at_id").on(
      t.workspaceId,
      t.occurredAt.desc(),
      t.id.desc(),
    ),
  ],
);
