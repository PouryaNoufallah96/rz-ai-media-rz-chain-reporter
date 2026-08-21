import type { AttemptOutcome, ErrorCode } from "@rz-chain-reporter/contracts";
import { and, eq, sql } from "drizzle-orm";

import { type Executor, withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";

type OperationAttemptRow = typeof operationAttempt.$inferSelect;

export async function allocateOperationAttempt(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<OperationAttemptRow | null> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const [parent] = await tx
      .update(operation)
      .set({
        attemptSeq: sql`${operation.attemptSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .returning({ attemptNumber: operation.attemptSeq });

    if (!parent) {
      return null;
    }

    const [attempt] = await tx
      .insert(operationAttempt)
      .values({
        workspaceId,
        operationId,
        attemptNumber: parent.attemptNumber,
      })
      .returning();

    if (!attempt) {
      throw new Error("operation attempt insert returned no row");
    }

    return attempt;
  });
}

export type SettleOperationAttemptInput = {
  id: string;
  outcome: AttemptOutcome;
  failureCode?: ErrorCode | null;
  latencyMs?: number;
  providerResultId?: string;
};

export async function settleOperationAttempt(
  executor: Executor,
  workspaceId: string,
  input: SettleOperationAttemptInput,
): Promise<OperationAttemptRow | null> {
  const [settled] = await executor
    .update(operationAttempt)
    .set({
      failureCode: input.failureCode ?? null,
      latencyMs: input.latencyMs,
      outcome: input.outcome,
      providerResultId: input.providerResultId,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.id, input.id),
        sql`${operationAttempt.outcome} is null`,
      ),
    )
    .returning();

  return settled ?? null;
}
