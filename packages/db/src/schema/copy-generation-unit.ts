import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { copyGeneration } from "./copy-generation";
import { modelUnitStatus } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

export const copyGenerationUnit = pgTable(
  "copy_generation_unit",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    copyGenerationId: uuid("copy_generation_id").notNull(),
    variantKey: text("variant_key").notNull(),
    status: modelUnitStatus("status").default("pending").notNull(),
    operationAttemptId: uuid("operation_attempt_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_copy_generation_unit_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_unit_copy_generation_id",
      columns: [t.copyGenerationId],
      foreignColumns: [copyGeneration.operationId],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_unit_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique("uq_copy_generation_unit_workspace_generation_variant_key").on(
      t.workspaceId,
      t.copyGenerationId,
      t.variantKey,
    ),
    unique("uq_copy_generation_unit_operation_attempt_id").on(
      t.operationAttemptId,
    ),
    check(
      "ck_copy_generation_unit_status_attempt_consistent",
      sql`(${t.status} = 'pending' and ${t.operationAttemptId} is null) or (${t.status} in ('running', 'succeeded', 'failed') and ${t.operationAttemptId} is not null) or ${t.status} = 'cancelled'`,
    ),
  ],
);
