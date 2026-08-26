import "server-only";

import { MAX_REFERENCE_IMAGE_BYTES } from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  createMediaUploadIntent,
  resolveMediaAssetObjectOwnership,
} from "@rz-chain-reporter/db/repositories/media-asset";

import { mediaStorage } from "./storage";

const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

class MediaUploadOwnershipUncertainError extends Error {
  readonly code = "MEDIA_UPLOAD_OWNERSHIP_UNCERTAIN";

  constructor(
    readonly objectKey: string,
    cause: unknown,
  ) {
    super("MEDIA_UPLOAD_OWNERSHIP_UNCERTAIN", { cause });
    this.name = "MediaUploadOwnershipUncertainError";
  }
}

class MediaUploadCompensationFailedError extends Error {
  readonly code = "MEDIA_UPLOAD_COMPENSATION_FAILED";

  constructor(
    readonly objectKey: string,
    cause: unknown,
  ) {
    super("MEDIA_UPLOAD_COMPENSATION_FAILED", { cause });
    this.name = "MediaUploadCompensationFailedError";
  }
}

export async function createUploadIntent(
  executor: Executor,
  workspaceId: string,
  input: {
    file: File;
    declaredBytes: number;
    declaredChecksum: string;
    declaredMimeType: string;
    kind: string;
  },
) {
  const id = crypto.randomUUID();
  const objectKey = `${workspaceId}/uploads/${id}`;
  const storage = mediaStorage();
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  if (bytes.byteLength > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("MEDIA_FILE_TOO_LARGE");
  }
  await storage.put(objectKey, bytes, input.declaredMimeType);
  try {
    return await createMediaUploadIntent(executor, workspaceId, {
      id,
      objectKey,
      kind: input.kind,
      mimeType: input.declaredMimeType,
      declaredBytes: input.declaredBytes,
      checksum: input.declaredChecksum,
      uploadExpiresAt: new Date(Date.now() + UPLOAD_WINDOW_MS),
    });
  } catch (error) {
    const ownership = await resolveMediaAssetObjectOwnership(
      executor,
      workspaceId,
      objectKey,
    );
    if (ownership.status === "committed") return ownership.asset;
    if (ownership.status === "uncertain") {
      throw new MediaUploadOwnershipUncertainError(objectKey, error);
    }
    try {
      await storage.delete([objectKey]);
    } catch (cleanupError) {
      throw new MediaUploadCompensationFailedError(objectKey, cleanupError);
    }
    throw error;
  }
}
