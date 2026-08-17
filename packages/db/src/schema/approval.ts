import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { draftRevision } from "./draft-revision";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// Editorial acceptance of one exact revision and nothing else: it does not
// publish. Append-only, so the pinned revision restricts.
export const approval = pgTable(
  "approval",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    draftRevisionId: uuid("draft_revision_id").notNull(),
    decidedBy: text("decided_by").notNull(),
    decidedAt: timestamp("decided_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_approval_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_approval_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_approval_decided_by",
      columns: [t.decidedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
  ],
);
