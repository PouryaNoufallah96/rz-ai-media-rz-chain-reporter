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

import { copyVariant } from "./copy-variant";
import { contentLocale } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

export const copyVariantLocalization = pgTable(
  "copy_variant_localization",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    copyVariantId: uuid("copy_variant_id").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    operationAttemptId: uuid("operation_attempt_id").notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    hashtags: text("hashtags").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_copy_variant_localization_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_variant_localization_copy_variant_id",
      columns: [t.copyVariantId],
      foreignColumns: [copyVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_variant_localization_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique("uq_copy_variant_localization_variant_locale").on(
      t.workspaceId,
      t.copyVariantId,
      t.contentLocale,
    ),
    check(
      "ck_copy_variant_localization_headline_nonempty",
      sql`btrim(${t.headline}) <> ''`,
    ),
    check(
      "ck_copy_variant_localization_body_nonempty",
      sql`btrim(${t.body}) <> ''`,
    ),
    check(
      "ck_copy_variant_localization_hashtags_nonempty",
      sql`cardinality(${t.hashtags}) > 0 and array_position(${t.hashtags}, null) is null`,
    ),
  ],
);
