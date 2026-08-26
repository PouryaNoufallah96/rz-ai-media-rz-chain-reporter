import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { imageGeneration } from "./image-generation";
import { mediaBrand } from "./media-brand";
import { workspace } from "./workspace";

export const imageVarietyMemory = pgTable(
  "image_variety_memory",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    mediaBrandId: uuid("media_brand_id").notNull(),
    selectionSignature: text("selection_signature").notNull(),
    imageGenerationId: uuid("image_generation_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_image_variety_memory_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_variety_memory_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_variety_memory_image_generation_id",
      columns: [t.imageGenerationId],
      foreignColumns: [imageGeneration.operationId],
    }).onDelete("restrict"),
    unique("uq_image_variety_memory_workspace_image_generation_id").on(
      t.workspaceId,
      t.imageGenerationId,
    ),
    check(
      "ck_image_variety_memory_selection_signature_sha256",
      sql`length(${t.selectionSignature}) = 64 and ${t.selectionSignature} ~ '^[0-9a-f]{64}$'`,
    ),
    index("ix_image_variety_memory_workspace_brand_created_at_id").on(
      t.workspaceId,
      t.mediaBrandId,
      t.createdAt.desc(),
      t.id.desc(),
    ),
  ],
);
