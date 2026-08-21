import {
  type Executor,
  withWorkspaceContext,
} from "@rz-chain-reporter/db/executor";
import { transitionOperation } from "@rz-chain-reporter/db/repositories/operation";
import {
  allocateOperationAttempt,
  settleOperationAttempt,
} from "@rz-chain-reporter/db/repositories/operation-attempt";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { and, eq } from "drizzle-orm";

import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { workerStorage } from "./media-storage";
import { verifyMediaUpload } from "./media-verification";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

type VerificationResult = Awaited<ReturnType<typeof verifyMediaUpload>>;

const succeeded = {
  lifecycle: "succeeded" as const,
  outcome: "succeeded" as const,
};

function outcomeOf(result: VerificationResult) {
  if (result.status === "verified") return succeeded;
  if (result.status === "replayed") {
    if (result.lifecycle === "verified") return succeeded;
    if (result.lifecycle !== "rejected" && result.lifecycle !== "expired") {
      throw new Error("media asset verification still in progress");
    }
  }
  if (result.status === "conflict") {
    throw new Error("media asset verification claimed concurrently");
  }
  return {
    lifecycle: "failed" as const,
    outcome: "failed_terminal" as const,
    failureCode:
      result.status === "not_found"
        ? ("NOT_FOUND" as const)
        : ("MEDIA_REJECTED" as const),
  };
}

async function settleMediaOperation(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  result: VerificationResult,
) {
  const settlement = outcomeOf(result);
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select({ lifecycle: operation.lifecycle, version: operation.version })
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, operationId),
        ),
      );
    if (current?.lifecycle !== "queued") return null;

    const running = await transitionOperation(tx, workspaceId, {
      id: operationId,
      version: current.version,
      from: "queued",
      to: "running",
    });
    if (running.status !== "updated") return null;

    const attempt = await allocateOperationAttempt(
      tx,
      workspaceId,
      operationId,
    );
    if (!attempt) {
      throw new Error("media operation attempt allocation returned no row");
    }
    await settleOperationAttempt(tx, workspaceId, {
      id: attempt.id,
      outcome: settlement.outcome,
      failureCode:
        "failureCode" in settlement ? settlement.failureCode : undefined,
    });

    if (settlement.lifecycle === "failed") {
      const failed = await transitionOperation(tx, workspaceId, {
        id: operationId,
        version: running.operation.version,
        from: "running",
        to: "failed",
      });
      return failed.status === "updated"
        ? { attemptCount: attempt.attemptNumber, operation: failed.operation }
        : null;
    }

    const settling = await transitionOperation(tx, workspaceId, {
      id: operationId,
      version: running.operation.version,
      from: "running",
      to: "settling",
    });
    if (settling.status !== "updated") return null;

    const completed = await transitionOperation(tx, workspaceId, {
      id: operationId,
      version: settling.operation.version,
      from: "settling",
      to: "succeeded",
    });
    return completed.status === "updated"
      ? { attemptCount: attempt.attemptNumber, operation: completed.operation }
      : null;
  });
}

export function createMediaUploadVerificationFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  return client.createFunction(
    {
      id: "media-upload-verification",
      concurrency: 2,
      retries: 2,
      triggers: [durableEvents.mediaUploadConfirmed],
    },
    async ({ event, step }) => {
      const settled = await step.run("verify-media-upload", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        const result = await verifyMediaUpload(
          runtime.db,
          workerStorage(),
          event.data.workspaceId,
          event.data.mediaAssetId,
        );
        const settlement = await settleMediaOperation(
          runtime.db,
          event.data.workspaceId,
          event.data.operationId,
          result,
        );
        return {
          attemptCount: settlement?.attemptCount ?? null,
          lifecycle: settlement?.operation.lifecycle ?? null,
          operationVersion: settlement?.operation.version ?? null,
          status: result.status,
        };
      });

      if (
        settled.lifecycle &&
        settled.operationVersion &&
        settled.attemptCount !== null
      ) {
        await publishOperationStatus(
          step,
          event.data.workspaceId,
          {
            attemptCount: settled.attemptCount,
            lifecycle: settled.lifecycle,
            operationId: event.data.operationId,
            operationVersion: settled.operationVersion,
          },
          "worker.media-verification.realtime-unavailable",
        );
      }

      return settled;
    },
  );
}
