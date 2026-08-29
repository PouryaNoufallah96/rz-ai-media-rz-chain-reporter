import { createHash } from "node:crypto";
import {
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_DIMENSION,
  MAX_REFERENCE_IMAGE_PIXELS,
  REFERENCE_IMAGE_KIND,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  claimMediaCleanup,
  claimMediaValidation,
  getMediaAsset,
  markMediaDeleteFailed,
  markMediaObjectRemoved,
  markMediaRejected,
  markMediaVerified,
} from "@rz-chain-reporter/db/repositories/media-asset";
import {
  isMissingStorageObject,
  type Storage,
} from "@rz-chain-reporter/storage";

import { decodeStaticRaster } from "./media-storage";

const REFERENCE_CLEANUP_DELAY_MS = 24 * 60 * 60 * 1000;
const UNATTACHED_IMAGE_CLEANUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_CLAIM_MS = 15 * 60 * 1000;

const VERIFIED_CLEANUP_DELAY_MS: Record<string, number | undefined> = {
  [REFERENCE_IMAGE_KIND]: REFERENCE_CLEANUP_DELAY_MS,
  image: UNATTACHED_IMAGE_CLEANUP_DELAY_MS,
};

const MEDIA_REJECTION_REASONS = {
  checksum: "CHECKSUM_MISMATCH",
  declaredBytes: "DECLARED_BYTES_MISMATCH",
  declaredMime: "DECLARED_MIME_MISMATCH",
  malformed: "IMAGE_MALFORMED",
  missing: "OBJECT_MISSING",
  oversize: "FILE_TOO_LARGE",
} as const;

type RejectionReason =
  (typeof MEDIA_REJECTION_REASONS)[keyof typeof MEDIA_REJECTION_REASONS];

type MediaAsset = NonNullable<Awaited<ReturnType<typeof getMediaAsset>>>;

type ObservedMedia = {
  actualBytes?: number;
  checksum?: string;
  height?: number;
  mimeType?: string;
  width?: number;
};

type Inspection =
  | { status: "rejected"; reason: RejectionReason; observed: ObservedMedia }
  | { status: "verified"; observed: Required<ObservedMedia> };

function rejected(
  reason: RejectionReason,
  observed: ObservedMedia = {},
): Inspection {
  return { status: "rejected", reason, observed };
}

async function readBounded(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const hash = createHash("sha256");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REFERENCE_IMAGE_BYTES) {
      await reader.cancel();
      return { status: "oversize" as const };
    }
    hash.update(value);
    chunks.push(value);
  }
  return {
    status: "read" as const,
    bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))),
    checksum: hash.digest("hex"),
    size,
  };
}

async function inspect(
  storage: Storage,
  asset: MediaAsset,
): Promise<Inspection> {
  try {
    const head = await storage.head(asset.objectKey);
    if (head.size > MAX_REFERENCE_IMAGE_BYTES) {
      return rejected(MEDIA_REJECTION_REASONS.oversize, {
        actualBytes: head.size,
      });
    }
  } catch (error) {
    if (!isMissingStorageObject(error)) throw error;
    return rejected(MEDIA_REJECTION_REASONS.missing);
  }

  const opened = await storage.openRead(asset.objectKey);
  const read = await readBounded(opened.stream);
  if (read.status === "oversize") {
    return rejected(MEDIA_REJECTION_REASONS.oversize);
  }

  const observed = { actualBytes: read.size, checksum: read.checksum };
  if (read.size !== asset.declaredBytes) {
    return rejected(MEDIA_REJECTION_REASONS.declaredBytes, observed);
  }
  if (read.checksum !== asset.checksum) {
    return rejected(MEDIA_REJECTION_REASONS.checksum, observed);
  }

  const raster = await decodeStaticRaster(read.bytes, {
    maxDimension: MAX_REFERENCE_IMAGE_DIMENSION,
    maxPixels: MAX_REFERENCE_IMAGE_PIXELS,
  });
  if (!raster) {
    return rejected(MEDIA_REJECTION_REASONS.malformed, observed);
  }

  const decoded = { ...observed, ...raster };
  return raster.mimeType === asset.mimeType
    ? { status: "verified", observed: decoded }
    : rejected(MEDIA_REJECTION_REASONS.declaredMime, decoded);
}

export async function cleanupMediaAsset(
  executor: Executor,
  storage: Storage,
  workspaceId: string,
  asset: MediaAsset,
) {
  if (
    asset.lifecycle !== "verified" &&
    asset.lifecycle !== "rejected" &&
    asset.lifecycle !== "expired"
  ) {
    return { status: "conflict" as const };
  }
  const claimedAt = new Date();
  const claimed = await claimMediaCleanup(executor, workspaceId, {
    id: asset.id,
    version: asset.version,
    lifecycle: asset.lifecycle,
    claimedAt,
    claimUntil: new Date(claimedAt.getTime() + CLEANUP_CLAIM_MS),
  });
  if (claimed.status !== "claimed") return claimed;

  try {
    await storage.delete([claimed.asset.objectKey]);
    const removed = await markMediaObjectRemoved(executor, workspaceId, {
      id: claimed.asset.id,
      version: claimed.asset.version,
      lifecycle: claimed.asset.lifecycle,
    });
    return removed.status === "updated"
      ? ({ status: "removed" } as const)
      : removed;
  } catch {
    const failed = await markMediaDeleteFailed(executor, workspaceId, {
      id: claimed.asset.id,
      version: claimed.asset.version,
      lifecycle: claimed.asset.lifecycle,
    });
    return failed.status === "updated"
      ? ({ status: "delete_failed" } as const)
      : failed;
  }
}

async function rejectAndDelete(
  executor: Executor,
  storage: Storage,
  workspaceId: string,
  asset: MediaAsset,
  reason: RejectionReason,
  observed: ObservedMedia,
) {
  const marked = await markMediaRejected(executor, workspaceId, {
    id: asset.id,
    version: asset.version,
    reason,
    ...observed,
  });
  if (marked.status === "updated") {
    await cleanupMediaAsset(executor, storage, workspaceId, marked.asset);
  }
}

export async function verifyMediaUpload(
  executor: Executor,
  storage: Storage,
  workspaceId: string,
  mediaAssetId: string,
) {
  const current = await getMediaAsset(executor, workspaceId, mediaAssetId);
  if (!current) return { status: "not_found" as const };
  if (current.lifecycle !== "uploaded") {
    return { status: "replayed" as const, lifecycle: current.lifecycle };
  }

  const claimed = await claimMediaValidation(executor, workspaceId, {
    id: current.id,
    version: current.version,
  });
  if (claimed.status !== "updated") return claimed;
  const asset = claimed.asset;

  const inspection = await inspect(storage, asset);
  if (inspection.status === "rejected") {
    await rejectAndDelete(
      executor,
      storage,
      workspaceId,
      asset,
      inspection.reason,
      inspection.observed,
    );
    return { status: "rejected" as const, reason: inspection.reason };
  }

  const cleanupDelayMs = VERIFIED_CLEANUP_DELAY_MS[asset.kind];
  const verified = await markMediaVerified(executor, workspaceId, {
    id: asset.id,
    version: asset.version,
    cleanupAfter:
      cleanupDelayMs === undefined
        ? null
        : new Date(Date.now() + cleanupDelayMs),
    ...inspection.observed,
  });
  return verified.status === "updated"
    ? { status: "verified" as const }
    : verified;
}
