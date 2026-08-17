import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { platformDraft } from "./platform-draft";
import { workspace } from "./workspace";

// The operator's recorded approvals, schedules, and publishing outcomes.
// Subjects are enforced references rather than a (type, id) pair, because an
// unenforced polymorphic id is the legacy defect this schema corrects. What a
// historical count means stays a cutover question, not a column.
export const activityEvent = pgTable(
  "activity_event",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    actor: text("actor").notNull(),
    eventType: text("event_type").notNull(),
    platformDraftId: uuid("platform_draft_id"),
    operationId: uuid("operation_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_activity_event_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_actor",
      columns: [t.actor],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
  ],
);
