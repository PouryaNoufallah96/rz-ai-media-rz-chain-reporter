import {
  foreignKey,
  integer,
  pgTable,
  text,
  unique,
} from "drizzle-orm/pg-core";

import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// Customer-template reference data seeded at provisioning, not operator CRUD and
// not a value set the code owns: which brands exist varies per installation, so
// `key` is the template's stable handle and every reference restricts against it.
export const mediaBrand = pgTable(
  "media_brand",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    key: text("key").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_media_brand_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    unique("uq_media_brand_workspace_id_key").on(t.workspaceId, t.key),
  ],
);
