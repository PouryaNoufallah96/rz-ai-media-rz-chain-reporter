"use client";

import { type UseRealtimeConnectionStatus, useRealtime } from "inngest/react";
import type { Realtime } from "inngest/realtime";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

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
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const connectionActive = useRef(false);
  const hasConnected = useRef(false);

  const rerenderNow = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const requestToken = () =>
    mintToken()
      .then((result) => {
        if (result.status === "unavailable") {
          throw new Error("Realtime subscription is unavailable");
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
    bufferInterval: REALTIME_BUFFER_INTERVAL_MS,
    enabled: realtimeEnabled,
    historyLimit: 1,
    pauseOnHidden: true,
    ...(realtimeEnabled ? { token: requestToken } : {}),
  });

  const isRelevant = useEffectEvent(isRelevantMessage);

  const rerenderLatest = useEffectEvent(() => {
    rerenderNow();
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
    if (realtime.connectionStatus === "open") {
      if (hasConnected.current && !connectionActive.current) {
        rerenderLatest();
      }
      hasConnected.current = true;
      connectionActive.current = true;
      return;
    }
    connectionActive.current = false;
  }, [realtime.connectionStatus]);

  return {
    isRefreshing,
    refresh: () => {
      setSubscriptionUnavailable(false);
      startRefresh(refreshAction);
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
