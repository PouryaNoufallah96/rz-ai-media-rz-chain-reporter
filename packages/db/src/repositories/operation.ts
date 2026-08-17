import type {
  ErrorCode,
  OperationLifecycle,
} from "@rz-chain-reporter/contracts";
import { and, eq } from "drizzle-orm";

import { classifyDbError } from "../db-error";
import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import type { platform } from "../schema/enums";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { publishOperation } from "../schema/publish-operation";

type OperationRow = typeof operation.$inferSelect;
type Platform = (typeof platform.enumValues)[number];

export type CreateOperationInput = {
  actor: string;
  commandType: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  publish: { platform: Platform; draftRevisionId: string };
  event: {
    type: string;
    schemaVersion: number;
    payload: Record<string, string>;
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
      created = await insertOperation(tx, workspaceId, input);
    } catch (error) {
      if (classifyDbError(error)?.kind !== "operation_identity") {
        throw error;
      }
      return resolveIdentityConflict(tx, workspaceId, input, error);
    }

    await tx.insert(publishOperation).values({
      operationId: created.id,
      workspaceId,
      platform: input.publish.platform,
      draftRevisionId: input.publish.draftRevisionId,
    });

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

// The identity insert runs in its own savepoint because a 23505 aborts the
// enclosing transaction, and the stored request_hash still has to be read from
// it to tell a replay from a changed payload.
async function insertOperation(
  tx: Transaction,
  workspaceId: string,
  input: CreateOperationInput,
) {
  const [created] = await tx.transaction((savepoint) =>
    savepoint
      .insert(operation)
      .values({
        workspaceId,
        actor: input.actor,
        commandType: input.commandType,
        idempotencyKey: input.idempotencyKey,
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

async function resolveIdentityConflict(
  tx: Transaction,
  workspaceId: string,
  input: CreateOperationInput,
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

// OPERATION-VOCABULARY §1.2. A pair outside this table is a caller defect, not
// a client error: §5.2 gives it no public code.
const LEGAL_TRANSITIONS: Record<
  OperationLifecycle,
  readonly OperationLifecycle[]
> = {
  queued: ["running", "cancelled"],
  running: ["settling", "queued", "failed", "unknown", "cancelled"],
  settling: ["succeeded", "failed"],
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
