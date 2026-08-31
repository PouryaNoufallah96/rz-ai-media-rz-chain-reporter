import type { EffectiveTopics, ErrorCode } from "@rz-chain-reporter/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { sourceImportStage, telegramOrderingMode } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

// Counts are derived from child rows, not stored here.
export const sourceImport = pgTable(
  "source_import",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    operationId: uuid("operation_id").notNull(),
    stage: sourceImportStage("stage").notNull(),
    failureCode: text("failure_code").$type<ErrorCode>(),
    windowHours: integer("window_hours").notNull(),
    orderingMode: telegramOrderingMode("ordering_mode").notNull(),
    topN: integer("top_n").notNull(),
    topics: text("topics").array().notNull(),
    effectiveTopics: jsonb("effective_topics").$type<EffectiveTopics>(),
    enrichmentEnabled: boolean("enrichment_enabled").notNull(),
    templateFingerprint: text("template_fingerprint").notNull(),
    embeddingAttemptId: uuid("embedding_attempt_id"),
    embeddingDimension: integer("embedding_dimension"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_source_import_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_import_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_import_embedding_attempt_id",
      columns: [t.embeddingAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique("uq_source_import_operation_id").on(t.operationId),
    check(
      "ck_source_import_effective_topics_shape",
      sql`${t.effectiveTopics} is null or (
        jsonb_typeof(${t.effectiveTopics}) = 'object'
        and ${t.effectiveTopics} ?& array['contentLocale', 'values', 'usedOriginalFallback']
        and ${t.effectiveTopics} - array['contentLocale', 'values', 'usedOriginalFallback'] = '{}'::jsonb
        and jsonb_typeof(${t.effectiveTopics}->'contentLocale') = 'string'
        and ${t.effectiveTopics}->>'contentLocale' in ('en', 'fa')
        and jsonb_typeof(${t.effectiveTopics}->'values') = 'array'
        and not jsonb_path_exists(${t.effectiveTopics}->'values', '$[*] ? (@.type() != "string")')
        and jsonb_array_length(${t.effectiveTopics}->'values') = cardinality(${t.topics})
        and jsonb_typeof(${t.effectiveTopics}->'usedOriginalFallback') = 'boolean'
      )`,
    ),
    uniqueIndex("uq_source_import_workspace_id_unsettled")
      .on(t.workspaceId)
      .where(sql`${t.stage} <> 'settled'`),
  ],
);
