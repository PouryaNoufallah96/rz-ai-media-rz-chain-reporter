import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { accountTags } from "../../db/cache/tags";
import { readAccountSummary } from "../../db/queries";

export async function getAccountSummary() {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedAccountSummary(workspaceId, session.user.id);
}

async function readCachedAccountSummary(workspaceId: string, userId: string) {
  "use cache";
  cacheTag(...accountTags.summaryReads(workspaceId));
  cacheLife("minutes");
  return readAccountSummary(rpcDb(), workspaceId, userId);
}
