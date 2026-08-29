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
import {
  cardSheetDraftChangeKey,
  type FreshnessOperation,
} from "../lib/editorial-freshness";

type EditorialTransport = "live" | "reconnecting" | "stale" | "unavailable";

const REALTIME_BUFFER_INTERVAL_MS = 250;

const SETTLED_LIFECYCLES: readonly OperationLifecycle[] = [
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
];

export function useEditorialFreshness(
  analysisRunId: string,
  lifecycle: OperationLifecycle,
  compact = false,
  platformDraftId: string | null = null,
  copyOperation: FreshnessOperation | null = null,
) {
  const router = useRouter();
  const [isRefreshing, startRefresh] = useTransition();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const connectionActive = useRef(false);
  const hasConnected = useRef(false);
  const seenDraftChanges = useRef({ scope: "", values: new Set<string>() });
  const copyOperationId = copyOperation?.operationId ?? null;
  const copyOperationLifecycle = copyOperation?.lifecycle ?? null;

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
  const draftsEnabled =
    realtimeEnabled && (!compact || platformDraftId !== null);
  const editorialEnabled =
    realtimeEnabled && !compact && !SETTLED_LIFECYCLES.includes(lifecycle);
  const editorialRealtime = useRealtime({
    autoCloseOnTerminal: false,
    bufferInterval: REALTIME_BUFFER_INTERVAL_MS,
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
    bufferInterval: REALTIME_BUFFER_INTERVAL_MS,
    enabled: draftsEnabled,
    historyLimit: 1,
    key: `drafts:${analysisRunId}`,
    pauseOnHidden: true,
    ...(draftsEnabled
      ? { token: () => requestTokens().then((result) => result.drafts) }
      : {}),
  });

  const rerenderLatest = useEffectEvent(() => {
    rerenderNow();
  });

  useEffect(() => {
    const scope = `${analysisRunId}:${platformDraftId ?? "workspace"}`;
    if (seenDraftChanges.current.scope !== scope) {
      seenDraftChanges.current = { scope, values: new Set<string>() };
    }
    const editorialChanged = editorialRealtime.messages.delta.some(
      (message) => {
        const parsed = editorialChangedRealtimeMessageSchema.safeParse(
          message.data,
        );
        return parsed.success && parsed.data.analysisRunId === analysisRunId;
      },
    );
    let draftChanged = false;
    for (const message of draftsRealtime.messages.delta) {
      if (compact && platformDraftId !== null) {
        const key = cardSheetDraftChangeKey(
          message.data,
          analysisRunId,
          platformDraftId,
          copyOperationId && copyOperationLifecycle
            ? {
                lifecycle: copyOperationLifecycle,
                operationId: copyOperationId,
              }
            : null,
        );
        if (key && !seenDraftChanges.current.values.has(key)) {
          seenDraftChanges.current.values.add(key);
          draftChanged = true;
        }
        continue;
      }
      const parsed = draftsChangedRealtimeMessageSchema.safeParse(message.data);
      if (parsed.success && parsed.data.analysisRunId === analysisRunId) {
        draftChanged = true;
      }
    }

    if (editorialChanged || draftChanged) {
      rerenderLatest();
    }
  }, [
    analysisRunId,
    compact,
    copyOperationId,
    copyOperationLifecycle,
    draftsRealtime.messages.delta,
    editorialRealtime.messages.delta,
    platformDraftId,
  ]);

  useEffect(() => {
    const editorialConnected =
      !editorialEnabled || editorialRealtime.connectionStatus === "open";
    const draftsConnected =
      !draftsEnabled || draftsRealtime.connectionStatus === "open";
    if (!editorialConnected || !draftsConnected) {
      connectionActive.current = false;
      return;
    }
    if (hasConnected.current && !connectionActive.current) {
      rerenderLatest();
    }
    hasConnected.current = true;
    connectionActive.current = true;
  }, [
    draftsRealtime.connectionStatus,
    draftsEnabled,
    editorialEnabled,
    editorialRealtime.connectionStatus,
  ]);

  return {
    isRefreshing,
    refresh: () => {
      setSubscriptionUnavailable(false);
      startRefresh(refreshEditorialReadsAction);
    },
    transport: transportOf(
      realtimeEnabled,
      draftsEnabled ? draftsRealtime.connectionStatus : "open",
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
