import "server-only";

import { problemResponse, withRequestId } from "@rz-chain-reporter/api/request";
import {
  canReadOwnedMarketMedia,
  findServableMedia,
} from "@rz-chain-reporter/db/repositories/servable-media";
import { isMissingStorageObject } from "@rz-chain-reporter/storage";
import type { NextRequest } from "next/server";
import { z } from "zod";

import { canReadOwnedCardMedia } from "@/features/editorial/api/server/authorize-card-media";
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
  const workspaceId = await installation.getWorkspaceId();
  const database = rpcDb();
  const [cardAuthorized, marketMedia] = await Promise.all([
    canReadOwnedCardMedia(workspaceId, session.user.id, parsed.data),
    canReadOwnedMarketMedia(
      database,
      workspaceId,
      session.user.id,
      parsed.data,
    ),
  ]);
  if (!cardAuthorized && !marketMedia) {
    return problemResponse(requestId, 404, "not_found", "Not found");
  }
  const asset = await findServableMedia(database, workspaceId, parsed.data);
  if (!asset) {
    return problemResponse(requestId, 404, "not_found", "Not found");
  }
  const opened = await mediaStorage()
    .openRead(asset.objectKey)
    .catch((error: unknown) => {
      if (isMissingStorageObject(error)) return null;
      throw error;
    });
  if (!opened) {
    return problemResponse(requestId, 404, "not_found", "Not found");
  }
  const disposition =
    new URL(request.url).searchParams.get("download") === "1"
      ? "attachment"
      : "inline";
  const extension = imageExtensions[asset.mimeType];
  const filename = marketMedia
    ? marketMediaFilename(marketMedia, extension)
    : `${parsed.data}.${extension}`;
  return withRequestId(
    new Response(opened.stream, {
      headers: {
        "cache-control": "private, no-store",
        "content-disposition": `${disposition}; filename="${filename}"`,
        "content-length": String(asset.actualBytes),
        "content-type": asset.mimeType,
        "x-content-type-options": "nosniff",
      },
    }),
    requestId,
  );
}

function marketMediaFilename(
  input: NonNullable<Awaited<ReturnType<typeof canReadOwnedMarketMedia>>>,
  extension: string,
) {
  const stem = [
    input.ownerKey,
    input.symbols.join("-"),
    input.period,
    input.format,
    input.analysisId.slice(0, 8),
  ]
    .map(filenamePart)
    .filter(Boolean)
    .join("-")
    .slice(0, 120)
    .replace(/-+$/u, "");
  return `${stem || "market-analysis"}.${extension}`;
}

function filenamePart(value: string) {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}
