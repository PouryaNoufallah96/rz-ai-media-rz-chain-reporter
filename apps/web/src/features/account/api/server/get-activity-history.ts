import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { accountTags } from "../../db/cache/tags";
import { readActivityHistory } from "../../db/queries";

export async function getActivityHistory() {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedActivityHistory(workspaceId, session.user.id);
}

async function readCachedActivityHistory(workspaceId: string, userId: string) {
  "use cache";
  cacheTag(...accountTags.summaryReads(workspaceId));
  cacheLife("minutes");
  return readActivityHistory(rpcDb(), workspaceId, userId);
}
