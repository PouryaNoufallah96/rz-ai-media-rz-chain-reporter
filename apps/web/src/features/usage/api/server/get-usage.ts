import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { usageTags } from "../../db/cache/tags";
import { readUsagePage, readUsageSummary } from "../../db/queries";
import {
  loadUsageSearchParams,
  normalizeUsageQuery,
  type UsageQuery,
  type UsageSearchParams,
} from "../../schemas/usage";

export async function getUsageView(searchParams: UsageSearchParams) {
  await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const query = normalizeUsageQuery(await loadUsageSearchParams(searchParams));

  return { ...(await readCachedUsage(workspaceId, query)), query };
}

async function readCachedUsage(workspaceId: string, query: UsageQuery) {
  "use cache";
  cacheTag(usageTags.ledger(workspaceId));
  cacheLife("minutes");

  const database = rpcDb();
  const [summary, page] = await Promise.all([
    readUsageSummary(database, workspaceId, query),
    readUsagePage(database, workspaceId, query),
  ]);

  return { page, summary };
}
