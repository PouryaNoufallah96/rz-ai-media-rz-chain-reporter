import { foreignKey, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";

import { analysisRunKind } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { workspace } from "./workspace";

export const analysisRun = pgTable(
  "analysis_run",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    kind: analysisRunKind("kind").notNull(),
    operationId: uuid("operation_id"),
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
  ],
);
