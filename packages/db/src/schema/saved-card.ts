import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { platformDraft } from "./platform-draft";
import { workspace } from "./workspace";

export const savedCard = pgTable(
  "saved_card",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    platformDraftId: uuid("platform_draft_id").notNull(),
    savedBy: text("saved_by").notNull(),
    discardedAt: timestamp("discarded_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_saved_card_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_saved_card_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_saved_card_saved_by",
      columns: [t.savedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    uniqueIndex("uq_saved_card_workspace_id_saved_by_platform_draft_id_active")
      .on(t.workspaceId, t.savedBy, t.platformDraftId)
      .where(sql`discarded_at is null`),
    index("ix_saved_card_workspace_saved_by_created_id").on(
      t.workspaceId,
      t.savedBy,
      t.createdAt,
      t.id,
    ),
    check("ck_saved_card_version_positive", sql`${t.version} > 0`),
  ],
);
