import "server-only";

import { problemResponse, withRequestId } from "@rz-chain-reporter/api/request";
import { findServableFinalMedia } from "@rz-chain-reporter/db/repositories/image-generation";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { mediaStorage } from "@/features/media/lib/storage";
import { createInstallationContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";

const mediaAssetIdSchema = z.uuid();
const imageExtensions = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/media/[mediaAssetId]">,
) {
  const installation = createInstallationContext(request.headers);
  const { requestId } = installation;
  const session = await installation.getSession();
  if (!session?.user) {
    return problemResponse(requestId, 401, "unauthorized", "Unauthorized");
  }
  const { mediaAssetId } = await context.params;
  const parsed = mediaAssetIdSchema.safeParse(mediaAssetId);
  if (!parsed.success) {
    return problemResponse(requestId, 404, "not_found", "Not found");
  }
  const asset = await findServableFinalMedia(
    rpcDb(),
    await installation.getWorkspaceId(),
    parsed.data,
  );
  if (!asset) {
    return problemResponse(requestId, 404, "not_found", "Not found");
  }
  const opened = await mediaStorage()
    .openRead(asset.objectKey)
    .catch((error: unknown) => {
      if (isMissingObject(error)) return null;
      throw error;
    });
  if (!opened) {
    return problemResponse(requestId, 404, "not_found", "Not found");
  }
  const disposition =
    new URL(request.url).searchParams.get("download") === "1"
      ? "attachment"
      : "inline";
  return withRequestId(
    new Response(opened.stream, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `${disposition}; filename="${parsed.data}.${imageExtensions[asset.mimeType]}"`,
        "content-length": String(asset.actualBytes),
        "content-type": asset.mimeType,
        "x-content-type-options": "nosniff",
      },
    }),
    requestId,
  );
}

function isMissingObject(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "NotFound" || error.name === "NoSuchKey")
  );
}
