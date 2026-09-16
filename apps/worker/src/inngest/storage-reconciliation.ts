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
import { reconcileStaleMarketGenerations } from "@rz-chain-reporter/db/repositories/market-generation";
import {
  expirePendingMedia,
  getMediaAssetByObjectKey,
  listMediaReconciliationCandidates,
  requeueStaleMediaValidation,
} from "@rz-chain-reporter/db/repositories/media-asset";
import {
  marketChartRender,
  marketGeneration,
} from "@rz-chain-reporter/db/schema/market-analysis";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import type { Storage } from "@rz-chain-reporter/storage";
import { and, asc, eq, exists, gt, isNull, or } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { stableFailureCode, workerLogger } from "../logging/logger";
import {
  type DraftChange,
  notifyDraftsAndUsageChanged,
  notifyDraftsChanged,
} from "../web-cache/drafts";
import { notifyEditorialPresentationTranslationChanged } from "../web-cache/editorial";
import {
  notifyMarketAnalysisAndUsageChanged,
  notifyMarketAnalysisChanged,
  notifyMarketCatalogChanged,
  notifyMarketDraftsChanged,
} from "../web-cache/market-analysis";
import { notifySourcesAndUsageChanged } from "../web-cache/sources";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import {
  reconcileStaleCopyVariantTranslations,
  translationChange,
} from "./copy-variant-translation";
import { durableEvents } from "./events";
import { reconcileStaleMarketCatalogRefreshes } from "./market-catalog-refresh";
import { reconcileStaleMarketChartRenders } from "./market-chart-render";
import { reconcileStaleMarketVerifications } from "./market-verification";
import {
  scheduleDetachedMarketMediaCleanup,
  workerStorage,
} from "./media-storage";
import { cleanupMediaAsset, verifyMediaUpload } from "./media-verification";
import {
  presentationTranslationChangeCode,
  reconcileStalePresentationTranslations,
} from "./presentation-translation";
import { assertWorkspace, type WorkerRuntime } from "./runtime";
import { reconcileStaleSourceImports } from "./source-import";

const RECONCILIATION_BATCH_SIZE = 25;
const OBJECT_ORPHAN_GRACE_MS = 60 * 60 * 1000;
const VALIDATION_STALE_MS = 15 * 60 * 1000;
const STALE_COPY_OPERATION_BATCH = 10;

type SettledDraftNotification =
  | (DraftChange & { kind: "draft" })
  | (Omit<DraftChange, "analysisRunId"> & {
      kind: "market";
      marketAnalysisId: string;
    });

type SettledOperationNotification = {
  actorId: string;
  lifecycle: "cancelled" | "failed" | "succeeded" | "unknown";
  operationId: string;
  operationVersion: number;
};

async function notifySettledDraftChange(
  step: Parameters<typeof notifyDraftsChanged>[0],
  workspaceId: string,
  notification: SettledDraftNotification,
  prefix: string,
) {
  return notification.kind === "market"
    ? notifyMarketDraftsChanged(
        step,
        workspaceId,
        notification.marketAnalysisId,
        `${prefix}-${notification.operationId}`,
      )
    : notifyDraftsChanged(
        step,
        workspaceId,
        notification,
        `${prefix}-${notification.operationId}`,
      );
}
const STALE_IMAGE_OPERATION_BATCH = 10;

type ReconciliationCursor = {
  db?: string | null;
  market?: string | null;
  objects?: string | null;
};

const reconciliationCursorSchema = z
  .object({
    db: z.uuid().nullable().optional(),
    market: z.uuid().nullable().optional(),
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
  if (cursor.db === null && cursor.market === null && cursor.objects === null)
    return undefined;
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
  const cleanup = await cleanupMediaAsset(
    executor,
    storage,
    workspaceId,
    asset,
  );
  if (cleanup.status === "delete_failed") {
    throw new Error("media object deletion failed");
  }
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

  const detachedMarketCandidates =
    cursor.market === null
      ? []
      : await executor
          .select({ id: mediaAsset.id })
          .from(mediaAsset)
          .where(
            and(
              eq(mediaAsset.workspaceId, workspaceId),
              eq(mediaAsset.lifecycle, "verified"),
              isNull(mediaAsset.cleanupAfter),
              cursor.market ? gt(mediaAsset.id, cursor.market) : undefined,
              or(
                exists(
                  executor
                    .select({ id: marketChartRender.id })
                    .from(marketChartRender)
                    .where(
                      and(
                        eq(marketChartRender.workspaceId, workspaceId),
                        eq(marketChartRender.mediaAssetId, mediaAsset.id),
                      ),
                    ),
                ),
                exists(
                  executor
                    .select({ id: marketGeneration.id })
                    .from(marketGeneration)
                    .where(
                      and(
                        eq(marketGeneration.workspaceId, workspaceId),
                        or(
                          eq(marketGeneration.chartMediaAssetId, mediaAsset.id),
                          eq(
                            marketGeneration.providerOriginalMediaAssetId,
                            mediaAsset.id,
                          ),
                          eq(marketGeneration.finalMediaAssetId, mediaAsset.id),
                        ),
                      ),
                    ),
                ),
              ),
            ),
          )
          .orderBy(asc(mediaAsset.id))
          .limit(RECONCILIATION_BATCH_SIZE);
  let detachedMarketCleanupScheduled = 0;
  let failedDetachedMarketCleanup = 0;
  for (const candidate of detachedMarketCandidates) {
    try {
      const scheduled = await scheduleDetachedMarketMediaCleanup(
        executor,
        workspaceId,
        [candidate.id],
        now,
      );
      detachedMarketCleanupScheduled += scheduled.length;
    } catch (error) {
      failedDetachedMarketCleanup += 1;
      workerLogger.error("worker.market-media.cleanup-scheduling-failed", {
        errorCode: stableFailureCode(error, "MEDIA_RECONCILIATION_FAILED"),
        mediaAssetId: candidate.id,
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
  let failedObjects = 0;
  let orphanObjectsRemoved = 0;
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
  const lastDetachedMarketCandidate = detachedMarketCandidates.at(-1);
  const nextMarket =
    cursor.market !== null &&
    detachedMarketCandidates.length === RECONCILIATION_BATCH_SIZE &&
    lastDetachedMarketCandidate
      ? lastDetachedMarketCandidate.id
      : null;
  return {
    candidatesObserved: candidates.length,
    failedCandidates,
    failedObjects,
    detachedMarketCleanupScheduled,
    detachedMarketCandidatesObserved: detachedMarketCandidates.length,
    failedDetachedMarketCleanup,
    nextCursor: encodeCursor({
      db: nextDb,
      market: nextMarket,
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
  const changes: SettledDraftNotification[] = [];
  const operations: SettledOperationNotification[] = [];
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
    const lifecycle =
      outcome.operation.lifecycle === "unknown" ? "unknown" : "failed";
    changes.push(
      await loadSettledDraftChange(
        executor,
        workspaceId,
        candidate.operationId,
        lifecycle,
      ),
    );
    operations.push({
      actorId: outcome.operation.actor,
      lifecycle,
      operationId: candidate.operationId,
      operationVersion: outcome.operation.version,
    });
  }
  return {
    settledOperations: operations,
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
  const changes: SettledDraftNotification[] = [];
  const operations: SettledOperationNotification[] = [];
  for (const candidate of candidates) {
    const settled = await settleStaleCopyOperation(executor, workspaceId, {
      expectedVersion: candidate.operationVersion,
      now,
      operationId: candidate.operationId,
    });
    if (!settled) continue;
    const loaded = await loadSettledCopyDraftChange(
      executor,
      workspaceId,
      candidate.operationId,
    );
    changes.push(loaded.change);
    operations.push({
      actorId: loaded.actorId,
      lifecycle: settled.lifecycle === "unknown" ? "unknown" : "failed",
      operationId: candidate.operationId,
      operationVersion: settled.version,
    });
  }
  return {
    settledOperations: operations,
    settledDraftChanges: changes,
    staleCopyOperationsObserved: candidates.length,
    staleCopyOperationsSettled: changes.length,
  };
}

async function loadSettledCopyDraftChange(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const copy = await findCopyExecutionContext(
    executor,
    workspaceId,
    operationId,
  );
  if (!copy) throw new NonRetriableError("NOT_FOUND");
  const change: SettledDraftNotification =
    copy.executionScope.kind === "market_analysis"
      ? {
          code: "failed",
          kind: "market",
          marketAnalysisId: copy.executionScope.marketAnalysisId,
          operationId,
          platformDraftId: copy.platformDraftId,
        }
      : {
          analysisRunId: copy.executionScope.analysisRunId,
          code: "failed",
          kind: "draft",
          operationId,
          platformDraftId: copy.platformDraftId,
        };
  return { actorId: copy.actor, change };
}

async function loadSettledDraftChange(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  code: DraftChange["code"],
): Promise<SettledDraftNotification> {
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
  return copy.executionScope.kind === "market_analysis"
    ? {
        code,
        kind: "market",
        marketAnalysisId: copy.executionScope.marketAnalysisId,
        operationId,
        platformDraftId: image.platformDraftId,
      }
    : {
        analysisRunId: copy.executionScope.analysisRunId,
        code,
        kind: "draft",
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
      const installation = await step.run(
        "resolve-storage-reconciliation-workspace",
        () =>
          assertWorkspace(
            runtime,
            "workspaceId" in event.data ? event.data.workspaceId : undefined,
          ),
      );
      const workspaceId = installation.workspaceId;
      if (!("cursor" in event.data && event.data.cursor)) {
        const now = new Date(event.ts);
        const staleCopy = await step.run("settle-stale-copy-operations", () =>
          reconcileStaleCopyOperations(runtime.db, workspaceId, now),
        );
        for (const notification of staleCopy.settledDraftChanges) {
          await notifySettledDraftChange(
            step,
            workspaceId,
            notification,
            "stale-copy",
          );
        }
        for (const terminal of staleCopy.settledOperations) {
          await publishOperationStatus(
            step,
            workspaceId,
            { ...terminal, sharedImport: false },
            "worker.copy-generation.realtime-unavailable",
          );
        }
        const stale = await step.run("settle-stale-image-operations", () =>
          reconcileStaleImageOperations(runtime.db, workspaceId, now),
        );
        for (const notification of stale.settledDraftChanges) {
          await notifySettledDraftChange(
            step,
            workspaceId,
            notification,
            "stale-image",
          );
        }
        for (const terminal of stale.settledOperations) {
          await publishOperationStatus(
            step,
            workspaceId,
            { ...terminal, sharedImport: false },
            "worker.image-generation.realtime-unavailable",
          );
        }
        const staleSourceImports = await step.run(
          "settle-stale-source-imports",
          () => reconcileStaleSourceImports(runtime.db, workspaceId, now),
        );
        for (const terminal of staleSourceImports.staleSourceImportsSettled) {
          await notifySourcesAndUsageChanged(
            step,
            workspaceId,
            `settled-${terminal.operationId}`,
            terminal.actorId,
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: terminal.actorId,
              lifecycle: terminal.lifecycle,
              operationId: terminal.operationId,
              operationVersion: terminal.version,
              sharedImport: terminal.sharedImport,
            },
            "worker.source-import.realtime-unavailable",
          );
        }
        const staleCopyTranslations = await step.run(
          "settle-stale-copy-variant-translations",
          () =>
            reconcileStaleCopyVariantTranslations(runtime.db, workspaceId, now),
        );
        for (const terminal of staleCopyTranslations.staleCopyVariantTranslationsSettled) {
          await notifyDraftsAndUsageChanged(
            step,
            workspaceId,
            translationChange(terminal, terminal.operationId),
            `stale-copy-variant-translation-${terminal.operationId}`,
            terminal.actorId,
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: terminal.actorId,
              lifecycle: terminal.lifecycle,
              operationId: terminal.operationId,
              operationVersion: terminal.operationVersion,
              sharedImport: false,
            },
            "worker.copy-variant-translation.realtime-unavailable",
          );
        }
        const staleMarketVerifications = await step.run(
          "settle-stale-market-verifications",
          () => reconcileStaleMarketVerifications(runtime, workspaceId, now),
        );
        for (const terminal of staleMarketVerifications) {
          await notifyMarketAnalysisChanged(
            step,
            workspaceId,
            terminal.marketAnalysisId,
            `stale-${terminal.operationId}`,
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: terminal.actorId,
              lifecycle: terminal.lifecycle,
              operationId: terminal.operationId,
              operationVersion: terminal.operationVersion,
              sharedImport: false,
            },
            "worker.market-verification.realtime-unavailable",
          );
        }
        const staleMarketChartRenders = await step.run(
          "settle-stale-market-chart-renders",
          () => reconcileStaleMarketChartRenders(runtime, workspaceId, now),
        );
        for (const terminal of staleMarketChartRenders) {
          await notifyMarketAnalysisChanged(
            step,
            workspaceId,
            terminal.marketAnalysisId,
            `stale-chart-${terminal.operationId}`,
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: terminal.actorId,
              lifecycle: terminal.lifecycle,
              operationId: terminal.operationId,
              operationVersion: terminal.operationVersion,
              sharedImport: false,
            },
            "worker.market-chart.realtime-unavailable",
          );
        }
        const staleMarketGenerations = await step.run(
          "settle-stale-market-generations",
          () => reconcileStaleMarketGenerations(runtime.db, workspaceId, now),
        );
        for (const terminal of staleMarketGenerations) {
          await notifyMarketAnalysisAndUsageChanged(
            step,
            workspaceId,
            terminal.marketAnalysisId,
            `stale-generation-${terminal.operationId}`,
            terminal.actorId,
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: terminal.actorId,
              lifecycle: terminal.lifecycle,
              operationId: terminal.operationId,
              operationVersion: terminal.operationVersion,
              sharedImport: false,
            },
            "worker.market-generation.realtime-unavailable",
          );
        }
        const staleMarketCatalog = await step.run(
          "settle-stale-market-catalog-refreshes",
          () => reconcileStaleMarketCatalogRefreshes(runtime, workspaceId, now),
        );
        if (staleMarketCatalog.settled > 0) {
          await notifyMarketCatalogChanged(step, workspaceId, "stale");
        }
        for (const terminal of staleMarketCatalog.settledOperations) {
          await publishOperationStatus(
            step,
            workspaceId,
            { ...terminal, sharedImport: false },
            "worker.market-catalog.realtime-unavailable",
          );
        }
        const stalePresentationTranslations = await step.run(
          "settle-stale-presentation-translations",
          () =>
            reconcileStalePresentationTranslations(
              runtime.db,
              workspaceId,
              now,
            ),
        );
        for (const terminal of stalePresentationTranslations.stalePresentationTranslationsSettled) {
          await notifyEditorialPresentationTranslationChanged(
            step,
            workspaceId,
            {
              analysisRunId: terminal.analysisRunId,
              code: presentationTranslationChangeCode(terminal.lifecycle),
              operationId: terminal.operationId,
              platformDraftIds: terminal.platformDraftIds,
            },
            terminal.actorId,
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: terminal.actorId,
              lifecycle: terminal.lifecycle,
              operationId: terminal.operationId,
              operationVersion: terminal.operationVersion,
              sharedImport: false,
            },
            "worker.presentation-translation.realtime-unavailable",
          );
        }
      }
      const result = await step.run("reconcile-storage-page", async () => {
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
      if (result.nextCursor) {
        const continuation =
          durableEvents.storageReconciliationRequested.create({
            schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
            workspaceId,
            cursor: result.nextCursor,
          });
        await continuation.validate();
        await step.sendEvent("continue-storage-reconciliation", continuation);
      }
      return result;
    },
  );
}
