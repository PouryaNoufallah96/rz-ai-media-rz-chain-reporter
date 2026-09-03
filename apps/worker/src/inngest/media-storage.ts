import { createHash } from "node:crypto";
import { REFERENCE_IMAGE_MIME_TYPES } from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { scheduleDetachedMediaCleanup } from "@rz-chain-reporter/db/repositories/media-asset";
import { ImagePreparationError } from "@rz-chain-reporter/model-gateway/errors";
import type { Storage } from "@rz-chain-reporter/storage";
import { storageFromBindings } from "@rz-chain-reporter/storage";
import sharp from "sharp";
import { workerEnv } from "../runtime/env";

const MAX_PROVIDER_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_BRANDED_FINAL_BYTES = 12 * 1024 * 1024;
const MAX_MARKET_CHART_BYTES = 12 * 1024 * 1024;
const BRANDED_FINAL_MIME_TYPE = "image/png";
const MAX_PROVIDER_IMAGE_DIMENSION = 8192;
const MAX_PROVIDER_IMAGE_PIXELS = 64_000_000;
const MIME_BY_FORMAT = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
} as const;
const SUPPORTED_IMAGE_MIME_TYPES: ReadonlySet<string> = new Set(
  REFERENCE_IMAGE_MIME_TYPES,
);

export async function decodeStaticRaster(
  bytes: Uint8Array,
  bounds: { maxDimension: number; maxPixels: number },
) {
  try {
    const image = sharp(bytes, {
      failOn: "warning",
      limitInputPixels: bounds.maxPixels,
    });
    const metadata = await image.metadata();
    await image.stats();
    const mimeType = metadata.format
      ? MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT]
      : undefined;
    if (
      !mimeType ||
      !metadata.width ||
      !metadata.height ||
      metadata.width > bounds.maxDimension ||
      metadata.height > bounds.maxDimension ||
      metadata.width * metadata.height > bounds.maxPixels ||
      (metadata.pages ?? 1) !== 1
    ) {
      return null;
    }
    return { height: metadata.height, mimeType, width: metadata.width };
  } catch {
    return null;
  }
}

export async function validateStaticRaster(
  bytes: Uint8Array,
  input: {
    maxBytes: number;
    maxDimension: number;
    maxPixels: number;
    mimeType: string;
  },
) {
  if (
    bytes.byteLength === 0 ||
    bytes.byteLength > input.maxBytes ||
    !SUPPORTED_IMAGE_MIME_TYPES.has(input.mimeType)
  ) {
    throw new ImagePreparationError({ outcome: "definite" });
  }
  const decoded = await decodeStaticRaster(bytes, {
    maxDimension: input.maxDimension,
    maxPixels: input.maxPixels,
  });
  if (!decoded || decoded.mimeType !== input.mimeType) {
    throw new ImagePreparationError({ outcome: "definite" });
  }
  return decoded;
}

export function workerStorage() {
  return storageFromBindings(workerEnv);
}

export async function scheduleDetachedMarketMediaCleanup(
  executor: Executor,
  workspaceId: string,
  mediaAssetIds: readonly string[],
  detachedAt = new Date(),
) {
  const scheduled: string[] = [];
  for (const mediaAssetId of new Set(mediaAssetIds)) {
    const asset = await executor.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      return scheduleDetachedMediaCleanup(
        tx,
        workspaceId,
        mediaAssetId,
        detachedAt,
      );
    });
    if (asset?.cleanupAfter) scheduled.push(mediaAssetId);
  }
  return scheduled;
}

export async function readStorageBytes(storage: Storage, objectKey: string) {
  const opened = await storage.openRead(objectKey);
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of opened.stream) {
    chunks.push(chunk);
    length += chunk.byteLength;
    if (length > 20 * 1024 * 1024) throw new Error("IMAGE_BYTES_TOO_LARGE");
  }
  const bytes = Buffer.concat(
    chunks.map((chunk) => Buffer.from(chunk)),
    length,
  );
  return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

export async function prepareProviderOriginal(
  storage: Storage,
  input: {
    bytes: Uint8Array;
    mediaAssetId: string;
    mimeType: string;
    objectKey: string;
  },
) {
  await validateStaticRaster(input.bytes, {
    maxBytes: MAX_PROVIDER_IMAGE_BYTES,
    maxDimension: MAX_PROVIDER_IMAGE_DIMENSION,
    maxPixels: MAX_PROVIDER_IMAGE_PIXELS,
    mimeType: input.mimeType,
  });
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  await storage.put(input.objectKey, input.bytes, input.mimeType).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  const stored = await readStorageBytes(storage, input.objectKey).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  const storedChecksum = createHash("sha256").update(stored).digest("hex");
  if (
    stored.byteLength !== input.bytes.byteLength ||
    storedChecksum !== checksum
  ) {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  }
  const storedDecoded = await validateStaticRaster(stored, {
    maxBytes: MAX_PROVIDER_IMAGE_BYTES,
    maxDimension: MAX_PROVIDER_IMAGE_DIMENSION,
    maxPixels: MAX_PROVIDER_IMAGE_PIXELS,
    mimeType: input.mimeType,
  }).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  return {
    actualBytes: stored.byteLength,
    checksum,
    height: storedDecoded.height,
    mediaAssetId: input.mediaAssetId,
    mimeType: input.mimeType,
    objectKey: input.objectKey,
    width: storedDecoded.width,
  };
}

export async function compensateProviderOriginal(
  storage: Storage,
  objectKey: string,
) {
  try {
    await storage.delete([objectKey]);
    return { objectKey, status: "compensated" as const };
  } catch {
    return { objectKey, status: "uncertain" as const };
  }
}

export async function prepareBrandedFinal(
  storage: Storage,
  input: {
    bytes: Uint8Array;
    height: number;
    mediaAssetId: string;
    objectKey: string;
    width: number;
  },
) {
  const bounds = {
    maxBytes: MAX_BRANDED_FINAL_BYTES,
    maxDimension: Math.max(input.width, input.height),
    maxPixels: input.width * input.height,
    mimeType: BRANDED_FINAL_MIME_TYPE,
  };
  const decoded = await validateStaticRaster(input.bytes, bounds);
  if (decoded.width !== input.width || decoded.height !== input.height) {
    throw new ImagePreparationError({ outcome: "definite" });
  }
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  await storage
    .put(input.objectKey, input.bytes, BRANDED_FINAL_MIME_TYPE)
    .catch(() => {
      throw new ImagePreparationError({ outcome: "ambiguous" });
    });
  const stored = await readStorageBytes(storage, input.objectKey).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  if (
    stored.byteLength !== input.bytes.byteLength ||
    createHash("sha256").update(stored).digest("hex") !== checksum
  ) {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  }
  const storedDecoded = await validateStaticRaster(stored, bounds).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  if (
    storedDecoded.width !== input.width ||
    storedDecoded.height !== input.height
  ) {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  }
  return {
    actualBytes: stored.byteLength,
    checksum,
    height: storedDecoded.height,
    mediaAssetId: input.mediaAssetId,
    mimeType: BRANDED_FINAL_MIME_TYPE,
    objectKey: input.objectKey,
    width: storedDecoded.width,
  };
}

export async function prepareMarketChartRender(
  storage: Storage,
  input: {
    bytes: Uint8Array;
    height: number;
    mediaAssetId: string;
    objectKey: string;
    width: number;
  },
) {
  const bounds = {
    maxBytes: MAX_MARKET_CHART_BYTES,
    maxDimension: Math.max(input.width, input.height),
    maxPixels: input.width * input.height,
    mimeType: BRANDED_FINAL_MIME_TYPE,
  };
  const decoded = await validateStaticRaster(input.bytes, bounds);
  if (decoded.width !== input.width || decoded.height !== input.height) {
    throw new ImagePreparationError({ outcome: "definite" });
  }
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  await storage
    .put(input.objectKey, input.bytes, BRANDED_FINAL_MIME_TYPE)
    .catch(() => {
      throw new ImagePreparationError({ outcome: "ambiguous" });
    });
  const stored = await readStorageBytes(storage, input.objectKey).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  const storedDecoded = await validateStaticRaster(stored, bounds).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  if (
    stored.byteLength !== input.bytes.byteLength ||
    storedDecoded.width !== input.width ||
    storedDecoded.height !== input.height ||
    createHash("sha256").update(stored).digest("hex") !== checksum
  ) {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  }
  return {
    actualBytes: stored.byteLength,
    checksum,
    height: storedDecoded.height,
    mediaAssetId: input.mediaAssetId,
    mimeType: BRANDED_FINAL_MIME_TYPE,
    objectKey: input.objectKey,
    width: storedDecoded.width,
  };
}

export const compensateMarketChartRender = compensateProviderOriginal;

export async function readVerifiedProviderOriginal(
  storage: Storage,
  asset: {
    actualBytes: number;
    checksum: string;
    height: number;
    mimeType: string;
    objectKey: string;
    width: number;
  },
) {
  const bytes = await readStorageBytes(storage, asset.objectKey).catch(() => {
    throw new ImagePreparationError({ outcome: "ambiguous" });
  });
  const decoded = await validateStaticRaster(bytes, {
    maxBytes: MAX_PROVIDER_IMAGE_BYTES,
    maxDimension: MAX_PROVIDER_IMAGE_DIMENSION,
    maxPixels: MAX_PROVIDER_IMAGE_PIXELS,
    mimeType: asset.mimeType,
  });
  if (
    bytes.byteLength !== asset.actualBytes ||
    decoded.width !== asset.width ||
    decoded.height !== asset.height ||
    createHash("sha256").update(bytes).digest("hex") !== asset.checksum
  ) {
    throw new ImagePreparationError({ outcome: "definite" });
  }
  return bytes;
}
