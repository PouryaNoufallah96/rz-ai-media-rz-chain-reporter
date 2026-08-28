import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { readAccountSummary } from "../../db/queries";

export async function getAccountSummary() {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedAccountSummary(workspaceId, session.user.id);
}

async function readCachedAccountSummary(workspaceId: string, userId: string) {
  "use cache";
  cacheTag(
    workspaceCacheTag(workspaceId, "drafts"),
    workspaceCacheTag(workspaceId, "publishing"),
  );
  cacheLife("minutes");
  return readAccountSummary(rpcDb(), workspaceId, userId);
}
