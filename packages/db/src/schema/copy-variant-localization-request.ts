import {
  foreignKey,
  index,
  pgTable,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { copyVariant } from "./copy-variant";
import { contentLocale } from "./enums";
import { workspaceScope } from "./helpers";
import { operation } from "./operation";
import { workspace } from "./workspace";

export const copyVariantLocalizationRequest = pgTable(
  "copy_variant_localization_request",
  {
    operationId: uuid("operation_id").primaryKey(),
    ...workspaceScope,
    copyVariantId: uuid("copy_variant_id").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_copy_variant_translation_request_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_variant_translation_request_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_variant_translation_request_copy_variant_id",
      columns: [t.copyVariantId],
      foreignColumns: [copyVariant.id],
    }).onDelete("restrict"),
    index("ix_copy_variant_translation_request_variant_locale").on(
      t.workspaceId,
      t.copyVariantId,
      t.contentLocale,
      t.createdAt.desc(),
      t.operationId,
    ),
  ],
);
