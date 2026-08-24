"use client";

import type { OperationLifecycle } from "@rz-chain-reporter/contracts";
import { editorialChangedRealtimeMessageSchema } from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import { getEditorialRealtimeToken } from "../actions/get-realtime-token";
import { refreshEditorialReadsAction } from "../actions/refresh-editorial-reads";

type EditorialTransport = "live" | "reconnecting" | "stale" | "unavailable";

const SETTLED_LIFECYCLES: readonly OperationLifecycle[] = [
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
];

export function useEditorialFreshness(
  analysisRunId: string,
  lifecycle: OperationLifecycle,
) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const hasConnected = useRef(false);

  // Keep a socket through the selected run's final ping; selecting a settled
  // run closes it.
  const [selectedRunId, setSelectedRunId] = useState(analysisRunId);
  const [settledWhenSelected, setSettledWhenSelected] = useState(() =>
    SETTLED_LIFECYCLES.includes(lifecycle),
  );

  if (selectedRunId !== analysisRunId) {
    setSelectedRunId(analysisRunId);
    setSettledWhenSelected(SETTLED_LIFECYCLES.includes(lifecycle));
    setSubscriptionUnavailable(false);
  }

  const rerenderNow = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const requestToken = () =>
    getEditorialRealtimeToken(analysisRunId)
      .then((result) => {
        if (result.status === "unavailable") {
          throw new Error("Editorial realtime subscription is unavailable");
        }
        return result.token;
      })
      .catch((error: unknown) => {
        if (!hasConnected.current) {
          setSubscriptionUnavailable(true);
        }
        throw error;
      });

  const realtimeEnabled = !subscriptionUnavailable && !settledWhenSelected;
  const realtime = useRealtime({
    autoCloseOnTerminal: false,
    enabled: realtimeEnabled,
    historyLimit: 1,
    key: analysisRunId,
    pauseOnHidden: true,
    ...(realtimeEnabled ? { token: requestToken } : {}),
  });

  const rerenderLatest = useEffectEvent(() => {
    rerenderNow();
  });

  // Ignore late pings from the previously selected run.
  useEffect(() => {
    const changed = realtime.messages.delta.some((message) => {
      const parsed = editorialChangedRealtimeMessageSchema.safeParse(
        message.data,
      );
      return parsed.success && parsed.data.analysisRunId === analysisRunId;
    });

    if (changed) {
      rerenderLatest();
    }
  }, [analysisRunId, realtime.messages.delta]);

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
      startRefresh(refreshEditorialReadsAction);
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
): EditorialTransport {
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
