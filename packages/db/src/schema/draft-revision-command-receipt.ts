import { sql } from "drizzle-orm";
import {
  boolean,
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
import { draftRevisionCommandKind } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { platformDraft } from "./platform-draft";
import { workspace } from "./workspace";

export const draftRevisionCommandReceipt = pgTable(
  "draft_revision_command_receipt",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    actorId: text("actor_id").notNull(),
    platformDraftId: uuid("platform_draft_id").notNull(),
    commandKind: draftRevisionCommandKind("command_kind").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    resultingDraftRevisionId: uuid("resulting_draft_revision_id").notNull(),
    appendedRevision: boolean("appended_revision").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_draft_revision_command_receipt_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_command_receipt_actor_id",
      columns: [t.actorId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_command_receipt_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_draft_revision_command_receipt_resulting_draft_revision_id",
      columns: [t.resultingDraftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    unique("uq_draft_revision_command_receipt_identity").on(
      t.workspaceId,
      t.actorId,
      t.commandKind,
      t.idempotencyKey,
    ),
    check(
      "ck_draft_revision_command_receipt_idempotency_key_nonempty",
      sql`btrim(${t.idempotencyKey}) <> ''`,
    ),
    check(
      "ck_draft_revision_command_receipt_request_hash_nonempty",
      sql`btrim(${t.requestHash}) <> ''`,
    ),
  ],
);
