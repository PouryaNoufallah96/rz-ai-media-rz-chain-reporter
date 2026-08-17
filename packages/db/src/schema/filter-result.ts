import { foreignKey, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { analysisRun } from "./analysis-run";
import { filterDisposition } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { sourceItem } from "./source-item";
import { workspace } from "./workspace";

export const filterResult = pgTable(
  "filter_result",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisRunId: uuid("analysis_run_id").notNull(),
    sourceItemId: uuid("source_item_id").notNull(),
    disposition: filterDisposition("disposition").notNull(),
    reason: text("reason"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_filter_result_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_filter_result_analysis_run_id",
      columns: [t.analysisRunId],
      foreignColumns: [analysisRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_filter_result_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    unique("uq_filter_result_workspace_id_analysis_run_id_source_item_id").on(
      t.workspaceId,
      t.analysisRunId,
      t.sourceItemId,
    ),
  ],
);
