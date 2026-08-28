import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { copyVariant } from "./copy-variant";
import { contentLocale } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { platformDraft } from "./platform-draft";
import { workspace } from "./workspace";

export const draftRevision = pgTable(
  "draft_revision",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    platformDraftId: uuid("platform_draft_id").notNull(),
    revisionNumber: integer("revision_number").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    headline: text("headline").notNull(),
    body: text("body").notNull(),
    hashtags: text("hashtags").array().notNull(),
    originatingCopyVariantId: uuid("originating_copy_variant_id").notNull(),
    selectedFinalMediaAssetId: uuid("selected_final_media_asset_id"),
    authoredBy: text("authored_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_draft_revision_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_originating_copy_variant_id",
      columns: [t.originatingCopyVariantId],
      foreignColumns: [copyVariant.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_selected_final_media_asset_id",
      columns: [t.selectedFinalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_authored_by",
      columns: [t.authoredBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    unique("uq_draft_revision_workspace_platform_draft_revision_number").on(
      t.workspaceId,
      t.platformDraftId,
      t.revisionNumber,
    ),
    unique("uq_draft_revision_workspace_platform_draft_id").on(
      t.workspaceId,
      t.platformDraftId,
      t.id,
    ),
    check(
      "ck_draft_revision_revision_number_positive",
      sql`${t.revisionNumber} > 0`,
    ),
    check(
      "ck_draft_revision_headline_nonempty",
      sql`btrim(${t.headline}) <> ''`,
    ),
    check("ck_draft_revision_body_nonempty", sql`btrim(${t.body}) <> ''`),
    check(
      "ck_draft_revision_hashtags_nonempty",
      sql`cardinality(${t.hashtags}) > 0 and array_position(${t.hashtags}, null) is null`,
    ),
  ],
);
