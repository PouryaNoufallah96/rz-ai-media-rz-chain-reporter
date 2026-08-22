"use client";

import { usageLedgerRealtimeMessageSchema } from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import { getUsageRealtimeToken } from "../actions/get-realtime-token";
import { refreshUsageReadsAction } from "../actions/refresh-usage-reads";

export type UsageTransport = "live" | "reconnecting" | "stale" | "unavailable";

export function useUsageFreshness() {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const hasConnected = useRef(false);

  const rerenderNow = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const requestToken = () =>
    getUsageRealtimeToken()
      .then((result) => {
        if (result.status === "unavailable") {
          throw new Error("Usage realtime subscription is unavailable");
        }
        return result.token;
      })
      .catch((error: unknown) => {
        if (!hasConnected.current) {
          setSubscriptionUnavailable(true);
        }
        throw error;
      });

  const realtimeEnabled = !subscriptionUnavailable;
  const realtime = useRealtime({
    autoCloseOnTerminal: false,
    enabled: realtimeEnabled,
    historyLimit: 1,
    pauseOnHidden: true,
    ...(realtimeEnabled ? { token: requestToken } : {}),
  });

  const rerenderLatest = useEffectEvent(() => {
    rerenderNow();
  });

  useEffect(() => {
    const hasLedgerMessage = realtime.messages.delta.some(
      (message) =>
        usageLedgerRealtimeMessageSchema.safeParse(message.data).success,
    );
    if (hasLedgerMessage) {
      rerenderLatest();
    }
  }, [realtime.messages.delta]);

  useEffect(() => {
    if (realtime.connectionStatus !== "open") {
      return;
    }
    if (hasConnected.current) {
      rerenderLatest();
      return;
    }
    hasConnected.current = true;
  }, [realtime.connectionStatus]);

  const rerenderWhenVisible = useEffectEvent(() => {
    if (document.visibilityState === "visible") {
      rerenderNow();
    }
  });

  useEffect(() => {
    document.addEventListener("visibilitychange", rerenderWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", rerenderWhenVisible);
  }, []);

  return {
    isRefreshing,
    refresh: () => {
      setSubscriptionUnavailable(false);
      startRefresh(refreshUsageReadsAction);
    },
    transport: transportOf(realtimeEnabled, realtime.connectionStatus),
  };
}

function transportOf(
  available: boolean,
  connectionStatus:
    | "idle"
    | "connecting"
    | "open"
    | "paused"
    | "closed"
    | "error",
): UsageTransport {
  if (!available) {
    return "unavailable";
  }
  if (connectionStatus === "open") {
    return "live";
  }
  if (connectionStatus === "connecting" || connectionStatus === "idle") {
    return "reconnecting";
  }
  return "stale";
}
