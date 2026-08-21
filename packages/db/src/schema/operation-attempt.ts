import type { ErrorCode } from "@rz-chain-reporter/contracts";
import {
  foreignKey,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { attemptOutcome } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { workspace } from "./workspace";

export const operationAttempt = pgTable(
  "operation_attempt",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    operationId: uuid("operation_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    outcome: attemptOutcome("outcome"),
    failureCode: text("failure_code").$type<ErrorCode>(),
    providerResultId: text("provider_result_id"),
    latencyMs: integer("latency_ms"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_operation_attempt_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_operation_attempt_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("cascade"),
    unique("uq_operation_attempt_workspace_id_operation_id_attempt_number").on(
      t.workspaceId,
      t.operationId,
      t.attemptNumber,
    ),
  ],
);
