"use client";

import { usageLedgerRealtimeMessageSchema } from "@rz-chain-reporter/contracts";
import { useEffect, useEffectEvent } from "react";

import { useRealtimeFreshness } from "@/hooks/use-realtime-freshness";

import { getUsageRealtimeToken } from "../actions/get-realtime-token";
import { refreshUsageReadsAction } from "../actions/refresh-usage-reads";
import { subscribeToUsageRefresh } from "../lib/usage-refresh-signal";

export function useUsageFreshness() {
  const freshness = useRealtimeFreshness({
    isRelevantMessage: (data) =>
      usageLedgerRealtimeMessageSchema.safeParse(data).success,
    mintToken: getUsageRealtimeToken,
    refreshAction: refreshUsageReadsAction,
  });
  const refreshAfterAssistant = useEffectEvent(() => {
    freshness.refresh();
  });

  useEffect(() => subscribeToUsageRefresh(() => refreshAfterAssistant()), []);

  return freshness;
}
