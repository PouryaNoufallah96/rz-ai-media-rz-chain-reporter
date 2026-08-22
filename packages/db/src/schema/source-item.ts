import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { contentLocale, sourceOrigin } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { source } from "./source";
import { workspace } from "./workspace";

// Content columns are the frozen first-seen snapshot; later versions live on source_item_revision.
export const sourceItem = pgTable(
  "source_item",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceId: uuid("source_id").notNull(),
    origin: sourceOrigin("origin").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    attribution: text("attribution").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_source_item_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_item_source_id",
      columns: [t.sourceId],
      foreignColumns: [source.id],
    }).onDelete("restrict"),
    unique("uq_source_item_workspace_id_source_id_external_id").on(
      t.workspaceId,
      t.sourceId,
      t.externalId,
    ),
    index("ix_source_item_workspace_id_created_at_id").on(
      t.workspaceId,
      t.createdAt,
      t.id,
    ),
  ],
);
