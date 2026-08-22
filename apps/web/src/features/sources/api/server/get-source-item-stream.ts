import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { sourcesTags } from "../../db/cache/tags";
import { readSourceItemFilters, readSourceItemPage } from "../../db/queries";
import {
  loadStreamSearchParams,
  normalizeStreamQuery,
  type SourceItemStream,
  type StreamQuery,
  type StreamSearchParams,
} from "../../schemas/stream";

export async function getSourceItemStream(
  searchParams: StreamSearchParams,
): Promise<SourceItemStream> {
  await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const query = normalizeStreamQuery(
    await loadStreamSearchParams(searchParams),
  );

  return { ...(await readCachedSourceItemStream(workspaceId, query)), query };
}

async function readCachedSourceItemStream(
  workspaceId: string,
  query: StreamQuery,
) {
  "use cache";
  cacheTag(sourcesTags.reads(workspaceId));
  cacheLife("minutes");

  const database = rpcDb();
  const [page, filters] = await Promise.all([
    readSourceItemPage(database, workspaceId, query),
    readSourceItemFilters(database, workspaceId),
  ]);

  return { ...filters, page };
}
