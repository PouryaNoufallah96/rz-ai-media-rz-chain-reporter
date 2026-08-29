"use client";

import { usageLedgerRealtimeMessageSchema } from "@rz-chain-reporter/contracts";

import { useRealtimeFreshness } from "@/hooks/use-realtime-freshness";

import { getUsageRealtimeToken } from "../actions/get-realtime-token";
import { refreshUsageReadsAction } from "../actions/refresh-usage-reads";

export function useUsageFreshness() {
  return useRealtimeFreshness({
    isRelevantMessage: (data) =>
      usageLedgerRealtimeMessageSchema.safeParse(data).success,
    mintToken: getUsageRealtimeToken,
    refreshAction: refreshUsageReadsAction,
  });
}
