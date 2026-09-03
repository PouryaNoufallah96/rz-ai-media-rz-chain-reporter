import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { marketAnalysisTags } from "../../db/cache/tags";
import {
  readMarketAnalysisReportCore,
  readMarketAnalysisReportLive,
} from "../../db/queries";

export async function getMarketAnalysisReport(analysisId: string) {
  const session = await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const core = await readCachedMarketAnalysisReport(
    workspaceId,
    session.user.id,
    analysisId,
  );
  if (!core) return null;
  return {
    core,
    live: requireMarketAnalysisReportLive(
      workspaceId,
      session.user.id,
      analysisId,
    ),
  };
}

async function requireMarketAnalysisReportLive(
  workspaceId: string,
  userId: string,
  analysisId: string,
) {
  const live = await readMarketAnalysisReportLive(
    rpcDb(),
    workspaceId,
    userId,
    analysisId,
  );
  if (!live) throw new Error("Market Analysis report live data is unavailable");
  return live;
}

async function readCachedMarketAnalysisReport(
  workspaceId: string,
  userId: string,
  analysisId: string,
) {
  "use cache";
  cacheTag(marketAnalysisTags.reads(workspaceId));
  cacheLife("minutes");
  return readMarketAnalysisReportCore(rpcDb(), workspaceId, userId, analysisId);
}
