import type { ErrorCode } from "@rz-chain-reporter/contracts";
import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { destinationAccount } from "./destination-account";
import { draftRevision } from "./draft-revision";
import {
  platform,
  publishCommandKind,
  settlementActivityStatus,
} from "./enums";
import { timestamps, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { operation } from "./operation";
import { publication } from "./publication";
import { schedule } from "./schedule";
import { workspace } from "./workspace";

export const publishOperation = pgTable(
  "publish_operation",
  {
    operationId: uuid("operation_id").primaryKey(),
    ...workspaceScope,
    publicationId: uuid("publication_id").notNull(),
    destinationAccountId: uuid("destination_account_id").notNull(),
    platform: platform("platform").notNull(),
    draftRevisionId: uuid("draft_revision_id").notNull(),
    selectedFinalMediaAssetId: uuid("selected_final_media_asset_id"),
    scheduleId: uuid("schedule_id"),
    commandKind: publishCommandKind("command_kind").default("direct").notNull(),
    settlementActivityStatus: settlementActivityStatus(
      "settlement_activity_status",
    )
      .default("not_due")
      .notNull(),
    settlementActivityFailureCode: text(
      "settlement_activity_failure_code",
    ).$type<ErrorCode>(),
    settlementActivityRecordedAt: timestamp("settlement_activity_recorded_at", {
      withTimezone: true,
    }),
    cacheNotificationCompletedAt: timestamp("cache_notification_completed_at", {
      withTimezone: true,
    }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_publish_operation_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_publish_operation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_publication_id",
      columns: [t.publicationId],
      foreignColumns: [publication.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_destination_account_id",
      columns: [t.destinationAccountId],
      foreignColumns: [destinationAccount.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_selected_final_media_asset_id",
      columns: [t.selectedFinalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_operation_schedule_id",
      columns: [t.scheduleId],
      foreignColumns: [schedule.id],
    }).onDelete("restrict"),
    check(
      "ck_publish_operation_platform_media",
      sql`${t.platform} <> 'instagram' or ${t.selectedFinalMediaAssetId} is not null`,
    ),
    index("ix_publish_operation_workspace_publication_updated_operation").on(
      t.workspaceId,
      t.publicationId,
      t.updatedAt,
      t.operationId,
    ),
    index("ix_publish_operation_workspace_follow_up").on(
      t.workspaceId,
      t.updatedAt,
      t.operationId,
    ),
    check(
      "ck_publish_operation_activity_status",
      sql`(${t.settlementActivityStatus} = 'recorded') = (${t.settlementActivityRecordedAt} is not null) and (${t.settlementActivityStatus} = 'failed') = (${t.settlementActivityFailureCode} is not null)`,
    ),
  ],
);
