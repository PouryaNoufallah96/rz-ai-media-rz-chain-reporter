"use client";

import type { OperationLifecycle } from "@rz-chain-reporter/contracts";
import {
  draftsChangedRealtimeMessageSchema,
  editorialChangedRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useRouter } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useTransition,
} from "react";

import { getEditorialRealtimeTokens } from "../actions/get-realtime-token";
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

  const [settledWhenSelected] = useState(() =>
    SETTLED_LIFECYCLES.includes(lifecycle),
  );

  const rerenderNow = () => {
    startRefresh(() => {
      router.refresh();
    });
  };

  const requestTokens = () =>
    getEditorialRealtimeTokens(analysisRunId)
      .then((result) => {
        if (result.status === "unavailable") {
          throw new Error("Editorial realtime subscription is unavailable");
        }
        return result;
      })
      .catch((error: unknown) => {
        if (!hasConnected.current) {
          setSubscriptionUnavailable(true);
        }
        throw error;
      });

  const realtimeEnabled = !subscriptionUnavailable;
  const editorialEnabled = realtimeEnabled && !settledWhenSelected;
  const editorialRealtime = useRealtime({
    autoCloseOnTerminal: false,
    enabled: editorialEnabled,
    historyLimit: 1,
    key: `editorial:${analysisRunId}`,
    pauseOnHidden: true,
    ...(editorialEnabled
      ? { token: () => requestTokens().then((result) => result.editorial) }
      : {}),
  });
  const draftsRealtime = useRealtime({
    autoCloseOnTerminal: false,
    enabled: realtimeEnabled,
    historyLimit: 1,
    key: `drafts:${analysisRunId}`,
    pauseOnHidden: true,
    ...(realtimeEnabled
      ? { token: () => requestTokens().then((result) => result.drafts) }
      : {}),
  });

  const rerenderLatest = useEffectEvent(() => {
    rerenderNow();
  });

  // Ignore late pings from the previously selected run.
  useEffect(() => {
    const editorialChanged = editorialRealtime.messages.delta.some(
      (message) => {
        const parsed = editorialChangedRealtimeMessageSchema.safeParse(
          message.data,
        );
        return parsed.success && parsed.data.analysisRunId === analysisRunId;
      },
    );
    const draftChanged = draftsRealtime.messages.delta.some((message) => {
      const parsed = draftsChangedRealtimeMessageSchema.safeParse(message.data);
      return parsed.success && parsed.data.analysisRunId === analysisRunId;
    });

    if (editorialChanged || draftChanged) {
      rerenderLatest();
    }
  }, [
    analysisRunId,
    draftsRealtime.messages.delta,
    editorialRealtime.messages.delta,
  ]);

  useEffect(() => {
    const editorialConnected =
      !editorialEnabled || editorialRealtime.connectionStatus === "open";
    if (!editorialConnected || draftsRealtime.connectionStatus !== "open") {
      return;
    }
    if (hasConnected.current) {
      rerenderLatest();
      return;
    }
    hasConnected.current = true;
  }, [
    draftsRealtime.connectionStatus,
    editorialEnabled,
    editorialRealtime.connectionStatus,
  ]);

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
    transport: transportOf(
      realtimeEnabled,
      draftsRealtime.connectionStatus,
      editorialEnabled ? editorialRealtime.connectionStatus : "open",
    ),
  };
}

function transportOf(
  available: boolean,
  ...statuses: Array<
    "idle" | "connecting" | "open" | "paused" | "closed" | "error"
  >
): EditorialTransport {
  if (!available) {
    return "unavailable";
  }
  if (statuses.every((status) => status === "open")) {
    return "live";
  }
  if (statuses.some((status) => status === "connecting" || status === "idle")) {
    return "reconnecting";
  }
  return "stale";
}
