import {
  boolean,
  foreignKey,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { articleFetchMode, contentLocale, sourceOrigin } from "./enums";
import {
  softDelete,
  timestamps,
  uuidPrimaryKey,
  workspaceScope,
} from "./helpers";
import { workspace } from "./workspace";

// Keywords, weights, thresholds, and source authority stay off this row; Phase 6 consumes them from the template.
export const source = pgTable(
  "source",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    key: text("key").notNull(),
    origin: sourceOrigin("origin").notNull(),
    endpoint: text("endpoint").notNull(),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata"),
    contentLocale: contentLocale("content_locale").notNull(),
    // Null for telegram_public: the mode only governs RSS article pages.
    articleFetchMode: articleFetchMode("article_fetch_mode"),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    foreignKey({
      name: "fk_source_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    unique("uq_source_workspace_id_key").on(t.workspaceId, t.key),
  ],
);
