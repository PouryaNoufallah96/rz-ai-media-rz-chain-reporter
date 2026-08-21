import "server-only";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { readUsagePage, readUsageSummary } from "../../db/queries";
import {
  loadUsageSearchParams,
  normalizeUsageQuery,
  type UsageSearchParams,
} from "../../schemas/usage";

export async function getUsageView(searchParams: UsageSearchParams) {
  await requireSession();
  const database = rpcDb();
  const workspaceId = await resolveInstallationWorkspaceId(database);
  const query = normalizeUsageQuery(await loadUsageSearchParams(searchParams));
  const [summary, page] = await Promise.all([
    readUsageSummary(database, workspaceId, query),
    readUsagePage(database, workspaceId, query),
  ]);

  return { page, query, summary };
}
