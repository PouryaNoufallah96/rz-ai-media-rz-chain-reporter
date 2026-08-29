"use client";

import { publishingChangedRealtimeMessageSchema } from "@rz-chain-reporter/contracts";

import { useRealtimeFreshness } from "@/hooks/use-realtime-freshness";

import { getPublishingRealtimeToken } from "../actions/get-realtime-token";
import { refreshPublishingReadsAction } from "../actions/refresh-publishing-reads";

export function usePublishingFreshness() {
  const freshness = useRealtimeFreshness({
    isRelevantMessage: (data) =>
      publishingChangedRealtimeMessageSchema.safeParse(data).success,
    mintToken: getPublishingRealtimeToken,
    refreshAction: refreshPublishingReadsAction,
  });
  const state: "current" | "reconnecting" | "stale" | "unavailable" =
    freshness.transport === "live" ? "current" : freshness.transport;

  return {
    ...freshness,
    freshness: state,
  };
}
