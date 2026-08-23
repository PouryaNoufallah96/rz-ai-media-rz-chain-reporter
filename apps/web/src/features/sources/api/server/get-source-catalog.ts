import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { sourcesTags } from "../../db/cache/tags";
import { readSourceCatalog } from "../../db/queries";
import type { SourceCatalog } from "../../schemas/catalog";

export async function getSourceCatalog(): Promise<SourceCatalog> {
  await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());

  return readCachedSourceCatalog(workspaceId);
}

async function readCachedSourceCatalog(workspaceId: string) {
  "use cache";
  cacheTag(sourcesTags.reads(workspaceId));
  cacheLife("minutes");

  return readSourceCatalog(rpcDb(), workspaceId);
}
