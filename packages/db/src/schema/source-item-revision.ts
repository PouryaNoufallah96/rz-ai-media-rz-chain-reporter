import {
  foreignKey,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { contentLocale } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { sourceItem } from "./source-item";
import { workspace } from "./workspace";

export const sourceItemRevision = pgTable(
  "source_item_revision",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceItemId: uuid("source_item_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    canonicalUrl: text("canonical_url").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    contentHash: text("content_hash").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_source_item_revision_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_item_revision_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("cascade"),
    unique(
      "uq_source_item_revision_workspace_id_source_item_id_re_fc2f2a55",
    ).on(t.workspaceId, t.sourceItemId, t.revisionNumber),
    unique(
      "uq_source_item_revision_workspace_id_source_item_id_co_643af24a",
    ).on(t.workspaceId, t.sourceItemId, t.contentHash),
  ],
);
