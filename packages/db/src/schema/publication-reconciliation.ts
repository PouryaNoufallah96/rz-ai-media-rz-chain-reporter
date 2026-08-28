import {
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { reconciliationAuthority, reconciliationDecision } from "./enums";
import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { operationAttempt } from "./operation-attempt";
import { publication } from "./publication";
import { publishCheckpoint } from "./publish-checkpoint";
import { workspace } from "./workspace";

export const publicationReconciliation = pgTable(
  "publication_reconciliation",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    publicationId: uuid("publication_id").notNull(),
    ambiguousAttemptId: uuid("ambiguous_attempt_id").notNull(),
    actorId: text("actor_id"),
    authority: reconciliationAuthority("authority").notNull(),
    decision: reconciliationDecision("decision").notNull(),
    evidenceCheckpointId: uuid("evidence_checkpoint_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_publication_reconciliation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_reconciliation_publication_id",
      columns: [t.publicationId],
      foreignColumns: [publication.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_reconciliation_attempt_id",
      columns: [t.ambiguousAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_reconciliation_actor_id",
      columns: [t.actorId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publication_reconciliation_checkpoint_id",
      columns: [t.evidenceCheckpointId],
      foreignColumns: [publishCheckpoint.id],
    }).onDelete("restrict"),
    unique("uq_publication_reconciliation_identity").on(
      t.workspaceId,
      t.actorId,
      t.idempotencyKey,
    ),
    index("ix_publication_reconciliation_workspace_publication_occurred_id").on(
      t.workspaceId,
      t.publicationId,
      t.occurredAt,
      t.id,
    ),
  ],
);
