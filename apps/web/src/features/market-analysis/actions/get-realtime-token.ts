"use server";

import { MARKET_ANALYSIS_REALTIME_CHANGED_TOPIC } from "@rz-chain-reporter/contracts";
import { marketAnalysisRealtimeChannel } from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { readOwnedMarketAnalysisCommandState } from "../db/queries";

export async function getMarketAnalysisRealtimeToken(analysisId: string) {
  const session = await requireActionSession();
  const database = rpcDb();
  const workspaceId = await resolveInstallationWorkspaceId(database);
  const analysis = await readOwnedMarketAnalysisCommandState(
    database,
    workspaceId,
    session.user.id,
    analysisId,
  );
  if (!analysis) return { status: "unavailable" as const };
  return mintSubscriptionToken(
    marketAnalysisRealtimeChannel(workspaceId, analysisId),
    [MARKET_ANALYSIS_REALTIME_CHANGED_TOPIC],
  );
}
