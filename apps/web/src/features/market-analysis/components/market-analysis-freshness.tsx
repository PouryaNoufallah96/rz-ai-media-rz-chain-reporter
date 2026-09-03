"use client";

import { useMarketAnalysisFreshness } from "../hooks/use-market-analysis-freshness";

export function MarketAnalysisFreshness({
  analysisId,
}: {
  analysisId: string;
}) {
  useMarketAnalysisFreshness(analysisId);
  return null;
}
