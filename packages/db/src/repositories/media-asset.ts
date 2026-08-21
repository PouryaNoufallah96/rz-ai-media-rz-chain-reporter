import {
  DURABLE_EVENT_SCHEMA_VERSION,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  type MediaAssetLifecycle,
} from "@rz-chain-reporter/contracts";
import { and, asc, eq, gt, inArray, isNull, lte, or } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { mediaAsset } from "../schema/media-asset";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";

type MediaAssetRow = typeof mediaAsset.$inferSelect;
type MediaAssetChanges = Partial<typeof mediaAsset.$inferInsert>;

export type MediaAssetCasResult =
  | { status: "updated"; asset: MediaAssetRow }
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
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.objectKey, objectKey),
      ),
    );
  return row ?? null;
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
      rejectionReason: null,
      verifiedAt,
    },
    changedAt: verifiedAt,
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
    changes: { objectRemovedAt: removedAt, deleteFailedAt: null },
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
    changes: { deleteFailedAt: failedAt },
    changedAt: failedAt,
  });
}
