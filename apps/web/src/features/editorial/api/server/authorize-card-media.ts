import "server-only";

import { rpcDb } from "@/server/rpc/db";

import { ownedDraftSelectedMediaExists } from "../../db/queries";

export function canReadOwnedCardMedia(
  workspaceId: string,
  userId: string,
  mediaAssetId: string,
) {
  return ownedDraftSelectedMediaExists(
    rpcDb(),
    workspaceId,
    userId,
    mediaAssetId,
  );
}
