import {
  DURABLE_EVENT_SCHEMA_VERSION,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  type MediaAssetLifecycle,
} from "@rz-chain-reporter/contracts";
import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lte,
  or,
} from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { approval } from "../schema/approval";
import { draftRevision } from "../schema/draft-revision";
import { imageGeneration } from "../schema/image-generation";
import {
  marketAnalysis,
  marketAnalysisHandoff,
  marketGeneration,
} from "../schema/market-analysis";
import { mediaAsset } from "../schema/media-asset";
import { mediaDerivation } from "../schema/media-derivation";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { publication } from "../schema/publication";
import { publishOperation } from "../schema/publish-operation";
import { schedule } from "../schema/schedule";

type MediaAssetRow = typeof mediaAsset.$inferSelect;
type MediaAssetChanges = Partial<typeof mediaAsset.$inferInsert>;
type MediaCleanupLifecycle = Extract<
  MediaAssetLifecycle,
  "rejected" | "expired"
>;

export const UNUSED_SELECTED_MEDIA_CLEANUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;

export type MediaAssetCasResult =
  | { status: "updated"; asset: MediaAssetRow }
  | { status: "not_found" }
  | { status: "conflict" };

export type MediaCleanupClaimResult =
  | {
      status: "claimed";
      asset: MediaAssetRow & { lifecycle: MediaCleanupLifecycle };
    }
  | { status: "attached" }
  | { status: "not_found" }
  | { status: "conflict" };

export async function createMediaUploadIntent(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    objectKey: string;
    kind: string;
    mimeType: string;
    declaredBytes: number;
    checksum: string;
    uploadExpiresAt: Date;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [created] = await tx
      .insert(mediaAsset)
      .values({ ...input, workspaceId })
      .returning();
    if (!created) throw new Error("media asset insert returned no row");
    return created;
  });
}

export async function getMediaAsset(
  executor: Executor,
  workspaceId: string,
  id: string,
) {
  const [row] = await executor
    .select()
    .from(mediaAsset)
    .where(and(inWorkspace(mediaAsset, workspaceId), eq(mediaAsset.id, id)));
  return row ?? null;
}

export async function getMediaAssetByObjectKey(
  executor: Executor,
  workspaceId: string,
  objectKey: string,
) {
  const [row] = await executor
    .select()
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.objectKey, objectKey),
      ),
    );
  return row ?? null;
}

export async function resolveMediaAssetObjectOwnership(
  executor: Executor,
  workspaceId: string,
  objectKey: string,
) {
  try {
    const asset = await getMediaAssetByObjectKey(
      executor,
      workspaceId,
      objectKey,
    );
    return asset
      ? ({ status: "committed", asset } as const)
      : ({ status: "absent" } as const);
  } catch {
    return { status: "uncertain", objectKey } as const;
  }
}

export async function confirmMediaUpload(
  executor: Executor,
  workspaceId: string,
  input: { id: string; actor: string; requestId: string | null },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(inWorkspace(mediaAsset, workspaceId), eq(mediaAsset.id, input.id)),
      );
    if (!current) return { status: "not_found" as const };
    if (current.lifecycle !== "pending") {
      return { status: "replayed" as const, asset: current };
    }
    if (current.uploadExpiresAt && current.uploadExpiresAt <= new Date()) {
      return { status: "expired" as const, asset: current };
    }
    const [uploaded] = await tx
      .update(mediaAsset)
      .set({
        lifecycle: "uploaded",
        updatedAt: new Date(),
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, input.id),
          eq(mediaAsset.lifecycle, "pending"),
          eq(mediaAsset.version, current.version),
        ),
      )
      .returning();
    if (!uploaded) return { status: "conflict" as const };
    const [createdOperation] = await tx
      .insert(operation)
      .values({
        workspaceId,
        actor: input.actor,
        commandType: MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
        idempotencyKey: input.id,
        requestHash: input.id,
        requestId: input.requestId,
      })
      .returning({ id: operation.id });
    if (!createdOperation)
      throw new Error("media operation insert returned no row");
    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId: createdOperation.id,
      eventType: MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        mediaAssetId: input.id,
        operationId: createdOperation.id,
      },
    });
    return { status: "confirmed" as const, asset: uploaded };
  });
}

export async function listMediaReconciliationCandidates(
  executor: Executor,
  workspaceId: string,
  input: { cursor?: string; limit: number; now: Date; staleBefore: Date },
) {
  const candidate = or(
    and(
      eq(mediaAsset.lifecycle, "pending"),
      lte(mediaAsset.uploadExpiresAt, input.now),
    ),
    eq(mediaAsset.lifecycle, "uploaded"),
    and(
      eq(mediaAsset.lifecycle, "validating"),
      lte(mediaAsset.updatedAt, input.staleBefore),
    ),
    and(
      inArray(mediaAsset.lifecycle, ["rejected", "expired"]),
      isNull(mediaAsset.objectRemovedAt),
      or(
        isNull(mediaAsset.cleanupAfter),
        lte(mediaAsset.cleanupAfter, input.now),
      ),
    ),
    and(
      eq(mediaAsset.lifecycle, "verified"),
      isNull(mediaAsset.objectRemovedAt),
      lte(mediaAsset.cleanupAfter, input.now),
    ),
  );
  return executor
    .select()
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        candidate,
        input.cursor ? gt(mediaAsset.id, input.cursor) : undefined,
      ),
    )
    .orderBy(asc(mediaAsset.id))
    .limit(input.limit);
}

export function requeueStaleMediaValidation(
  executor: Executor,
  workspaceId: string,
  input: { id: string; version: number; changedAt?: Date },
) {
  const changedAt = input.changedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: "validating",
    changes: { lifecycle: "uploaded" },
    changedAt,
  });
}

async function casMediaAsset(
  tx: Transaction,
  workspaceId: string,
  input: {
    id: string;
    version: number;
    from: MediaAssetLifecycle;
    changes: MediaAssetChanges;
    changedAt: Date;
  },
): Promise<MediaAssetCasResult> {
  const [updated] = await tx
    .update(mediaAsset)
    .set({
      ...input.changes,
      version: input.version + 1,
      updatedAt: input.changedAt,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, input.id),
        eq(mediaAsset.lifecycle, input.from),
        eq(mediaAsset.version, input.version),
      ),
    )
    .returning();

  if (updated) {
    return { status: "updated", asset: updated };
  }

  const [existing] = await tx
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .where(
      and(inWorkspace(mediaAsset, workspaceId), eq(mediaAsset.id, input.id)),
    );

  return existing ? { status: "conflict" } : { status: "not_found" };
}

async function runMediaCas(
  executor: Executor,
  workspaceId: string,
  input: Parameters<typeof casMediaAsset>[2],
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    return casMediaAsset(tx, workspaceId, input);
  });
}

export function markMediaUploaded(
  executor: Executor,
  workspaceId: string,
  input: { id: string; version: number; changedAt?: Date },
) {
  const changedAt = input.changedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: "pending",
    changes: { lifecycle: "uploaded" },
    changedAt,
  });
}

export function claimMediaValidation(
  executor: Executor,
  workspaceId: string,
  input: { id: string; version: number; changedAt?: Date },
) {
  const changedAt = input.changedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: "uploaded",
    changes: { lifecycle: "validating" },
    changedAt,
  });
}

export function markMediaVerified(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    version: number;
    mimeType: string;
    actualBytes: number;
    checksum: string;
    width: number;
    height: number;
    cleanupAfter?: Date | null;
    verifiedAt?: Date;
  },
) {
  const verifiedAt = input.verifiedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: "validating",
    changes: {
      lifecycle: "verified",
      mimeType: input.mimeType,
      actualBytes: input.actualBytes,
      checksum: input.checksum,
      width: input.width,
      height: input.height,
      cleanupAfter: input.cleanupAfter,
      rejectionReason: null,
      verifiedAt,
    },
    changedAt: verifiedAt,
  });
}

function selectedFinalMediaAttached(
  tx: Transaction,
  workspaceId: string,
  mediaAssetId: string,
) {
  return or(
    exists(
      tx
        .select({ id: schedule.id })
        .from(schedule)
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.selectedFinalMediaAssetId, mediaAssetId),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: draftRevision.id })
        .from(draftRevision)
        .where(
          and(
            inWorkspace(draftRevision, workspaceId),
            eq(draftRevision.selectedFinalMediaAssetId, mediaAssetId),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: approval.id })
        .from(approval)
        .where(
          and(
            inWorkspace(approval, workspaceId),
            eq(approval.selectedFinalMediaAssetId, mediaAssetId),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: publishOperation.operationId })
        .from(publishOperation)
        .where(
          and(
            inWorkspace(publishOperation, workspaceId),
            eq(publishOperation.selectedFinalMediaAssetId, mediaAssetId),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: publication.id })
        .from(publication)
        .where(
          and(
            inWorkspace(publication, workspaceId),
            eq(publication.selectedFinalMediaAssetId, mediaAssetId),
          ),
        ),
    ),
  );
}

function marketAnalysisMediaHeld(
  tx: Transaction,
  workspaceId: string,
  mediaAssetId: string,
) {
  return or(
    exists(
      tx
        .select({ id: marketAnalysis.id })
        .from(marketAnalysis)
        .where(
          and(
            inWorkspace(marketAnalysis, workspaceId),
            or(
              eq(marketAnalysis.currentChartMediaAssetId, mediaAssetId),
              eq(marketAnalysis.currentFinalMediaAssetId, mediaAssetId),
            ),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: marketAnalysisHandoff.id })
        .from(marketAnalysisHandoff)
        .where(
          and(
            inWorkspace(marketAnalysisHandoff, workspaceId),
            or(
              eq(marketAnalysisHandoff.chartMediaAssetId, mediaAssetId),
              eq(marketAnalysisHandoff.finalMediaAssetId, mediaAssetId),
            ),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: marketGeneration.id })
        .from(marketGeneration)
        .innerJoin(
          marketAnalysis,
          and(
            eq(marketAnalysis.workspaceId, marketGeneration.workspaceId),
            eq(marketAnalysis.currentGenerationId, marketGeneration.id),
          ),
        )
        .where(
          and(
            inWorkspace(marketGeneration, workspaceId),
            eq(marketGeneration.providerOriginalMediaAssetId, mediaAssetId),
            isNull(marketGeneration.finalMediaAssetId),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: mediaDerivation.id })
        .from(mediaDerivation)
        .innerJoin(
          marketAnalysis,
          and(
            eq(marketAnalysis.workspaceId, mediaDerivation.workspaceId),
            eq(
              marketAnalysis.currentFinalMediaAssetId,
              mediaDerivation.derivedMediaAssetId,
            ),
          ),
        )
        .where(
          and(
            inWorkspace(mediaDerivation, workspaceId),
            eq(mediaDerivation.sourceMediaAssetId, mediaAssetId),
          ),
        ),
    ),
    exists(
      tx
        .select({ id: mediaDerivation.id })
        .from(mediaDerivation)
        .innerJoin(
          marketAnalysisHandoff,
          and(
            eq(marketAnalysisHandoff.workspaceId, mediaDerivation.workspaceId),
            eq(
              marketAnalysisHandoff.finalMediaAssetId,
              mediaDerivation.derivedMediaAssetId,
            ),
          ),
        )
        .where(
          and(
            inWorkspace(mediaDerivation, workspaceId),
            eq(mediaDerivation.sourceMediaAssetId, mediaAssetId),
          ),
        ),
    ),
  );
}

export async function retainSelectedMedia(
  tx: Transaction,
  workspaceId: string,
  mediaAssetId: string,
) {
  const [asset] = await tx
    .select()
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
      ),
    )
    .for("update");
  if (
    asset?.lifecycle !== "verified" ||
    asset.objectRemovedAt ||
    asset.cleanupAfter === null
  ) {
    return asset ?? null;
  }
  const [retained] = await tx
    .update(mediaAsset)
    .set({
      cleanupAfter: null,
      updatedAt: new Date(),
      version: asset.version + 1,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, asset.id),
        eq(mediaAsset.version, asset.version),
      ),
    )
    .returning();
  if (!retained) throw new Error("selected media retention lost its lock");
  return retained;
}

export async function scheduleDetachedMediaCleanup(
  tx: Transaction,
  workspaceId: string,
  mediaAssetId: string,
  detachedAt = new Date(),
) {
  const [asset] = await tx
    .select()
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
      ),
    )
    .for("update");
  if (
    asset?.lifecycle !== "verified" ||
    asset.objectRemovedAt ||
    asset.cleanupAfter !== null
  ) {
    return asset ?? null;
  }
  const [reference] = await tx
    .select({ id: imageGeneration.operationId })
    .from(imageGeneration)
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.referenceMediaAssetId, mediaAssetId),
      ),
    )
    .limit(1);
  if (reference) return asset;
  const [attachment] = await tx
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.id, mediaAssetId),
        selectedFinalMediaAttached(tx, workspaceId, mediaAssetId),
      ),
    )
    .limit(1);
  if (attachment) return asset;
  const [marketHold] = await tx
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.id, mediaAssetId),
        marketAnalysisMediaHeld(tx, workspaceId, mediaAssetId),
      ),
    )
    .limit(1);
  if (marketHold) return asset;
  const [scheduled] = await tx
    .update(mediaAsset)
    .set({
      cleanupAfter: new Date(
        detachedAt.getTime() + UNUSED_SELECTED_MEDIA_CLEANUP_DELAY_MS,
      ),
      updatedAt: detachedAt,
      version: asset.version + 1,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, asset.id),
        eq(mediaAsset.version, asset.version),
        isNull(mediaAsset.cleanupAfter),
      ),
    )
    .returning();
  if (!scheduled) throw new Error("detached media cleanup lost its lock");
  return scheduled;
}

export async function claimMediaCleanup(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    version: number;
    lifecycle: Extract<
      MediaAssetLifecycle,
      "verified" | "rejected" | "expired"
    >;
    claimedAt?: Date;
    claimUntil: Date;
  },
): Promise<MediaCleanupClaimResult> {
  const claimedAt = input.claimedAt ?? new Date();
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(inWorkspace(mediaAsset, workspaceId), eq(mediaAsset.id, input.id)),
      )
      .for("update");
    if (!current) return { status: "not_found" };

    const [reference] = await tx
      .select({ operationId: imageGeneration.operationId })
      .from(imageGeneration)
      .where(
        and(
          eq(imageGeneration.workspaceId, workspaceId),
          eq(imageGeneration.referenceMediaAssetId, current.id),
        ),
      )
      .limit(1);
    if (reference) return { status: "attached" };

    const [attachment] = await tx
      .select({ id: mediaAsset.id })
      .from(mediaAsset)
      .where(
        and(
          eq(mediaAsset.id, current.id),
          selectedFinalMediaAttached(tx, workspaceId, current.id),
        ),
      )
      .limit(1);
    if (attachment) return { status: "attached" };

    const [marketHold] = await tx
      .select({ id: mediaAsset.id })
      .from(mediaAsset)
      .where(
        and(
          eq(mediaAsset.id, current.id),
          marketAnalysisMediaHeld(tx, workspaceId, current.id),
        ),
      )
      .limit(1);
    if (marketHold) return { status: "attached" };

    if (
      current.version !== input.version ||
      current.lifecycle !== input.lifecycle ||
      current.objectRemovedAt ||
      (current.cleanupAfter && current.cleanupAfter > claimedAt)
    ) {
      return { status: "conflict" };
    }
    if (
      current.lifecycle !== "verified" &&
      current.lifecycle !== "rejected" &&
      current.lifecycle !== "expired"
    ) {
      return { status: "conflict" };
    }

    const lifecycle: MediaCleanupLifecycle =
      current.lifecycle === "verified" ? "expired" : current.lifecycle;
    const [claimed] = await tx
      .update(mediaAsset)
      .set({
        cleanupAfter: input.claimUntil,
        lifecycle,
        updatedAt: claimedAt,
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, current.id),
          eq(mediaAsset.lifecycle, current.lifecycle),
          eq(mediaAsset.version, current.version),
        ),
      )
      .returning();
    return claimed
      ? { status: "claimed", asset: { ...claimed, lifecycle } }
      : { status: "conflict" };
  });
}

export function markMediaRejected(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    version: number;
    reason: string;
    mimeType?: string;
    actualBytes?: number;
    checksum?: string;
    width?: number;
    height?: number;
    rejectedAt?: Date;
  },
) {
  const rejectedAt = input.rejectedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: "validating",
    changes: {
      lifecycle: "rejected",
      rejectionReason: input.reason,
      mimeType: input.mimeType,
      actualBytes: input.actualBytes,
      checksum: input.checksum,
      width: input.width,
      height: input.height,
    },
    changedAt: rejectedAt,
  });
}

export function expirePendingMedia(
  executor: Executor,
  workspaceId: string,
  input: { id: string; version: number; expiredAt?: Date },
) {
  const expiredAt = input.expiredAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: "pending",
    changes: { lifecycle: "expired" },
    changedAt: expiredAt,
  });
}

export function markMediaObjectRemoved(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    version: number;
    lifecycle: Extract<MediaAssetLifecycle, "rejected" | "expired">;
    removedAt?: Date;
  },
) {
  const removedAt = input.removedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: input.lifecycle,
    changes: {
      cleanupAfter: null,
      objectRemovedAt: removedAt,
      deleteFailedAt: null,
    },
    changedAt: removedAt,
  });
}

export function markMediaDeleteFailed(
  executor: Executor,
  workspaceId: string,
  input: {
    id: string;
    version: number;
    lifecycle: Extract<MediaAssetLifecycle, "rejected" | "expired">;
    failedAt?: Date;
  },
) {
  const failedAt = input.failedAt ?? new Date();
  return runMediaCas(executor, workspaceId, {
    id: input.id,
    version: input.version,
    from: input.lifecycle,
    changes: { cleanupAfter: null, deleteFailedAt: failedAt },
    changedAt: failedAt,
  });
}
