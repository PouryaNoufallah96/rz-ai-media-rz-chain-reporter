import {
  and,
  asc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { type Executor, withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { outboxEvent } from "../schema/outbox-event";

type OutboxEventRow = typeof outboxEvent.$inferSelect;

const MAX_CLAIM_BATCH = 100;

export type ClaimOutboxEventsInput = {
  claimedBy: string;
  leaseDurationMs: number;
  limit: number;
  now?: Date;
};

export async function claimOutboxEvents(
  executor: Executor,
  workspaceId: string,
  input: ClaimOutboxEventsInput,
): Promise<OutboxEventRow[]> {
  if (
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_CLAIM_BATCH
  ) {
    throw new Error("invalid outbox claim limit");
  }
  if (!Number.isInteger(input.leaseDurationMs) || input.leaseDurationMs < 1) {
    throw new Error("invalid outbox lease duration");
  }

  const now = input.now ?? new Date();
  const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs);

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const candidates = await tx
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          isNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
          lte(outboxEvent.nextAttemptAt, now),
          or(
            isNull(outboxEvent.dispatchLeaseExpiresAt),
            lte(outboxEvent.dispatchLeaseExpiresAt, now),
          ),
        ),
      )
      .orderBy(asc(outboxEvent.nextAttemptAt), asc(outboxEvent.id))
      .limit(input.limit)
      .for("update", { skipLocked: true });

    if (candidates.length === 0) {
      return [];
    }

    return tx
      .update(outboxEvent)
      .set({
        dispatchClaimedBy: input.claimedBy,
        dispatchClaimedAt: now,
        dispatchLeaseExpiresAt: leaseExpiresAt,
        dispatchAttemptCount: sql`${outboxEvent.dispatchAttemptCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          inArray(
            outboxEvent.id,
            candidates.map(({ id }) => id),
          ),
        ),
      )
      .returning();
  });
}

export type OwnedOutboxMutationResult =
  | { status: "updated"; event: OutboxEventRow }
  | { status: "not_owned" };

export async function markOutboxDispatched(
  executor: Executor,
  workspaceId: string,
  input: { id: string; claimedBy: string; acceptedAt?: Date },
): Promise<OwnedOutboxMutationResult> {
  const acceptedAt = input.acceptedAt ?? new Date();

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [updated] = await tx
      .update(outboxEvent)
      .set({
        dispatchedAt: acceptedAt,
        dispatchClaimedBy: null,
        dispatchClaimedAt: null,
        dispatchLeaseExpiresAt: null,
        updatedAt: acceptedAt,
      })
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          eq(outboxEvent.id, input.id),
          eq(outboxEvent.dispatchClaimedBy, input.claimedBy),
          gt(outboxEvent.dispatchLeaseExpiresAt, acceptedAt),
          isNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
        ),
      )
      .returning();

    return updated
      ? { status: "updated", event: updated }
      : { status: "not_owned" };
  });
}

export async function markOutboxFailed(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    claimedBy: string;
    errorCode: string;
    nextAttemptAt: Date;
    exhausted: boolean;
    failedAt?: Date;
  },
): Promise<OwnedOutboxMutationResult> {
  const failedAt = input.failedAt ?? new Date();

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [updated] = await tx
      .update(outboxEvent)
      .set({
        dispatchClaimedBy: null,
        dispatchClaimedAt: null,
        dispatchLeaseExpiresAt: null,
        nextAttemptAt: input.nextAttemptAt,
        lastErrorCode: input.errorCode,
        lastErrorAt: failedAt,
        exhaustedAt: input.exhausted ? failedAt : null,
        updatedAt: failedAt,
      })
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          eq(outboxEvent.id, input.id),
          eq(outboxEvent.dispatchClaimedBy, input.claimedBy),
          gt(outboxEvent.dispatchLeaseExpiresAt, failedAt),
          isNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
        ),
      )
      .returning();

    return updated
      ? { status: "updated", event: updated }
      : { status: "not_owned" };
  });
}

export async function rearmOutboxEvent(
  executor: Executor,
  workspaceId: string,
  input: { id: string; rearmedAt?: Date },
): Promise<OutboxEventRow | null> {
  const rearmedAt = input.rearmedAt ?? new Date();

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [updated] = await tx
      .update(outboxEvent)
      .set({
        dispatchClaimedBy: null,
        dispatchClaimedAt: null,
        dispatchLeaseExpiresAt: null,
        nextAttemptAt: rearmedAt,
        lastErrorCode: null,
        lastErrorAt: null,
        exhaustedAt: null,
        updatedAt: rearmedAt,
      })
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          eq(outboxEvent.id, input.id),
          isNull(outboxEvent.dispatchedAt),
          isNotNull(outboxEvent.exhaustedAt),
        ),
      )
      .returning();

    return updated ?? null;
  });
}
