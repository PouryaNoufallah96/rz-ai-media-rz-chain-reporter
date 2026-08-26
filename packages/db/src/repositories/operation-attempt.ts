import type { AttemptOutcome, ErrorCode } from "@rz-chain-reporter/contracts";
import { and, eq, gt, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
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
    return allocateOperationAttemptInTransaction(tx, workspaceId, operationId);
  });
}

export async function allocateOperationAttemptWithId(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  attemptId: string,
): Promise<OperationAttemptRow | null> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [parent] = await tx
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .for("update");
    if (!parent) {
      return null;
    }

    const [existing] = await tx
      .select()
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, attemptId),
          eq(operationAttempt.operationId, operationId),
        ),
      );
    if (existing) {
      return existing;
    }

    const [numbered] = await tx
      .update(operation)
      .set({
        attemptSeq: sql`${operation.attemptSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .returning({ attemptNumber: operation.attemptSeq });
    if (!numbered) {
      return null;
    }

    const [attempt] = await tx
      .insert(operationAttempt)
      .values({
        id: attemptId,
        workspaceId,
        operationId,
        attemptNumber: numbered.attemptNumber,
      })
      .returning();
    if (!attempt) {
      throw new Error("operation attempt insert returned no row");
    }
    return attempt;
  });
}

export async function allocateOperationAttemptInTransaction(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
): Promise<OperationAttemptRow | null> {
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
}

export type SettleOperationAttemptInput = {
  id: string;
  outcome: AttemptOutcome;
  failureCode?: ErrorCode | null;
  latencyMs?: number;
  providerResultId?: string;
  claimFence?: {
    claimedBy: string;
    expectedVersion: number;
    operationId: string;
  };
};

export async function settleOperationAttempt(
  executor: Executor,
  workspaceId: string,
  input: SettleOperationAttemptInput,
): Promise<OperationAttemptRow | null> {
  const claimFence = input.claimFence;
  if (claimFence) {
    return executor.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      const now = new Date();
      const [current] = await tx
        .select({ id: operation.id })
        .from(operation)
        .where(
          and(
            inWorkspace(operation, workspaceId),
            eq(operation.id, claimFence.operationId),
            eq(operation.claimedBy, claimFence.claimedBy),
            eq(operation.version, claimFence.expectedVersion),
            eq(operation.lifecycle, "running"),
            gt(operation.leaseExpiresAt, now),
          ),
        )
        .for("update");
      if (!current) return null;

      const [settled] = await tx
        .update(operationAttempt)
        .set({
          failureCode: input.failureCode ?? null,
          latencyMs: input.latencyMs,
          outcome: input.outcome,
          providerResultId: input.providerResultId,
          updatedAt: now,
        })
        .where(
          and(
            inWorkspace(operationAttempt, workspaceId),
            eq(operationAttempt.id, input.id),
            eq(operationAttempt.operationId, claimFence.operationId),
            sql`${operationAttempt.outcome} is null`,
          ),
        )
        .returning();

      return settled ?? null;
    });
  }

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
