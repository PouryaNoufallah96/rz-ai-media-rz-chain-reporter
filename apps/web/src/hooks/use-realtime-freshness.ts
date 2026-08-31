"use client";

import { type UseRealtimeConnectionStatus, useRealtime } from "inngest/react";
import type { Realtime } from "inngest/realtime";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";
import {
  type RealtimeConnectionState,
  transitionRealtimeConnection,
} from "@/lib/realtime-freshness";

export type RealtimeTransport =
  | "live"
  | "reconnecting"
  | "stale"
  | "unavailable";

const REALTIME_BUFFER_INTERVAL_MS = 250;

type TokenResult<TToken extends Realtime.Subscribe.ClientToken> =
  | { status: "unavailable" }
  | { status: "ready"; token: TToken };

export function useRealtimeFreshness<
  TToken extends Realtime.Subscribe.ClientToken,
>({
  isRelevantMessage,
  mintToken,
  refreshAction,
}: {
  isRelevantMessage: (data: unknown) => boolean;
  mintToken: () => Promise<TokenResult<TToken>>;
  refreshAction: () => Promise<void>;
}) {
  const { isRefreshing, requestRefresh } = useRealtimeRouterRefresh();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const connection = useRef<RealtimeConnectionState>({
    active: false,
    needsCatchUp: false,
  });

  const requestToken = async () => {
    const result = await mintToken();
    if (result.status === "unavailable") {
      setSubscriptionUnavailable(true);
      throw new Error("Realtime subscription is unavailable");
    }
    return result.token;
  };

  const realtimeEnabled = !subscriptionUnavailable;
  const realtime = useRealtime({
    autoCloseOnTerminal: false,
    bufferInterval: REALTIME_BUFFER_INTERVAL_MS,
    enabled: realtimeEnabled,
    historyLimit: 1,
    pauseOnHidden: true,
    ...(realtimeEnabled ? { token: requestToken } : {}),
  });

  const isRelevant = useEffectEvent(isRelevantMessage);

  const rerenderLatest = useEffectEvent(() => {
    requestRefresh();
  });

  useEffect(() => {
    const hasRelevantMessage = realtime.messages.delta.some((message) =>
      isRelevant(message.data),
    );
    if (hasRelevantMessage) {
      rerenderLatest();
    }
  }, [realtime.messages.delta]);

  useEffect(() => {
    const transition = transitionRealtimeConnection(connection.current, [
      realtime.connectionStatus,
    ]);
    connection.current = transition.connection;
    if (transition.catchUp) {
      rerenderLatest();
    }
  }, [realtime.connectionStatus]);

  return {
    isRefreshing,
    refresh: () => {
      setSubscriptionUnavailable(false);
      requestRefresh(refreshAction);
    },
    transport: transportOf(realtimeEnabled, realtime.connectionStatus),
  };
}

function transportOf(
  available: boolean,
  connectionStatus: UseRealtimeConnectionStatus,
): RealtimeTransport {
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
