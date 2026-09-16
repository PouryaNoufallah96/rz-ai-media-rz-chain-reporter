import { createHash } from "node:crypto";
import {
  type ErrorCode,
  errorCodeSchema,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { requeueStaleMediaValidation } from "@rz-chain-reporter/db/repositories/media-asset";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import type { Storage } from "@rz-chain-reporter/storage";
import { and, desc, eq, isNull, ne, or, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { workerLogger } from "../logging/logger";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { workerStorage } from "./media-storage";
import { verifyMediaUpload } from "./media-verification";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

type VerificationResult = Awaited<ReturnType<typeof verifyMediaUpload>>;

const CLAIM_LEASE_MS = 15 * 60_000;

function claimant(runId: string) {
  return `media-upload-verification:${runId}`;
}

function attemptIdentity(operationId: string, runId: string, attempt: number) {
  const hex = createHash("sha256")
    .update(`${operationId}:${runId}:${attempt}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

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

async function prepareMediaVerificationAttempt(
  executor: Executor,
  workspaceId: string,
  input: {
    attemptId: string;
    claimedBy: string;
    mediaAssetId: string;
    operationId: string;
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
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, input.operationId),
        ),
      )
      .for("update");
    if (!current) return { status: "not_found" as const };
    if (
      current.commandType !== MEDIA_UPLOAD_CONFIRMED_EVENT_NAME ||
      current.idempotencyKey !== input.mediaAssetId
    ) {
      throw new NonRetriableError("VALIDATION_FAILED");
    }
    if (current.lifecycle !== "queued" && current.lifecycle !== "running") {
      const [latestAttempt] = await tx
        .select({ outcome: operationAttempt.outcome })
        .from(operationAttempt)
        .where(
          and(
            eq(operationAttempt.workspaceId, workspaceId),
            eq(operationAttempt.operationId, input.operationId),
          ),
        )
        .orderBy(desc(operationAttempt.attemptNumber))
        .limit(1);
      return {
        status: "terminal" as const,
        actor: current.actor,
        attemptCount: current.attemptSeq,
        latestAttemptOutcome: latestAttempt?.outcome ?? null,
        lifecycle: current.lifecycle,
        operationVersion: current.version,
      };
    }
    if (
      current.claimedBy !== null &&
      current.claimedBy !== input.claimedBy &&
      current.leaseExpiresAt !== null &&
      current.leaseExpiresAt > now
    ) {
      return { status: "busy" as const };
    }

    const [existingAttempt] = await tx
      .select()
      .from(operationAttempt)
      .where(
        and(
          eq(operationAttempt.workspaceId, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
          eq(operationAttempt.id, input.attemptId),
        ),
      );
    if (existingAttempt?.outcome) {
      throw new Error("media operation attempt was already settled");
    }

    const [claimed] = await tx
      .update(operation)
      .set({
        claimedAt: now,
        claimedBy: input.claimedBy,
        leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        lifecycle: "running",
        updatedAt: now,
        version: current.version + 1,
      })
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, current.version),
          or(
            isNull(operation.claimedBy),
            eq(operation.claimedBy, input.claimedBy),
            isNull(operation.leaseExpiresAt),
            sql`${operation.leaseExpiresAt} <= ${now}`,
          ),
        ),
      )
      .returning();
    if (!claimed) throw new Error("TRANSIENT_CONFLICT");

    await tx
      .update(operationAttempt)
      .set({
        failureCode: "INTERNAL_SERVER_ERROR",
        outcome: "failed_retryable",
        updatedAt: now,
      })
      .where(
        and(
          eq(operationAttempt.workspaceId, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
          ne(operationAttempt.id, input.attemptId),
        ),
      );

    let activeAttempt = existingAttempt;
    if (!activeAttempt) {
      const [numbered] = await tx
        .update(operation)
        .set({
          attemptSeq: sql`${operation.attemptSeq} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(operation.workspaceId, workspaceId),
            eq(operation.id, input.operationId),
          ),
        )
        .returning({ attemptNumber: operation.attemptSeq });
      if (!numbered)
        throw new Error("media operation attempt numbering failed");
      const [created] = await tx
        .insert(operationAttempt)
        .values({
          id: input.attemptId,
          workspaceId,
          operationId: input.operationId,
          attemptNumber: numbered.attemptNumber,
        })
        .returning();
      if (!created)
        throw new Error("media operation attempt allocation failed");
      activeAttempt = created;
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
          eq(mediaAsset.id, input.mediaAssetId),
        ),
      )
      .for("update");
    if (asset?.lifecycle === "validating") {
      const requeued = await requeueStaleMediaValidation(tx, workspaceId, {
        id: asset.id,
        version: asset.version,
        changedAt: now,
      });
      if (requeued.status !== "updated") {
        throw new Error("media validation requeue conflicted");
      }
    }

    return {
      status: "claimed" as const,
      actor: claimed.actor,
      attemptId: activeAttempt.id,
      attemptNumber: activeAttempt.attemptNumber,
      operationVersion: claimed.version,
    };
  });
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
  input: {
    attemptId: string;
    claimedBy: string;
    mediaAssetId: string;
    operationId: string;
    operationVersion: number;
  },
  result: VerificationResult,
) {
  return settleMediaOperationOutcome(
    executor,
    workspaceId,
    input,
    outcomeOf(result),
  );
}

async function settleFailedMediaOperation(
  executor: Executor,
  workspaceId: string,
  input: {
    attemptId: string;
    claimedBy: string;
    mediaAssetId: string;
    operationId: string;
  },
  failureCode: ErrorCode,
) {
  return settleMediaOperationOutcome(
    executor,
    workspaceId,
    input,
    failed(failureCode),
    true,
  );
}

async function settleMediaOperationOutcome(
  executor: Executor,
  workspaceId: string,
  input: {
    attemptId: string;
    claimedBy: string;
    mediaAssetId: string;
    operationId: string;
    operationVersion?: number;
  },
  settlement: ReturnType<typeof outcomeOf>,
  recoverAssetTruth = false,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const now = new Date();
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, input.operationId),
        ),
      )
      .for("update");
    if (
      current?.commandType !== MEDIA_UPLOAD_CONFIRMED_EVENT_NAME ||
      current.idempotencyKey !== input.mediaAssetId
    ) {
      return null;
    }

    if (current.lifecycle !== "queued" && current.lifecycle !== "running") {
      const [latestAttempt] = await tx
        .select({ outcome: operationAttempt.outcome })
        .from(operationAttempt)
        .where(
          and(
            eq(operationAttempt.workspaceId, workspaceId),
            eq(operationAttempt.operationId, input.operationId),
          ),
        )
        .orderBy(desc(operationAttempt.attemptNumber))
        .limit(1);
      return {
        attemptCount: current.attemptSeq,
        latestAttemptOutcome: latestAttempt?.outcome ?? null,
        operation: current,
      };
    }

    let owned = current;
    let queuedAttempt: typeof operationAttempt.$inferSelect | undefined;
    if (current.lifecycle === "queued") {
      if (
        !recoverAssetTruth ||
        input.operationVersion !== undefined ||
        current.claimedBy !== null
      ) {
        return null;
      }
      const [claimed] = await tx
        .update(operation)
        .set({
          claimedAt: now,
          claimedBy: input.claimedBy,
          leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
          lifecycle: "running",
          updatedAt: now,
          version: current.version + 1,
        })
        .where(
          and(
            eq(operation.workspaceId, workspaceId),
            eq(operation.id, input.operationId),
            eq(operation.lifecycle, "queued"),
            eq(operation.version, current.version),
            isNull(operation.claimedBy),
          ),
        )
        .returning();
      if (!claimed) return null;
      owned = claimed;
      const [numbered] = await tx
        .update(operation)
        .set({
          attemptSeq: sql`${operation.attemptSeq} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(operation.workspaceId, workspaceId),
            eq(operation.id, input.operationId),
            eq(operation.claimedBy, input.claimedBy),
          ),
        )
        .returning({ attemptNumber: operation.attemptSeq });
      if (!numbered) throw new Error("media failure attempt numbering failed");
      const [created] = await tx
        .insert(operationAttempt)
        .values({
          id: input.attemptId,
          workspaceId,
          operationId: input.operationId,
          attemptNumber: numbered.attemptNumber,
        })
        .returning();
      if (!created) throw new Error("media failure attempt allocation failed");
      queuedAttempt = created;
    } else if (
      current.lifecycle !== "running" ||
      current.claimedBy !== input.claimedBy ||
      current.leaseExpiresAt === null ||
      current.leaseExpiresAt <= now ||
      (input.operationVersion !== undefined &&
        current.version !== input.operationVersion)
    ) {
      return null;
    }

    const [openAttempt] = queuedAttempt
      ? [queuedAttempt]
      : await tx
          .select()
          .from(operationAttempt)
          .where(
            and(
              eq(operationAttempt.workspaceId, workspaceId),
              eq(operationAttempt.operationId, input.operationId),
              input.operationVersion !== undefined
                ? eq(operationAttempt.id, input.attemptId)
                : undefined,
              isNull(operationAttempt.outcome),
            ),
          )
          .orderBy(desc(operationAttempt.attemptNumber))
          .limit(1)
          .for("update");
    const attempt = openAttempt;
    if (!attempt) return null;

    let resolvedSettlement = settlement;
    if (recoverAssetTruth) {
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
            eq(mediaAsset.id, input.mediaAssetId),
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

    const [settledAttempt] = await tx
      .update(operationAttempt)
      .set({
        failureCode:
          "failureCode" in resolvedSettlement
            ? resolvedSettlement.failureCode
            : null,
        outcome: resolvedSettlement.outcome,
        updatedAt: now,
      })
      .where(
        and(
          eq(operationAttempt.workspaceId, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
          eq(operationAttempt.id, attempt.id),
          isNull(operationAttempt.outcome),
        ),
      )
      .returning();
    if (!settledAttempt) {
      throw new Error("media operation attempt was already settled");
    }

    const [settledOperation] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: resolvedSettlement.lifecycle,
        updatedAt: now,
        version: owned.version + 1,
      })
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.lifecycle, "running"),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, owned.version),
        ),
      )
      .returning();
    if (!settledOperation) {
      throw new Error("media operation settlement lost ownership");
    }
    return {
      attemptCount: attempt.attemptNumber,
      latestAttemptOutcome: resolvedSettlement.outcome,
      operation: settledOperation,
    };
  });
}

export function createMediaUploadVerificationFunction(
  client: WorkerInngestClient,
  runtime: Pick<WorkerRuntime, "db" | "identity">,
  dependencies: {
    assertRuntimeWorkspace?: (
      runtime: Pick<WorkerRuntime, "db" | "identity">,
      workspaceId: string,
    ) => Promise<unknown>;
    storage?: () => Storage;
  } = {},
) {
  const assertRuntimeWorkspace =
    dependencies.assertRuntimeWorkspace ?? assertWorkspace;
  const storage = dependencies.storage ?? workerStorage;
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
              {
                attemptId: attemptIdentity(operationId, event.data.run_id, -1),
                claimedBy: claimant(event.data.run_id),
                mediaAssetId,
                operationId,
              },
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
            actorId: settlement.operation.actor,
            attemptCount: settlement.attemptCount,
            latestAttemptOutcome: settlement.latestAttemptOutcome ?? undefined,
            lifecycle: settlement.operation.lifecycle,
            operationId,
            operationVersion: settlement.operation.version,
            sharedImport: false,
          },
          "worker.media-verification.realtime-unavailable",
        );
      },
    },
    async ({ attempt, event, runId, step }) =>
      coded(async () => {
        const claimedBy = claimant(runId);
        const prepared = await step.run(
          `prepare-media-upload-attempt-${attempt}`,
          () =>
            coded(async () => {
              await assertRuntimeWorkspace(runtime, event.data.workspaceId);
              return prepareMediaVerificationAttempt(
                runtime.db,
                event.data.workspaceId,
                {
                  attemptId: attemptIdentity(
                    event.data.operationId,
                    runId,
                    attempt,
                  ),
                  claimedBy,
                  mediaAssetId: event.data.mediaAssetId,
                  operationId: event.data.operationId,
                },
              );
            }),
        );
        if (prepared.status === "terminal") {
          await publishOperationStatus(
            step,
            event.data.workspaceId,
            {
              actorId: prepared.actor,
              attemptCount: prepared.attemptCount,
              latestAttemptOutcome: prepared.latestAttemptOutcome ?? undefined,
              lifecycle: prepared.lifecycle,
              operationId: event.data.operationId,
              operationVersion: prepared.operationVersion,
              sharedImport: false,
            },
            "worker.media-verification.realtime-unavailable",
          );
        }
        if (prepared.status !== "claimed") return prepared;

        const settled = await step.run(
          `verify-media-upload-${attempt}`,
          async () => {
            return coded(async () => {
              const result = await verifyMediaUpload(
                runtime.db,
                storage(),
                event.data.workspaceId,
                event.data.mediaAssetId,
              );
              const settlement = await settleMediaOperation(
                runtime.db,
                event.data.workspaceId,
                {
                  attemptId: prepared.attemptId,
                  claimedBy,
                  mediaAssetId: event.data.mediaAssetId,
                  operationId: event.data.operationId,
                  operationVersion: prepared.operationVersion,
                },
                result,
              );
              if (!settlement) throw new Error("TRANSIENT_CONFLICT");
              return {
                actor: settlement.operation.actor,
                attemptCount: settlement.attemptCount,
                latestAttemptOutcome: settlement.latestAttemptOutcome,
                lifecycle: settlement.operation.lifecycle,
                operationVersion: settlement.operation.version,
                status: result.status,
              };
            });
          },
        );

        if (
          settled.actor &&
          settled.lifecycle &&
          settled.operationVersion &&
          settled.attemptCount !== null
        ) {
          await publishOperationStatus(
            step,
            event.data.workspaceId,
            {
              actorId: settled.actor,
              attemptCount: settled.attemptCount,
              latestAttemptOutcome: settled.latestAttemptOutcome ?? undefined,
              lifecycle: settled.lifecycle,
              operationId: event.data.operationId,
              operationVersion: settled.operationVersion,
              sharedImport: false,
            },
            "worker.media-verification.realtime-unavailable",
          );
        }

        return settled;
      }),
  );
}
