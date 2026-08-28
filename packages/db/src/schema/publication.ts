import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { approval } from "./approval";
import { draftRevision } from "./draft-revision";
import { platform, publicationLifecycle } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

export const publication = pgTable(
  "publication",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    approvalId: uuid("approval_id").notNull(),
    draftRevisionId: uuid("draft_revision_id").notNull(),
    platform: platform("platform").notNull(),
    selectedFinalMediaAssetId: uuid("selected_final_media_asset_id"),
    lifecycle: publicationLifecycle("lifecycle").default("available").notNull(),
    reservedScheduleId: uuid("reserved_schedule_id"),
    activeOperationId: uuid("active_operation_id"),
    unresolvedAttemptId: uuid("unresolved_attempt_id"),
    confirmedCheckpointId: uuid("confirmed_checkpoint_id"),
    confirmedProviderResultId: text("confirmed_provider_result_id"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_publication_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_approval_id",
      columns: [t.approvalId],
      foreignColumns: [approval.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_selected_final_media_asset_id",
      columns: [t.selectedFinalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_active_operation_id",
      columns: [t.activeOperationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_unresolved_attempt_id",
      columns: [t.unresolvedAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique("uq_publication_workspace_revision_platform").on(
      t.workspaceId,
      t.draftRevisionId,
      t.platform,
    ),
    index("ix_publication_workspace_updated_id").on(
      t.workspaceId,
      t.updatedAt,
      t.id,
    ),
    check("ck_publication_version_positive", sql`${t.version} > 0`),
    check(
      "ck_publication_platform_media",
      sql`${t.platform} <> 'instagram' or ${t.selectedFinalMediaAssetId} is not null`,
    ),
    check(
      "ck_publication_unknown_attempt",
      sql`(${t.lifecycle} = 'delivery_unknown') = (${t.unresolvedAttemptId} is not null)`,
    ),
    check(
      "ck_publication_confirmed_result",
      sql`((${t.lifecycle} = 'confirmed') = (${t.confirmedAt} is not null)) and ((${t.confirmedCheckpointId} is null) = (${t.confirmedProviderResultId} is null))`,
    ),
    check(
      "ck_publication_active_owner",
      sql`${t.lifecycle} not in ('effect_claimed', 'delivery_unknown') or ${t.activeOperationId} is not null`,
    ),
  ],
);
