import { createHash } from "node:crypto";
import { REFERENCE_IMAGE_MIME_TYPES } from "@rz-chain-reporter/contracts";
import type { Storage } from "@rz-chain-reporter/storage";
import { storageFromBindings } from "@rz-chain-reporter/storage";
import sharp from "sharp";

import { ImagePreparationError } from "../model-gateway/errors";
import { workerEnv } from "../runtime/env";

const MAX_PROVIDER_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_BRANDED_FINAL_BYTES = 12 * 1024 * 1024;
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
  const metadata = await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: input.maxPixels,
  })
    .metadata()
    .catch(() => {
      throw new ImagePreparationError({ outcome: "definite" });
    });
  const decodedMime = metadata.format
    ? MIME_BY_FORMAT[metadata.format as keyof typeof MIME_BY_FORMAT]
    : undefined;
  if (
    !decodedMime ||
    decodedMime !== input.mimeType ||
    !metadata.width ||
    !metadata.height ||
    metadata.width > input.maxDimension ||
    metadata.height > input.maxDimension ||
    metadata.width * metadata.height > input.maxPixels ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new ImagePreparationError({ outcome: "definite" });
  }
  await sharp(bytes, {
    failOn: "warning",
    limitInputPixels: input.maxPixels,
  })
    .stats()
    .catch(() => {
      throw new ImagePreparationError({ outcome: "definite" });
    });
  return {
    height: metadata.height,
    mimeType: decodedMime,
    width: metadata.width,
  };
}

export function workerStorage() {
  return storageFromBindings(workerEnv);
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
