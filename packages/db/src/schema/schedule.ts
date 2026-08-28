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
import { user } from "./auth";
import { destinationAccount } from "./destination-account";
import { draftRevision } from "./draft-revision";
import { platform, scheduleLifecycle } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { operation } from "./operation";
import { publication } from "./publication";
import { workspace } from "./workspace";

export const schedule = pgTable(
  "schedule",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    approvalId: uuid("approval_id").notNull(),
    publicationId: uuid("publication_id").notNull(),
    draftRevisionId: uuid("draft_revision_id").notNull(),
    platform: platform("platform").notNull(),
    selectedFinalMediaAssetId: uuid("selected_final_media_asset_id"),
    destinationAccountId: uuid("destination_account_id").notNull(),
    originatingOperationId: uuid("originating_operation_id"),
    predecessorScheduleId: uuid("predecessor_schedule_id"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true }).notNull(),
    lifecycle: scheduleLifecycle("lifecycle").default("scheduled").notNull(),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    createdBy: text("created_by").notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_schedule_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_approval_id",
      columns: [t.approvalId],
      foreignColumns: [approval.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_publication_id",
      columns: [t.publicationId],
      foreignColumns: [publication.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_selected_final_media_asset_id",
      columns: [t.selectedFinalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_destination_account_id",
      columns: [t.destinationAccountId],
      foreignColumns: [destinationAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_originating_operation_id",
      columns: [t.originatingOperationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_predecessor_schedule_id",
      columns: [t.predecessorScheduleId],
      foreignColumns: [t.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_schedule_created_by",
      columns: [t.createdBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    unique("uq_schedule_workspace_predecessor").on(
      t.workspaceId,
      t.predecessorScheduleId,
    ),
    index("ix_schedule_workspace_scheduled_id").on(
      t.workspaceId,
      t.scheduledAt,
      t.id,
    ),
    check("ck_schedule_version_positive", sql`${t.version} > 0`),
    check(
      "ck_schedule_claim_complete",
      sql`num_nonnulls(${t.claimedBy}, ${t.claimedAt}, ${t.leaseExpiresAt}) in (0, 3)`,
    ),
    check(
      "ck_schedule_claim_lifecycle",
      sql`${t.claimedBy} is null or ${t.lifecycle} = 'effect_claimed'`,
    ),
    check(
      "ck_schedule_platform_media",
      sql`${t.platform} <> 'instagram' or ${t.selectedFinalMediaAssetId} is not null`,
    ),
  ],
);
