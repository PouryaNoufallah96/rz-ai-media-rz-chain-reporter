import type { RunConfiguration } from "@rz-chain-reporter/contracts";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  analysisRunKind,
  semanticDegradedReason,
  semanticStageStatus,
  sourceImportBinding,
} from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { sourceImport } from "./source-import";
import { workspace } from "./workspace";

// Semantic provider/model provenance is reached through semantic_attempt_id;
// counts are derived from child rows rather than stored here.
export const analysisRun = pgTable(
  "analysis_run",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    kind: analysisRunKind("kind").notNull(),
    operationId: uuid("operation_id").notNull(),
    sourceImportId: uuid("source_import_id"),
    sourceImportBinding: sourceImportBinding("source_import_binding"),
    configuration: jsonb("configuration").$type<RunConfiguration>().notNull(),
    templateFingerprint: text("template_fingerprint").notNull(),
    scoringVersion: text("scoring_version"),
    fanOutPlannedAt: timestamp("fan_out_planned_at", { withTimezone: true }),
    semanticStatus: semanticStageStatus("semantic_status").notNull(),
    semanticReason: semanticDegradedReason("semantic_reason"),
    semanticAttemptId: uuid("semantic_attempt_id"),
    semanticDimension: integer("semantic_dimension"),
    semanticNormalizationVersion: text("semantic_normalization_version"),
    semanticProjectionVersion: text("semantic_projection_version"),
    semanticTopicCount: integer("semantic_topic_count"),
    semanticAnchorCount: integer("semantic_anchor_count"),
    cancelRequestedAt: timestamp("cancel_requested_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_analysis_run_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_run_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_run_source_import_id",
      columns: [t.sourceImportId],
      foreignColumns: [sourceImport.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_run_semantic_attempt_id",
      columns: [t.semanticAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique("uq_analysis_run_operation_id").on(t.operationId),
    index("ix_analysis_run_workspace_id_started_at_id").on(
      t.workspaceId,
      t.startedAt,
      t.id,
    ),
  ],
);
