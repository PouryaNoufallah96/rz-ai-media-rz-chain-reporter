"use client";

import {
  draftsChangedRealtimeMessageSchema,
  editorialChangedRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";
import {
  type RealtimeConnectionState,
  transitionRealtimeConnection,
} from "@/lib/realtime-freshness";

import { getEditorialRealtimeTokens } from "../actions/get-realtime-token";
import { refreshEditorialReadsAction } from "../actions/refresh-editorial-reads";
import {
  cardSheetDraftChangeKey,
  type FreshnessOperation,
} from "../lib/editorial-freshness";

type EditorialTransport = "live" | "reconnecting" | "stale" | "unavailable";

const REALTIME_BUFFER_INTERVAL_MS = 250;

export function useEditorialFreshness(
  analysisRunId: string,
  compact = false,
  platformDraftId: string | null = null,
  copyOperation: FreshnessOperation | null = null,
) {
  const { isRefreshing, requestRefresh } = useRealtimeRouterRefresh();
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const connection = useRef<RealtimeConnectionState>({
    active: false,
    needsCatchUp: false,
  });
  const inFlightTokenRequest = useRef<{
    analysisRunId: string;
    promise: ReturnType<typeof getEditorialRealtimeTokens>;
  } | null>(null);
  const seenDraftChanges = useRef({ scope: "", values: new Set<string>() });
  const copyOperationId = copyOperation?.operationId ?? null;
  const copyOperationLifecycle = copyOperation?.lifecycle ?? null;

  const requestTokens = () => {
    const currentRequest = inFlightTokenRequest.current;
    const request =
      currentRequest?.analysisRunId === analysisRunId
        ? currentRequest
        : {
            analysisRunId,
            promise: getEditorialRealtimeTokens(analysisRunId),
          };
    inFlightTokenRequest.current = request;

    return request.promise
      .then((result) => {
        if (result.status === "unavailable") {
          setSubscriptionUnavailable(true);
          throw new Error("Editorial realtime subscription is unavailable");
        }
        return result;
      })
      .finally(() => {
        if (inFlightTokenRequest.current === request) {
          inFlightTokenRequest.current = null;
        }
      });
  };

  const realtimeEnabled = !subscriptionUnavailable;
  const draftsEnabled =
    realtimeEnabled && (!compact || platformDraftId !== null);
  const editorialEnabled = realtimeEnabled;
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
    requestRefresh();
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
    if (!editorialEnabled && !draftsEnabled) {
      connection.current.active = false;
      return;
    }
    const editorialStatus = editorialEnabled
      ? editorialRealtime.connectionStatus
      : "open";
    const draftsStatus = draftsEnabled
      ? draftsRealtime.connectionStatus
      : "open";
    const transition = transitionRealtimeConnection(connection.current, [
      editorialStatus,
      draftsStatus,
    ]);
    connection.current = transition.connection;
    if (transition.catchUp) {
      rerenderLatest();
    }
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
      requestRefresh(refreshEditorialReadsAction);
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
