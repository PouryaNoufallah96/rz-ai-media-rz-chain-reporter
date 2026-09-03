"use client";

import { marketAnalysisChangedRealtimeMessageSchema } from "@rz-chain-reporter/contracts";

import { useRealtimeFreshness } from "@/hooks/use-realtime-freshness";

import { getMarketAnalysisRealtimeToken } from "../actions/get-realtime-token";
import { refreshMarketAnalysisReadsAction } from "../actions/refresh-market-analysis-reads";

export function useMarketAnalysisFreshness(analysisId: string) {
  return useRealtimeFreshness({
    isRelevantMessage: (data) => {
      const parsed = marketAnalysisChangedRealtimeMessageSchema.safeParse(data);
      return parsed.success && parsed.data.marketAnalysisId === analysisId;
    },
    mintToken: () => getMarketAnalysisRealtimeToken(analysisId),
    refreshAction: refreshMarketAnalysisReadsAction,
  });
}
