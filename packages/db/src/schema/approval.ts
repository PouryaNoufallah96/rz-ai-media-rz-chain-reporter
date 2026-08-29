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

import { user } from "./auth";
import { draftRevision } from "./draft-revision";
import { platform } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { workspace } from "./workspace";

export const approval = pgTable(
  "approval",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    draftRevisionId: uuid("draft_revision_id").notNull(),
    platform: platform("platform").notNull(),
    selectedFinalMediaAssetId: uuid("selected_final_media_asset_id"),
    approvedBy: text("approved_by").notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_approval_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_approval_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_approval_selected_final_media_asset_id",
      columns: [t.selectedFinalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_approval_approved_by",
      columns: [t.approvedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    unique("uq_approval_workspace_actor_idempotency").on(
      t.workspaceId,
      t.approvedBy,
      t.idempotencyKey,
    ),
    unique("uq_approval_workspace_revision_platform").on(
      t.workspaceId,
      t.draftRevisionId,
      t.platform,
    ),
    check(
      "ck_approval_platform_media",
      sql`${t.platform} <> 'instagram' or ${t.selectedFinalMediaAssetId} is not null`,
    ),
  ],
);
