import {
  type ErrorCode,
  errorCodeSchema,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { requeueStaleMediaValidation } from "@rz-chain-reporter/db/repositories/media-asset";
import { transitionOperation } from "@rz-chain-reporter/db/repositories/operation";
import {
  allocateOperationAttempt,
  settleOperationAttempt,
} from "@rz-chain-reporter/db/repositories/operation-attempt";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { workerLogger } from "../logging/logger";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { workerStorage } from "./media-storage";
import { verifyMediaUpload } from "./media-verification";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

type VerificationResult = Awaited<ReturnType<typeof verifyMediaUpload>>;

class MediaVerificationError extends Error {
  constructor(code: ErrorCode) {
    super(code);
    this.name = "MediaVerificationError";
  }
}

function failureCodeOf(value: unknown): ErrorCode {
  const message = value instanceof Error ? value.message : String(value ?? "");
  const parsed = errorCodeSchema.safeParse(message);
  return parsed.success ? parsed.data : "INTERNAL_SERVER_ERROR";
}

async function coded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const code = failureCodeOf(error);
    throw error instanceof NonRetriableError
      ? new NonRetriableError(code)
      : new MediaVerificationError(code);
  }
}

const succeeded = {
  lifecycle: "succeeded" as const,
  outcome: "succeeded" as const,
};

function failed(failureCode: ErrorCode) {
  return {
    lifecycle: "failed" as const,
    outcome: "failed_terminal" as const,
    failureCode,
  };
}

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
  return failed(result.status === "not_found" ? "NOT_FOUND" : "MEDIA_REJECTED");
}

async function settleMediaOperation(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  result: VerificationResult,
) {
  return settleMediaOperationOutcome(
    executor,
    workspaceId,
    operationId,
    outcomeOf(result),
  );
}

async function settleFailedMediaOperation(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  mediaAssetId: string,
  failureCode: ErrorCode,
) {
  return settleMediaOperationOutcome(
    executor,
    workspaceId,
    operationId,
    failed(failureCode),
    mediaAssetId,
  );
}

async function settleMediaOperationOutcome(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  settlement: ReturnType<typeof outcomeOf>,
  failedMediaAssetId?: string,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select({
        commandType: operation.commandType,
        idempotencyKey: operation.idempotencyKey,
        lifecycle: operation.lifecycle,
        version: operation.version,
      })
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, operationId),
        ),
      )
      .for("update");
    if (current?.lifecycle !== "queued") return null;

    let resolvedSettlement = settlement;
    if (failedMediaAssetId) {
      if (
        current.commandType !== MEDIA_UPLOAD_CONFIRMED_EVENT_NAME ||
        current.idempotencyKey !== failedMediaAssetId
      ) {
        return null;
      }
      const [asset] = await tx
        .select({
          id: mediaAsset.id,
          lifecycle: mediaAsset.lifecycle,
          version: mediaAsset.version,
        })
        .from(mediaAsset)
        .where(
          and(
            eq(mediaAsset.workspaceId, workspaceId),
            eq(mediaAsset.id, failedMediaAssetId),
          ),
        )
        .for("update");
      if (!asset) {
        resolvedSettlement = failed("NOT_FOUND");
      } else if (asset.lifecycle === "verified") {
        resolvedSettlement = succeeded;
      } else if (
        asset.lifecycle === "rejected" ||
        asset.lifecycle === "expired"
      ) {
        resolvedSettlement = failed("MEDIA_REJECTED");
      } else if (asset.lifecycle === "validating") {
        const requeued = await requeueStaleMediaValidation(tx, workspaceId, {
          id: asset.id,
          version: asset.version,
        });
        if (requeued.status !== "updated") {
          throw new Error("media validation requeue conflicted");
        }
      }
    }

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
    const settledAttempt = await settleOperationAttempt(tx, workspaceId, {
      id: attempt.id,
      outcome: resolvedSettlement.outcome,
      failureCode:
        "failureCode" in resolvedSettlement
          ? resolvedSettlement.failureCode
          : undefined,
    });
    if (!settledAttempt) {
      throw new Error("media operation attempt was already settled");
    }

    if (resolvedSettlement.lifecycle === "failed") {
      const failed = await transitionOperation(tx, workspaceId, {
        id: operationId,
        version: running.operation.version,
        from: "running",
        to: "failed",
      });
      return failed.status === "updated"
        ? {
            attemptCount: attempt.attemptNumber,
            latestAttemptOutcome: resolvedSettlement.outcome,
            operation: failed.operation,
          }
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
      ? {
          attemptCount: attempt.attemptNumber,
          latestAttemptOutcome: resolvedSettlement.outcome,
          operation: completed.operation,
        }
      : null;
  });
}

export function createMediaUploadVerificationFunction(
  client: WorkerInngestClient,
  runtime: Pick<WorkerRuntime, "db" | "identity">,
) {
  return client.createFunction(
    {
      id: "media-upload-verification",
      concurrency: 2,
      retries: 2,
      triggers: [durableEvents.mediaUploadConfirmed],
      onFailure: async ({ event, step }) => {
        const { mediaAssetId, operationId, workspaceId } =
          event.data.event.data;
        const failureCode = failureCodeOf(event.data.error.message);
        const settlement = await step.run("settle-failed-media-upload", () =>
          coded(() =>
            settleFailedMediaOperation(
              runtime.db,
              workspaceId,
              operationId,
              mediaAssetId,
              failureCode,
            ),
          ),
        );
        if (!settlement) return;

        workerLogger.warn("worker.media-verification.settled", {
          errorCode: failureCode,
          operationId,
          outcome: settlement.operation.lifecycle,
          workspaceId,
        });
        await publishOperationStatus(
          step,
          workspaceId,
          {
            attemptCount: settlement.attemptCount,
            latestAttemptOutcome: settlement.latestAttemptOutcome,
            lifecycle: settlement.operation.lifecycle,
            operationId,
            operationVersion: settlement.operation.version,
          },
          "worker.media-verification.realtime-unavailable",
        );
      },
    },
    async ({ event, step }) =>
      coded(async () => {
        const settled = await step.run("verify-media-upload", async () => {
          return coded(async () => {
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
              latestAttemptOutcome: settlement?.latestAttemptOutcome ?? null,
              lifecycle: settlement?.operation.lifecycle ?? null,
              operationVersion: settlement?.operation.version ?? null,
              status: result.status,
            };
          });
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
              latestAttemptOutcome: settled.latestAttemptOutcome ?? undefined,
              lifecycle: settled.lifecycle,
              operationId: event.data.operationId,
              operationVersion: settled.operationVersion,
            },
            "worker.media-verification.realtime-unavailable",
          );
        }

        return settled;
      }),
  );
}
