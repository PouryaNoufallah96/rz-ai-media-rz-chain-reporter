"use client";

import { sourcesChangedRealtimeMessageSchema } from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import { getSourcesRealtimeToken } from "../actions/get-realtime-token";
import { refreshSourceReadsAction } from "../actions/refresh-source-reads";

type SourcesTransport = "live" | "reconnecting" | "stale" | "unavailable";

export function useSourcesFreshness() {
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
    getSourcesRealtimeToken()
      .then((result) => {
        if (result.status === "unavailable") {
          throw new Error("Sources realtime subscription is unavailable");
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
    const hasChangedMessage = realtime.messages.delta.some(
      (message) =>
        sourcesChangedRealtimeMessageSchema.safeParse(message.data).success,
    );
    if (hasChangedMessage) {
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
      startRefresh(refreshSourceReadsAction);
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
): SourcesTransport {
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
