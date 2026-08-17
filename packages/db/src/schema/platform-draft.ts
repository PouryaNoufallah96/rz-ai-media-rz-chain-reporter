import { foreignKey, integer, pgTable, uuid } from "drizzle-orm/pg-core";

import { editorialSelection } from "./editorial-selection";
import { contentLocale, platform } from "./enums";
import {
  softDelete,
  timestamps,
  uuidPrimaryKey,
  workspaceScope,
} from "./helpers";
import { mediaBrand } from "./media-brand";
import { sourceItem } from "./source-item";
import { workspace } from "./workspace";

// The stable content identity: edits append revisions instead of mutating this
// row, so `version` guards only the draft's own mutable fields.
export const platformDraft = pgTable(
  "platform_draft",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    mediaBrandId: uuid("media_brand_id").notNull(),
    platform: platform("platform").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    editorialSelectionId: uuid("editorial_selection_id"),
    sourceItemId: uuid("source_item_id"),
    version: integer("version").default(1).notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    foreignKey({
      name: "fk_platform_draft_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_editorial_selection_id",
      columns: [t.editorialSelectionId],
      foreignColumns: [editorialSelection.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_platform_draft_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
  ],
);
