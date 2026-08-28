"use client";

import { publishingChangedRealtimeMessageSchema } from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import { getPublishingRealtimeToken } from "../actions/get-realtime-token";
import { refreshPublishingReadsAction } from "../actions/refresh-publishing-reads";

type PublishingFreshnessState =
  | "current"
  | "reconnecting"
  | "stale"
  | "unavailable";

export function usePublishingFreshness() {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [unavailable, setUnavailable] = useState(false);
  const connectionActive = useRef(false);
  const hasConnected = useRef(false);
  const rerender = () => startRefresh(() => router.refresh());
  const requestToken = () =>
    getPublishingRealtimeToken().then((result) => {
      if (result.status === "unavailable") {
        setUnavailable(true);
        throw new Error("Publishing realtime unavailable");
      }
      return result.token;
    });
  const realtime = useRealtime({
    autoCloseOnTerminal: false,
    enabled: !unavailable,
    historyLimit: 1,
    pauseOnHidden: true,
    ...(!unavailable ? { token: requestToken } : {}),
  });
  const hasAuthoritativeEvent = realtime.messages.all.some(
    (message) =>
      publishingChangedRealtimeMessageSchema.safeParse(message.data).success,
  );
  const refreshLatest = useEffectEvent(rerender);
  const resetRealtime = useEffectEvent(realtime.reset);
  useEffect(() => {
    const hasValidEvent = realtime.messages.delta.some(
      (message) =>
        publishingChangedRealtimeMessageSchema.safeParse(message.data).success,
    );
    if (!hasValidEvent) {
      return;
    }
    refreshLatest();
  }, [realtime.messages.delta]);
  useEffect(() => {
    if (realtime.connectionStatus === "open") {
      if (hasConnected.current && !connectionActive.current) refreshLatest();
      hasConnected.current = true;
      connectionActive.current = true;
      return;
    }
    if (!connectionActive.current) return;
    connectionActive.current = false;
    resetRealtime();
  }, [realtime.connectionStatus]);
  return {
    isRefreshing,
    refresh: () => {
      setUnavailable(false);
      startRefresh(refreshPublishingReadsAction);
    },
    freshness: freshnessOf(
      !unavailable,
      realtime.connectionStatus,
      hasAuthoritativeEvent,
    ),
  };
}

function freshnessOf(
  available: boolean,
  status: "idle" | "connecting" | "open" | "paused" | "closed" | "error",
  hasAuthoritativeEvent: boolean,
): PublishingFreshnessState {
  if (!available) return "unavailable";
  if (status === "open") {
    return hasAuthoritativeEvent ? "current" : "stale";
  }
  if (status === "idle" || status === "connecting") return "reconnecting";
  return "stale";
}
