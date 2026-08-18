import {
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { contentLocale, sourceOrigin } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

export const sourceItem = pgTable(
  "source_item",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
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
    unique("uq_source_item_workspace_id_origin_external_id").on(
      t.workspaceId,
      t.origin,
      t.externalId,
    ),
  ],
);
