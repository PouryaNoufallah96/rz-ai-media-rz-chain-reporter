import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { publishingTags } from "../../db/cache/tags";
import { readSavedHistory } from "../../db/queries";
import type { SavedQuery } from "../../schemas/history";

export async function getSavedHistory(query: SavedQuery) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return {
    page: await readCachedSavedHistory(workspaceId, session.user.id, query),
    query,
  };
}

async function readCachedSavedHistory(
  workspaceId: string,
  userId: string,
  query: SavedQuery,
) {
  "use cache";
  cacheTag(
    publishingTags.reads(workspaceId),
    publishingTags.savedRevisionReads(workspaceId),
  );
  cacheLife("minutes");
  return readSavedHistory(rpcDb(), workspaceId, userId, query);
}
