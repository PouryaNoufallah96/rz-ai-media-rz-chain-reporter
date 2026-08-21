import { sql } from "drizzle-orm";
import {
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { workspace } from "./workspace";

// Phase 4 owns the dispatcher and revalidates payloads against schema_version.
export const outboxEvent = pgTable(
  "outbox_event",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    operationId: uuid("operation_id").notNull(),
    eventType: text("event_type").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    payload: jsonb("payload").notNull(),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    dispatchClaimedBy: text("dispatch_claimed_by"),
    dispatchClaimedAt: timestamp("dispatch_claimed_at", { withTimezone: true }),
    dispatchLeaseExpiresAt: timestamp("dispatch_lease_expires_at", {
      withTimezone: true,
    }),
    dispatchAttemptCount: integer("dispatch_attempt_count")
      .default(0)
      .notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastErrorCode: text("last_error_code"),
    lastErrorAt: timestamp("last_error_at", { withTimezone: true }),
    exhaustedAt: timestamp("exhausted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_outbox_event_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_outbox_event_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    index("ix_outbox_event_next_attempt_at_undispatched")
      .on(t.nextAttemptAt)
      .where(sql`${t.dispatchedAt} is null and ${t.exhaustedAt} is null`),
  ],
);
