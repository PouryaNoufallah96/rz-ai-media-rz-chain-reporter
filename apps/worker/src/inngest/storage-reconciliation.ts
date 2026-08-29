import {
  DURABLE_EVENT_SCHEMA_VERSION,
  MAX_RECONCILIATION_CURSOR_LENGTH,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  findCopyExecutionContext,
  listStaleCopyOperations,
  settleStaleCopyOperation,
} from "@rz-chain-reporter/db/repositories/copy-generation";
import {
  findImageExecutionContext,
  findOldestImageOperationForBrand,
  listStaleImageOperations,
  settleStaleImageOperation,
} from "@rz-chain-reporter/db/repositories/image-generation";
import {
  expirePendingMedia,
  getMediaAssetByObjectKey,
  listMediaReconciliationCandidates,
  requeueStaleMediaValidation,
} from "@rz-chain-reporter/db/repositories/media-asset";
import type { Storage } from "@rz-chain-reporter/storage";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { stableFailureCode, workerLogger } from "../logging/logger";
import { type DraftChange, notifyDraftsChanged } from "../web-cache/drafts";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { workerStorage } from "./media-storage";
import { cleanupMediaAsset, verifyMediaUpload } from "./media-verification";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const RECONCILIATION_BATCH_SIZE = 25;
const OBJECT_ORPHAN_GRACE_MS = 60 * 60 * 1000;
const VALIDATION_STALE_MS = 15 * 60 * 1000;
const STALE_COPY_OPERATION_BATCH = 10;
const STALE_IMAGE_OPERATION_BATCH = 10;

type ReconciliationCursor = {
  db?: string | null;
  objects?: string | null;
};

const reconciliationCursorSchema = z
  .object({
    db: z.uuid().nullable().optional(),
    objects: z.string().min(1).nullable().optional(),
  })
  .strict();

function invalidCursor(): never {
  throw new NonRetriableError("invalid storage reconciliation cursor");
}

function decodeCursor(cursor?: string): ReconciliationCursor {
  if (!cursor) return {};
  if (
    cursor.length > MAX_RECONCILIATION_CURSOR_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(cursor) ||
    cursor.length % 4 === 1
  ) {
    return invalidCursor();
  }
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) return invalidCursor();
    const parsed = reconciliationCursorSchema.safeParse(
      JSON.parse(decoded.toString("utf8")),
    );
    return parsed.success ? parsed.data : invalidCursor();
  } catch {
    return invalidCursor();
  }
}

function encodeCursor(cursor: ReconciliationCursor) {
  if (cursor.db === null && cursor.objects === null) return undefined;
  const encoded = Buffer.from(JSON.stringify(cursor)).toString("base64url");
  if (encoded.length > MAX_RECONCILIATION_CURSOR_LENGTH) {
    return invalidCursor();
  }
  return encoded;
}

async function cleanupTerminal(
  executor: Executor,
  storage: Storage,
  workspaceId: string,
  asset: Awaited<ReturnType<typeof listMediaReconciliationCandidates>>[number],
) {
  if (
    asset.lifecycle !== "verified" &&
    asset.lifecycle !== "rejected" &&
    asset.lifecycle !== "expired"
  )
    return;
  await cleanupMediaAsset(executor, storage, workspaceId, asset);
}

export async function reconcileStorage(
  executor: Executor,
  storage: Storage,
  workspaceId: string,
  input: { cursor?: string; now?: Date } = {},
) {
  const now = input.now ?? new Date();
  const cursor = decodeCursor(input.cursor);
  const candidates =
    cursor.db === null
      ? []
      : await listMediaReconciliationCandidates(executor, workspaceId, {
          cursor: cursor.db,
          limit: RECONCILIATION_BATCH_SIZE,
          now,
          staleBefore: new Date(now.getTime() - VALIDATION_STALE_MS),
        });
  let failedCandidates = 0;
  for (const asset of candidates) {
    try {
      if (asset.lifecycle === "pending") {
        const expired = await expirePendingMedia(executor, workspaceId, {
          id: asset.id,
          version: asset.version,
          expiredAt: now,
        });
        if (expired.status === "updated") {
          await cleanupTerminal(executor, storage, workspaceId, expired.asset);
        }
      } else if (asset.lifecycle === "uploaded") {
        await verifyMediaUpload(executor, storage, workspaceId, asset.id);
      } else if (asset.lifecycle === "validating") {
        const requeued = await requeueStaleMediaValidation(
          executor,
          workspaceId,
          { id: asset.id, version: asset.version, changedAt: now },
        );
        if (requeued.status === "updated") {
          await verifyMediaUpload(executor, storage, workspaceId, asset.id);
        }
      } else {
        await cleanupTerminal(executor, storage, workspaceId, asset);
      }
    } catch (error) {
      failedCandidates += 1;
      workerLogger.error("worker.storage.reconciliation-candidate-failed", {
        errorCode: stableFailureCode(error, "MEDIA_RECONCILIATION_FAILED"),
        mediaAssetId: asset.id,
        workspaceId,
      });
    }
  }

  const objectPage =
    cursor.objects === null
      ? { items: [], nextCursor: undefined }
      : await storage.list({
          prefix: `${workspaceId}/`,
          cursor: cursor.objects,
          limit: RECONCILIATION_BATCH_SIZE,
        });
  let orphanObjectsRemoved = 0;
  let failedObjects = 0;
  for (const object of objectPage.items) {
    try {
      const existing = await getMediaAssetByObjectKey(
        executor,
        workspaceId,
        object.key,
      );
      if (
        !existing &&
        object.lastModified.getTime() <= now.getTime() - OBJECT_ORPHAN_GRACE_MS
      ) {
        await storage.delete([object.key]);
        orphanObjectsRemoved += 1;
      }
    } catch (error) {
      failedObjects += 1;
      workerLogger.error("worker.storage.reconciliation-object-failed", {
        errorCode: stableFailureCode(error, "OBJECT_RECONCILIATION_FAILED"),
        workspaceId,
      });
    }
  }

  const lastCandidate = candidates.at(-1);
  const nextDb =
    cursor.db !== null &&
    candidates.length === RECONCILIATION_BATCH_SIZE &&
    lastCandidate
      ? lastCandidate.id
      : null;
  return {
    candidatesObserved: candidates.length,
    failedCandidates,
    failedObjects,
    nextCursor: encodeCursor({
      db: nextDb,
      objects: objectPage.nextCursor ?? null,
    }),
    objectCandidatesObserved: objectPage.items.length,
    orphanObjectsRemoved,
  };
}

export async function reconcileStaleImageOperations(
  executor: Executor,
  workspaceId: string,
  now: Date,
) {
  const candidates = await listStaleImageOperations(executor, workspaceId, {
    limit: STALE_IMAGE_OPERATION_BATCH,
    now,
  });
  const changes: DraftChange[] = [];
  let settled = 0;
  for (const candidate of candidates) {
    const admitted =
      candidate.lifecycle !== "queued" ||
      (await findOldestImageOperationForBrand(
        executor,
        workspaceId,
        candidate.mediaBrandId,
      )) === candidate.operationId;
    if (!admitted) continue;
    const outcome = await settleStaleImageOperation(executor, workspaceId, {
      expectedVersion: candidate.operationVersion,
      mediaBrandId: candidate.mediaBrandId,
      now,
      operationId: candidate.operationId,
    });
    if (!outcome) continue;
    settled += 1;
    changes.push(
      await loadSettledDraftChange(
        executor,
        workspaceId,
        candidate.operationId,
        outcome.operation.lifecycle === "unknown" ? "unknown" : "failed",
      ),
    );
  }
  return {
    settledDraftChanges: changes,
    staleImageOperationsObserved: candidates.length,
    staleImageOperationsSettled: settled,
  };
}

export async function reconcileStaleCopyOperations(
  executor: Executor,
  workspaceId: string,
  now: Date,
) {
  const candidates = await listStaleCopyOperations(executor, workspaceId, {
    limit: STALE_COPY_OPERATION_BATCH,
    now,
  });
  const changes: DraftChange[] = [];
  for (const candidate of candidates) {
    const settled = await settleStaleCopyOperation(executor, workspaceId, {
      expectedVersion: candidate.operationVersion,
      now,
      operationId: candidate.operationId,
    });
    if (!settled) continue;
    changes.push(
      await loadSettledCopyDraftChange(
        executor,
        workspaceId,
        candidate.operationId,
      ),
    );
  }
  return {
    settledDraftChanges: changes,
    staleCopyOperationsObserved: candidates.length,
    staleCopyOperationsSettled: changes.length,
  };
}

async function loadSettledCopyDraftChange(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<DraftChange> {
  const copy = await findCopyExecutionContext(
    executor,
    workspaceId,
    operationId,
  );
  if (!copy) throw new NonRetriableError("NOT_FOUND");
  return {
    analysisRunId: copy.analysisRunId,
    code: "failed",
    operationId,
    platformDraftId: copy.platformDraftId,
  };
}

async function loadSettledDraftChange(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  code: DraftChange["code"],
): Promise<DraftChange> {
  const image = await findImageExecutionContext(
    executor,
    workspaceId,
    operationId,
  );
  if (!image) throw new NonRetriableError("NOT_FOUND");
  const copy = await findCopyExecutionContext(
    executor,
    workspaceId,
    image.copyOperationId,
  );
  if (!copy) throw new NonRetriableError("NOT_FOUND");
  return {
    analysisRunId: copy.analysisRunId,
    code,
    operationId,
    platformDraftId: image.platformDraftId,
  };
}

export function createStorageReconciliationFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  return client.createFunction(
    {
      id: "storage-reconciliation",
      concurrency: 1,
      retries: 2,
      triggers: [
        durableEvents.storageReconciliationRequested,
        { cron: "17 * * * *" },
      ],
    },
    async ({ event, step }) => {
      const result = await step.run("reconcile-storage-page", async () => {
        const installation = await assertWorkspace(
          runtime,
          "workspaceId" in event.data ? event.data.workspaceId : undefined,
        );
        const workspaceId = installation.workspaceId;
        const reconciliation = await reconcileStorage(
          runtime.db,
          workerStorage(),
          workspaceId,
          {
            cursor: "cursor" in event.data ? event.data.cursor : undefined,
            now: new Date(event.ts),
          },
        );
        return { ...reconciliation, workspaceId };
      });
      if (!("cursor" in event.data && event.data.cursor)) {
        const staleCopy = await step.run("settle-stale-copy-operations", () =>
          reconcileStaleCopyOperations(
            runtime.db,
            result.workspaceId,
            new Date(event.ts),
          ),
        );
        for (const change of staleCopy.settledDraftChanges) {
          await notifyDraftsChanged(
            step,
            result.workspaceId,
            change,
            `stale-copy-${change.operationId}`,
          );
        }
        const stale = await step.run("settle-stale-image-operations", () =>
          reconcileStaleImageOperations(
            runtime.db,
            result.workspaceId,
            new Date(event.ts),
          ),
        );
        for (const change of stale.settledDraftChanges) {
          await notifyDraftsChanged(
            step,
            result.workspaceId,
            change,
            `stale-image-${change.operationId}`,
          );
        }
      }
      if (result.nextCursor) {
        const continuation =
          durableEvents.storageReconciliationRequested.create({
            schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
            workspaceId: result.workspaceId,
            cursor: result.nextCursor,
          });
        await continuation.validate();
        await step.sendEvent("continue-storage-reconciliation", continuation);
      }
      return result;
    },
  );
}
