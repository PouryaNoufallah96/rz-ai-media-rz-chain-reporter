import type { ErrorCode } from "@rz-chain-reporter/contracts";
import { foreignKey, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { analysisRun } from "./analysis-run";
import { modelUnitStatus } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaBrand } from "./media-brand";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

// One unit aggregate serves News selections and Promo Ideas; slot provenance
// remains on ai_usage_event and is never copied here.
export const analysisModelUnit = pgTable(
  "analysis_model_unit",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisRunId: uuid("analysis_run_id").notNull(),
    mediaBrandId: uuid("media_brand_id").notNull(),
    modelOptionKey: text("model_option_key").notNull(),
    taskKey: text("task_key").notNull(),
    status: modelUnitStatus("status").notNull(),
    operationAttemptId: uuid("operation_attempt_id"),
    failureCode: text("failure_code").$type<ErrorCode>(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_analysis_model_unit_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_model_unit_analysis_run_id",
      columns: [t.analysisRunId],
      foreignColumns: [analysisRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_analysis_model_unit_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_model_unit_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique(
      "uq_analysis_model_unit_workspace_id_analysis_run_id_me_3c3979e2",
    ).on(t.workspaceId, t.analysisRunId, t.mediaBrandId, t.modelOptionKey),
  ],
);
