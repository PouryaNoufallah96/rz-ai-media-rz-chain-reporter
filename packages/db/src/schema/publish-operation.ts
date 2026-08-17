import { foreignKey, pgTable, text, uuid } from "drizzle-orm/pg-core";

import { draftRevision } from "./draft-revision";
import { platform } from "./enums";
import { timestamps, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { schedule } from "./schedule";
import { workspace } from "./workspace";

export const publishOperation = pgTable(
  "publish_operation",
  {
    operationId: uuid("operation_id").primaryKey(),
    ...workspaceScope,
    platform: platform("platform").notNull(),
    draftRevisionId: uuid("draft_revision_id").notNull(),
    scheduleId: uuid("schedule_id"),
    externalResultId: text("external_result_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_publish_operation_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_publish_operation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_schedule_id",
      columns: [t.scheduleId],
      foreignColumns: [schedule.id],
    }).onDelete("restrict"),
  ],
);
