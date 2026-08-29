import type {
  ErrorCode,
  OperationLifecycle,
} from "@rz-chain-reporter/contracts";
import { and, eq, gt, inArray, isNull, lt, or } from "drizzle-orm";

import { classifyDbError } from "../db-error";
import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";

type OperationRow = typeof operation.$inferSelect;

export type OperationIdentityInput = {
  operationId?: string;
  actor: string;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  lifecycle?: OperationLifecycle;
};

export type CreateOperationInput = OperationIdentityInput & {
  event: {
    type: string;
    schemaVersion: number;
    payload: Record<string, string | number>;
  };
};

export type CreateOperationResult =
  | { status: "created"; operation: OperationRow }
  | { status: "replayed"; operation: OperationRow }
  | { status: "mismatch" };

export async function createOperation(
  executor: Executor,
  workspaceId: string,
  input: CreateOperationInput,
): Promise<CreateOperationResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    let created: OperationRow;
    try {
      created = await insertOperationIdentity(tx, workspaceId, input);
    } catch (error) {
      if (classifyDbError(error)?.kind !== "operation_identity") {
        throw error;
      }
      return resolveOperationIdentityConflict(tx, workspaceId, input, error);
    }

    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId: created.id,
      eventType: input.event.type,
      schemaVersion: input.event.schemaVersion,
      payload: input.event.payload,
    });

    return { status: "created", operation: created };
  });
}

// Isolate the identity insert because 23505 aborts its transaction; the caller
// must still read `request_hash` to distinguish replay from changed payload.
export async function insertOperationIdentity(
  tx: Transaction,
  workspaceId: string,
  input: OperationIdentityInput,
) {
  const [created] = await tx.transaction((savepoint) =>
    savepoint
      .insert(operation)
      .values({
        id: input.operationId,
        workspaceId,
        actor: input.actor,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
        lifecycle: input.lifecycle,
        requestHash: input.requestHash,
        requestId: input.requestId,
      })
      .returning(),
  );

  if (!created) {
    throw new Error("operation insert returned no row");
  }

  return created;
}

export async function resolveOperationIdentityConflict(
  tx: Transaction,
  workspaceId: string,
  input: OperationIdentityInput,
  conflict: unknown,
): Promise<CreateOperationResult> {
  const [existing] = await tx
    .select()
    .from(operation)
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.actor, input.actor),
        eq(operation.commandType, input.commandType),
        eq(operation.idempotencyKey, input.idempotencyKey),
      ),
    );

  if (!existing) {
    throw conflict;
  }

  return existing.requestHash === input.requestHash
    ? { status: "replayed", operation: existing }
    : { status: "mismatch" };
}

export async function readOperationIdentity(
  tx: Executor | Transaction,
  workspaceId: string,
  input: Pick<
    OperationIdentityInput,
    "actor" | "commandType" | "idempotencyKey"
  >,
) {
  const [existing] = await tx
    .select()
    .from(operation)
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.actor, input.actor),
        eq(operation.commandType, input.commandType),
        eq(operation.idempotencyKey, input.idempotencyKey),
      ),
    );

  return existing ?? null;
}

// An illegal lifecycle pair is a caller defect, not a public error.
const LEGAL_TRANSITIONS: Record<
  OperationLifecycle,
  readonly OperationLifecycle[]
> = {
  queued: ["running", "cancelled"],
  running: ["settling", "queued", "failed", "unknown", "cancelled"],
  settling: ["succeeded", "failed", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: [],
  unknown: [],
};

export type TransitionOperationInput = {
  id: string;
  version: number;
  from: OperationLifecycle;
  to: OperationLifecycle;
};

export type TransitionOperationResult =
  | { status: "updated"; operation: OperationRow }
  | {
      status: "rejected";
      code: Extract<ErrorCode, "NOT_FOUND" | "VERSION_CONFLICT">;
    };

export async function transitionOperation(
  executor: Executor,
  workspaceId: string,
  input: TransitionOperationInput,
): Promise<TransitionOperationResult> {
  if (!LEGAL_TRANSITIONS[input.from].includes(input.to)) {
    throw new Error(
      `illegal operation transition ${input.from} -> ${input.to}`,
    );
  }

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const [updated] = await tx
      .update(operation)
      .set({ lifecycle: input.to, version: input.version + 1 })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.id),
          eq(operation.lifecycle, input.from),
          eq(operation.version, input.version),
        ),
      )
      .returning();

    if (updated) {
      return { status: "updated", operation: updated };
    }

    const [current] = await tx
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, input.id)),
      );

    return {
      status: "rejected",
      code: current ? "VERSION_CONFLICT" : "NOT_FOUND",
    };
  });
}

export type OperationClaimResult =
  | { status: "claimed"; operation: OperationRow }
  | { status: "busy"; operation: OperationRow }
  | { status: "terminal"; operation: OperationRow }
  | { status: "not_found" };

export async function claimOperationExecution(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    claimedBy: string;
    now: Date;
    leaseExpiresAt: Date;
  },
): Promise<OperationClaimResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, input.id)),
      )
      .for("update");
    if (!current) return { status: "not_found" };
    if (
      !(["queued", "running"] as const).includes(
        current.lifecycle as "queued" | "running",
      )
    ) {
      return { status: "terminal", operation: current };
    }
    if (
      current.claimedBy !== null &&
      current.claimedBy !== input.claimedBy &&
      current.leaseExpiresAt !== null &&
      current.leaseExpiresAt > input.now
    ) {
      return { status: "busy", operation: current };
    }
    const [claimed] = await tx
      .update(operation)
      .set({
        claimedAt: input.now,
        claimedBy: input.claimedBy,
        leaseExpiresAt: input.leaseExpiresAt,
        lifecycle: "running",
        updatedAt: input.now,
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.id),
          eq(operation.version, current.version),
          or(
            isNull(operation.claimedBy),
            eq(operation.claimedBy, input.claimedBy),
            lt(operation.leaseExpiresAt, input.now),
          ),
        ),
      )
      .returning();
    return claimed
      ? { status: "claimed", operation: claimed }
      : { status: "busy", operation: current };
  });
}

export async function renewOperationClaim(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    claimedBy: string;
    expectedVersion: number;
    leaseExpiresAt: Date;
    now: Date;
  },
) {
  const [updated] = await executor
    .update(operation)
    .set({
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.id),
        eq(operation.claimedBy, input.claimedBy),
        eq(operation.version, input.expectedVersion),
        gt(operation.leaseExpiresAt, input.now),
        inArray(operation.lifecycle, ["running", "settling"]),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function settleClaimedOperation(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    claimedBy: string;
    expectedVersion: number;
    lifecycle: Extract<
      OperationLifecycle,
      "cancelled" | "failed" | "succeeded" | "unknown"
    >;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const [updated] = await executor
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle: input.lifecycle,
      updatedAt: now,
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.id),
        eq(operation.claimedBy, input.claimedBy),
        eq(operation.version, input.expectedVersion),
        gt(operation.leaseExpiresAt, now),
        inArray(operation.lifecycle, ["running", "settling"]),
      ),
    )
    .returning();
  return updated ?? null;
}
