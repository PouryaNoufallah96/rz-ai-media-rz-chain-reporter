import type {
  AttemptOutcome,
  ErrorCode,
  PublicationFailureCode,
} from "@rz-chain-reporter/contracts";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

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
  claimFence: { claimedBy: string; expectedVersion?: number },
): Promise<(OperationAttemptRow & { operationVersion: number }) | null> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [parent] = await tx
      .select({
        claimedBy: operation.claimedBy,
        leaseExpiresAt: operation.leaseExpiresAt,
        lifecycle: operation.lifecycle,
        version: operation.version,
      })
      .from(operation)
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .for("update");
    if (!parent) {
      return null;
    }
    if (
      parent.claimedBy !== claimFence.claimedBy ||
      parent.lifecycle !== "running" ||
      parent.leaseExpiresAt === null ||
      parent.leaseExpiresAt <= new Date() ||
      (claimFence.expectedVersion !== undefined &&
        parent.version !== claimFence.expectedVersion)
    ) {
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
      return { ...existing, operationVersion: parent.version };
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
    return { ...attempt, operationVersion: parent.version };
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

export async function settleReconciliationOperationSuccess(
  executor: Executor,
  workspaceId: string,
  input: {
    attemptId: string;
    claimedBy: string;
    expectedVersion: number;
    operationId: string;
    providerResultId?: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const now = new Date();
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.commandType, "publishing:reconciliation"),
        ),
      )
      .for("update");
    if (!current) return null;
    if (current.lifecycle === "succeeded") {
      const [attempt] = await tx
        .select()
        .from(operationAttempt)
        .where(
          and(
            inWorkspace(operationAttempt, workspaceId),
            eq(operationAttempt.id, input.attemptId),
            eq(operationAttempt.operationId, input.operationId),
            eq(operationAttempt.outcome, "succeeded"),
          ),
        );
      return attempt ? { attempt, operation: current } : null;
    }
    if (
      current.claimedBy !== input.claimedBy ||
      current.version !== input.expectedVersion ||
      current.lifecycle !== "running" ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt <= now
    ) {
      return null;
    }

    const [attempt] = await tx
      .update(operationAttempt)
      .set({
        failureCode: null,
        outcome: "succeeded",
        providerResultId: input.providerResultId,
        updatedAt: now,
      })
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.attemptId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
        ),
      )
      .returning();
    if (!attempt) throw new Error("RECONCILIATION_ATTEMPT_SETTLEMENT_LOST");

    const [settled] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: "succeeded",
        updatedAt: now,
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, current.version),
          eq(operation.lifecycle, "running"),
        ),
      )
      .returning();
    if (!settled) throw new Error("RECONCILIATION_OPERATION_SETTLEMENT_LOST");
    return { attempt, operation: settled };
  });
}

export async function settleReconciliationOperationFailure(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string;
    failureCode: ErrorCode;
    operationId: string;
    now?: Date;
    providerFailureCode?: PublicationFailureCode;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const now = input.now ?? new Date();
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.commandType, "publishing:reconciliation"),
        ),
      )
      .for("update");
    if (!current) return null;

    if (
      current.lifecycle === "running" &&
      current.claimedBy === input.claimedBy
    ) {
      await tx
        .update(operationAttempt)
        .set({
          failureCode: input.failureCode,
          outcome: "failed_terminal",
          providerFailureCode: input.providerFailureCode,
          updatedAt: now,
        })
        .where(
          and(
            inWorkspace(operationAttempt, workspaceId),
            eq(operationAttempt.operationId, input.operationId),
            isNull(operationAttempt.outcome),
          ),
        );
      const [failed] = await tx
        .update(operation)
        .set({
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          lifecycle: "failed",
          updatedAt: now,
          version: current.version + 1,
        })
        .where(
          and(
            inWorkspace(operation, workspaceId),
            eq(operation.id, input.operationId),
            eq(operation.claimedBy, input.claimedBy),
            eq(operation.lifecycle, "running"),
            eq(operation.version, current.version),
          ),
        )
        .returning();
      if (!failed) return null;
    } else if (current.lifecycle !== "failed") {
      return null;
    }

    const [settledOperation] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.lifecycle, "failed"),
        ),
      );
    if (!settledOperation) return null;
    const [latestAttempt] = await tx
      .select({ outcome: operationAttempt.outcome })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
        ),
      )
      .orderBy(desc(operationAttempt.attemptNumber))
      .limit(1);
    return {
      attemptCount: settledOperation.attemptSeq,
      latestAttemptOutcome: latestAttempt?.outcome ?? undefined,
      operation: settledOperation,
    };
  });
}
