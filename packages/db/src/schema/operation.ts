import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { operationLifecycle } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

export const operation = pgTable(
  "operation",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    actor: text("actor").notNull(),
    commandType: text("command_type").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    requestHash: text("request_hash").notNull(),
    lifecycle: operationLifecycle("lifecycle").default("queued").notNull(),
    effectiveAt: timestamp("effective_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    requestId: text("request_id"),
    claimedBy: text("claimed_by"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptSeq: integer("attempt_seq").default(0).notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_operation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_operation_actor",
      columns: [t.actor],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    unique("uq_operation_workspace_id_actor_command_type_idempotency_key").on(
      t.workspaceId,
      t.actor,
      t.commandType,
      t.idempotencyKey,
    ),
    index("ix_operation_workspace_lifecycle_lease").on(
      t.workspaceId,
      t.lifecycle,
      t.leaseExpiresAt,
    ),
  ],
);
