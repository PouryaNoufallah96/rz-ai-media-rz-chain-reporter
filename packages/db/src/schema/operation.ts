import {
  foreignKey,
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

// The command intent and idempotency root. request_hash is stored beside the
// identity tuple and deliberately outside it: the 23505 fires first, then the
// use case compares the stored hash to tell a replay from a same-key changed
// payload. Inside the constraint, that retry would insert and execute a second
// operation -- the duplicate-publish defect this table exists to correct.
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
  ],
);
