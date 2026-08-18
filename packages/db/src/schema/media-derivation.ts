import { foreignKey, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { workspace } from "./workspace";

export const mediaDerivation = pgTable(
  "media_derivation",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    mediaAssetId: uuid("media_asset_id").notNull(),
    purpose: text("purpose").notNull(),
    objectKey: text("object_key").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_media_derivation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_media_derivation_media_asset_id",
      columns: [t.mediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("cascade"),
    unique("uq_media_derivation_workspace_id_object_key").on(
      t.workspaceId,
      t.objectKey,
    ),
  ],
);
