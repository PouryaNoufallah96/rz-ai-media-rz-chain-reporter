import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import {
  checkpointEvidenceAuthority,
  platform,
  publishCheckpointKind,
} from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { publication } from "./publication";
import { workspace } from "./workspace";

export const publishCheckpoint = pgTable(
  "publish_checkpoint",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    publicationId: uuid("publication_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    operationAttemptId: uuid("operation_attempt_id").notNull(),
    platform: platform("platform").notNull(),
    kind: publishCheckpointKind("kind").notNull(),
    providerReferenceId: text("provider_reference_id").notNull(),
    evidenceAuthority: checkpointEvidenceAuthority("evidence_authority")
      .default("provider")
      .notNull(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_publish_checkpoint_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_checkpoint_publication_id",
      columns: [t.publicationId],
      foreignColumns: [publication.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_checkpoint_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publish_checkpoint_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique("uq_publish_checkpoint_workspace_attempt_kind").on(
      t.workspaceId,
      t.operationAttemptId,
      t.kind,
    ),
    index("ix_publish_checkpoint_workspace_publication_observed").on(
      t.workspaceId,
      t.publicationId,
      t.observedAt,
    ),
    check(
      "ck_publish_checkpoint_kind_platform",
      sql`(${t.platform} = 'telegram' and ${t.kind} = 'telegram_message') or (${t.platform} = 'x' and ${t.kind} in ('x_media', 'x_post')) or (${t.platform} = 'instagram' and ${t.kind} in ('instagram_grant', 'instagram_container', 'instagram_media'))`,
    ),
  ],
);
