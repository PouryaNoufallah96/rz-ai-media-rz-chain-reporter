import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { approval } from "./approval";
import { user } from "./auth";
import { activityEventType } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { platformDraft } from "./platform-draft";
import { publication } from "./publication";
import { savedCard } from "./saved-card";
import { schedule } from "./schedule";
import { workspace } from "./workspace";

export const activityEvent = pgTable(
  "activity_event",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    actorId: text("actor_id"),
    eventType: activityEventType("event_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    platformDraftId: uuid("platform_draft_id"),
    savedCardId: uuid("saved_card_id"),
    approvalId: uuid("approval_id"),
    scheduleId: uuid("schedule_id"),
    publicationId: uuid("publication_id"),
    operationId: uuid("operation_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_activity_event_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_actor_id",
      columns: [t.actorId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_saved_card_id",
      columns: [t.savedCardId],
      foreignColumns: [savedCard.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_approval_id",
      columns: [t.approvalId],
      foreignColumns: [approval.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_schedule_id",
      columns: [t.scheduleId],
      foreignColumns: [schedule.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_activity_event_publication_id",
      columns: [t.publicationId],
      foreignColumns: [publication.id],
    }).onDelete("restrict"),
    unique("uq_activity_event_workspace_type_idempotency").on(
      t.workspaceId,
      t.eventType,
      t.idempotencyKey,
    ),
    index("ix_activity_event_workspace_actor_occurred_id").on(
      t.workspaceId,
      t.actorId,
      t.occurredAt.desc(),
      t.id.desc(),
    ),
  ],
);
