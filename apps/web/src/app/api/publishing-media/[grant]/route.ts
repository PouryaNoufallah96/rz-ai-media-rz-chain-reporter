import "server-only";

import { fetchPublishingMediaGrant } from "@rz-chain-reporter/db/repositories/publishing-media-grant";

import { mediaStorage } from "@/features/media/lib/storage";
import { streamPublishingMediaGrant } from "@/server/publishing-media-grant";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

export async function GET(
  _request: Request,
  context: RouteContext<"/api/publishing-media/[grant]">,
) {
  const { grant } = await context.params;
  const database = rpcDb();
  const workspaceId = await resolveInstallationWorkspaceId(database);

  return streamPublishingMediaGrant(grant, {
    findGrant: (tokenHash, now) =>
      fetchPublishingMediaGrant(database, workspaceId, tokenHash, now),
    now: () => new Date(),
    openRead: (objectKey) =>
      mediaStorage()
        .openRead(objectKey)
        .catch((error: unknown) => {
          if (isMissingObject(error)) return null;
          throw error;
        }),
  });
}

function isMissingObject(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "NotFound" || error.name === "NoSuchKey")
  );
}
