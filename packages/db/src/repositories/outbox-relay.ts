import { SOURCE_IMPORT_COMMAND_PREFIX } from "@rz-chain-reporter/contracts";
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

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";

type OutboxEventRow = typeof outboxEvent.$inferSelect;
type ClaimedOutboxEventRow = OutboxEventRow & {
  actorId: string;
  sharedImport: boolean;
};

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
): Promise<ClaimedOutboxEventRow[]> {
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

    const claimed = await tx
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

    const audiences = await tx
      .select({
        actorId: operation.actor,
        commandType: operation.commandType,
        operationId: operation.id,
      })
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          inArray(
            operation.id,
            claimed.map((event) => event.operationId),
          ),
        ),
      );
    const audienceByOperationId = new Map(
      audiences.map((audience) => [audience.operationId, audience]),
    );

    return claimed.map((event) => {
      const audience = audienceByOperationId.get(event.operationId);
      if (!audience) throw new Error("claimed outbox operation not found");
      return {
        ...event,
        actorId: audience.actorId,
        sharedImport: audience.commandType.startsWith(
          SOURCE_IMPORT_COMMAND_PREFIX,
        ),
      };
    });
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
  return executor.transaction((tx) =>
    rearmOutboxEventInTransaction(tx, workspaceId, input),
  );
}

export async function rearmOutboxEventInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: { id: string; rearmedAt?: Date },
): Promise<OutboxEventRow | null> {
  const rearmedAt = input.rearmedAt ?? new Date();
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
}
