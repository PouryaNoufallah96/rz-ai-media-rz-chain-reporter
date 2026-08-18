import {
  bigint,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { mediaAssetLifecycle } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

export const mediaAsset = pgTable(
  "media_asset",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    kind: text("kind").notNull(),
    objectKey: text("object_key").notNull(),
    mimeType: text("mime_type").notNull(),
    declaredBytes: bigint("declared_bytes", { mode: "number" }).notNull(),
    actualBytes: bigint("actual_bytes", { mode: "number" }),
    checksum: text("checksum"),
    width: integer("width"),
    height: integer("height"),
    lifecycle: mediaAssetLifecycle("lifecycle").default("pending").notNull(),
    uploadExpiresAt: timestamp("upload_expires_at", { withTimezone: true }),
    cleanupAfter: timestamp("cleanup_after", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_media_asset_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    unique("uq_media_asset_workspace_id_object_key").on(
      t.workspaceId,
      t.objectKey,
    ),
  ],
);
