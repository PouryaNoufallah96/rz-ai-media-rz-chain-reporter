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

export type UsageTransport = "live" | "reconnecting" | "stale" | "unavailable";

export function useUsageFreshness() {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const hasConnected = useRef(false);

  const refreshNow = () => {
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

  const refreshLatest = useEffectEvent(() => {
    refreshNow();
  });

  useEffect(() => {
    const hasLedgerMessage = realtime.messages.delta.some(
      (message) =>
        usageLedgerRealtimeMessageSchema.safeParse(message.data).success,
    );
    if (hasLedgerMessage) {
      refreshLatest();
    }
  }, [realtime.messages.delta]);

  useEffect(() => {
    if (realtime.connectionStatus !== "open") {
      return;
    }
    if (hasConnected.current) {
      refreshLatest();
      return;
    }
    hasConnected.current = true;
  }, [realtime.connectionStatus]);

  const refreshWhenVisible = useEffectEvent(() => {
    if (document.visibilityState === "visible") {
      refreshNow();
    }
  });

  useEffect(() => {
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () =>
      document.removeEventListener("visibilitychange", refreshWhenVisible);
  }, []);

  return {
    isRefreshing,
    refresh: () => {
      setSubscriptionUnavailable(false);
      refreshNow();
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
