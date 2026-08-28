import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { editorialTags } from "../../db/cache/tags";
import { readRecentTopics } from "../../db/queries";

export async function getRecentTopics(): Promise<string[]> {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());

  return readCachedRecentTopics(workspaceId, session.user.id);
}

async function readCachedRecentTopics(workspaceId: string, userId: string) {
  "use cache";
  cacheTag(editorialTags.reads(workspaceId));
  cacheLife("minutes");

  return readRecentTopics(rpcDb(), workspaceId, userId);
}
