import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { installationTags } from "../../db/cache/tags";
import { readInstallationOverview } from "../../db/queries";

export async function getInstallationOverview() {
  await requireSession();

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return readCachedOverview(workspaceId);
}

async function readCachedOverview(workspaceId: string) {
  "use cache";
  cacheTag(installationTags.overview(workspaceId));
  cacheLife("hours");
  return readInstallationOverview(rpcDb(), workspaceId);
}
