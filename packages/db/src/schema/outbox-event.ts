import {
  foreignKey,
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

// The effect record committed in the same transaction as the state change.
// Payloads carry opaque identifiers only -- never prompts, article bodies,
// generated content, credentials, or base64. Phase 4 owns the dispatcher and
// revalidates a payload against its schema_version before acting on it.
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
    attemptCount: integer("attempt_count").default(0).notNull(),
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
  ],
);
