import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { draftRevision } from "./draft-revision";
import { platform, scheduleStatus } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// Immutable intent pinned to one exact revision: scheduled_at is what the
// operator asked for in `timezone`, effective_at is the canonical instant every
// retry and replay reuses instead of recomputing from the clock. Execution
// state lives on the operation, so status only records the intent's own end.
export const schedule = pgTable(
  "schedule",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    draftRevisionId: uuid("draft_revision_id").notNull(),
    platform: platform("platform").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    status: scheduleStatus("status").default("scheduled").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_schedule_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
  ],
);
