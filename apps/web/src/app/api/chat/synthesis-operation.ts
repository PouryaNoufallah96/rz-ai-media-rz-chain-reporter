import "server-only";

import { randomUUID } from "node:crypto";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import {
  insertOperationIdentity,
  transitionOperation,
} from "@rz-chain-reporter/db/repositories/operation";
import {
  allocateOperationAttemptInTransaction,
  settleOperationAttempt,
} from "@rz-chain-reporter/db/repositories/operation-attempt";

import { ASSISTANT_SYNTHESIS_COMMAND_TYPE } from "@/features/assistant/constants";

export type SynthesisOperation = {
  attemptId: string;
  operationId: string;
  version: number;
};

// Request-scoped and content-free: the identity material is a fresh opaque id,
// never the question, Card text, excerpt, or a content-derived hash.
export async function openSynthesisOperation(
  executor: Executor,
  workspaceId: string,
  actor: string,
): Promise<SynthesisOperation> {
  const requestId = randomUUID();

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const operation = await insertOperationIdentity(tx, workspaceId, {
      actor,
      commandType: ASSISTANT_SYNTHESIS_COMMAND_TYPE,
      idempotencyKey: requestId,
      lifecycle: "running",
      requestHash: requestId,
      requestId,
    });

    const attempt = await allocateOperationAttemptInTransaction(
      tx,
      workspaceId,
      operation.id,
    );

    if (!attempt) {
      throw new Error("assistant synthesis attempt was not allocated");
    }

    return {
      attemptId: attempt.id,
      operationId: operation.id,
      version: operation.version,
    };
  });
}

export async function closeSynthesisOperation(
  executor: Executor,
  workspaceId: string,
  operation: SynthesisOperation,
  succeeded: boolean,
) {
  await settleOperationAttempt(executor, workspaceId, {
    id: operation.attemptId,
    outcome: succeeded ? "succeeded" : "failed_terminal",
  });

  const settling = await transitionOperation(executor, workspaceId, {
    id: operation.operationId,
    version: operation.version,
    from: "running",
    to: succeeded ? "settling" : "failed",
  });

  if (!succeeded || settling.status !== "updated") {
    return;
  }

  await transitionOperation(executor, workspaceId, {
    id: operation.operationId,
    version: settling.operation.version,
    from: "settling",
    to: "succeeded",
  });
}
