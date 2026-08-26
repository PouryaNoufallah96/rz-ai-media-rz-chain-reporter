import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { mediaDerivationPurpose } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { workspace } from "./workspace";

export const mediaDerivation = pgTable(
  "media_derivation",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceMediaAssetId: uuid("source_media_asset_id").notNull(),
    derivedMediaAssetId: uuid("derived_media_asset_id").notNull(),
    purpose: mediaDerivationPurpose("purpose").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_media_derivation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_media_derivation_source_media_asset_id",
      columns: [t.sourceMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_media_derivation_derived_media_asset_id",
      columns: [t.derivedMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    unique("uq_media_derivation_workspace_derived_media_asset_id").on(
      t.workspaceId,
      t.derivedMediaAssetId,
    ),
    check(
      "ck_media_derivation_distinct_assets",
      sql`${t.sourceMediaAssetId} <> ${t.derivedMediaAssetId}`,
    ),
  ],
);
