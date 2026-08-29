"use client";

import { sourcesChangedRealtimeMessageSchema } from "@rz-chain-reporter/contracts";

import { useRealtimeFreshness } from "@/hooks/use-realtime-freshness";

import { getSourcesRealtimeToken } from "../actions/get-realtime-token";
import { refreshSourceReadsAction } from "../actions/refresh-source-reads";

export function useSourcesFreshness() {
  return useRealtimeFreshness({
    isRelevantMessage: (data) =>
      sourcesChangedRealtimeMessageSchema.safeParse(data).success,
    mintToken: getSourcesRealtimeToken,
    refreshAction: refreshSourceReadsAction,
  });
}
