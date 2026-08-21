import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";
import { createMediaUploadIntent } from "@rz-chain-reporter/db/repositories/media-asset";

import { mediaStorage } from "./storage";

const UPLOAD_WINDOW_MS = 15 * 60 * 1000;

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
  await storage.put(
    objectKey,
    new Uint8Array(await input.file.arrayBuffer()),
    input.declaredMimeType,
  );
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
    try {
      await storage.delete([objectKey]);
    } catch (cleanupError) {
      throw new Error("media upload intent persistence and cleanup failed", {
        cause: cleanupError,
      });
    }
    throw error;
  }
}
