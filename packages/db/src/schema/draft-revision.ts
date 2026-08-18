import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { contentLocale } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
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
    headline: text("headline"),
    copy: text("copy").notNull(),
    hashtags: text("hashtags").array().default([]).notNull(),
    variants: jsonb("variants"),
    authoredBy: text("authored_by"),
    editorialModel: text("editorial_model"),
    mediaAssetId: uuid("media_asset_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_draft_revision_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_draft_revision_media_asset_id",
      columns: [t.mediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_authored_by",
      columns: [t.authoredBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    unique(
      "uq_draft_revision_workspace_id_platform_draft_id_revis_570bf336",
    ).on(t.workspaceId, t.platformDraftId, t.revisionNumber),
  ],
);
