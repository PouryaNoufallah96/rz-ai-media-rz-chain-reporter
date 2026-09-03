import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { marketAnalysisTags } from "../../db/cache/tags";
import {
  readMarketAnalysisDynamicOverlay,
  readMarketAnalysisHistoryBase,
} from "../../db/queries";
import type { MarketAnalysisHistoryQuery } from "../../schemas/search";

export async function getMarketAnalysisHistory(
  query: MarketAnalysisHistoryQuery,
) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const base = await readCachedMarketAnalysisHistory(
    workspaceId,
    session.user.id,
    query,
  );
  const overlay = await readMarketAnalysisDynamicOverlay(
    rpcDb(),
    workspaceId,
    session.user.id,
    base.rows.map((row) => row.id),
  );
  return { base, overlay };
}

async function readCachedMarketAnalysisHistory(
  workspaceId: string,
  userId: string,
  query: MarketAnalysisHistoryQuery,
) {
  "use cache";
  cacheTag(marketAnalysisTags.reads(workspaceId));
  cacheLife("minutes");
  return readMarketAnalysisHistoryBase(rpcDb(), workspaceId, userId, query);
}
