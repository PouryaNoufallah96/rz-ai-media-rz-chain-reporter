import {
  boolean,
  foreignKey,
  jsonb,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { sourceOrigin } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// A configured origin the installation draws material from, seeded from the
// customer template rather than operator CRUD. `endpoint` holds the feed URL for
// `rss` and the public channel handle for `telegram_public`; the origin's
// SourceFetcher reads it. Keywords, weights, thresholds, caps and source
// authority are template configuration Phase 6 consumes, deliberately not
// columns here, and `metadata` carries only non-secret fetch detail.
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
    ...timestamps,
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
