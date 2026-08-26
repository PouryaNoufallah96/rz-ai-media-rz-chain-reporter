import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { copyGenerationUnit } from "./copy-generation-unit";
import { contentLocale } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

export const copyVariant = pgTable(
  "copy_variant",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    copyGenerationUnitId: uuid("copy_generation_unit_id").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    hashtags: text("hashtags").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_copy_variant_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_variant_copy_generation_unit_id",
      columns: [t.copyGenerationUnitId],
      foreignColumns: [copyGenerationUnit.id],
    }).onDelete("restrict"),
    unique("uq_copy_variant_copy_generation_unit_id").on(
      t.copyGenerationUnitId,
    ),
    check("ck_copy_variant_headline_nonempty", sql`btrim(${t.headline}) <> ''`),
    check("ck_copy_variant_body_nonempty", sql`btrim(${t.body}) <> ''`),
    check(
      "ck_copy_variant_hashtags_nonempty",
      sql`cardinality(${t.hashtags}) > 0 and array_position(${t.hashtags}, null) is null`,
    ),
  ],
);
