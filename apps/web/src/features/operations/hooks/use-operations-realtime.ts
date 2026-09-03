"use client";

import {
  OPERATIONS_REALTIME_CHANGED_TOPIC,
  OPERATIONS_REALTIME_STATUS_TOPIC,
  type OperationStatusRealtimeMessage,
  operationStatusRealtimeMessageSchema,
  operationsChangedRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { useRealtime } from "inngest/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useRealtimeRouterRefresh } from "@/hooks/use-realtime-router-refresh";
import { usePathname } from "@/i18n/navigation";
import {
  type RealtimeConnectionState,
  type RealtimeRefreshQueue,
  requestRealtimeRefresh,
  settleRealtimeRefresh,
  transitionRealtimeConnection,
} from "@/lib/realtime-freshness";

import { getOperationsRealtimeToken } from "../actions/get-realtime-token";

export type RealtimeTransport =
  | "live"
  | "reconnecting"
  | "stale"
  | "unavailable";

const REALTIME_BUFFER_INTERVAL_MS = 250;

export function useOperationsRealtime({
  isFetching,
  refetch,
  viewerId,
}: {
  isFetching: boolean;
  refetch: () => Promise<unknown>;
  viewerId: string;
}) {
  const [subscriptionUnavailable, setSubscriptionUnavailable] = useState(false);
  const realtimeEnabled = !subscriptionUnavailable;
  const snapshot = useOperationsSnapshotRefresh({
    isFetching,
    refetch,
  });
  const route = useRealtimeRouterRefresh();
  const refreshRoute = useEffectEvent(route.requestRefresh);
  const pathname = usePathname();
  const refetchSnapshot = useEffectEvent(snapshot.requestRefresh);
  const connection = useRef<RealtimeConnectionState>({
    active: false,
    needsCatchUp: false,
  });
  const requestToken = async () => {
    const result = await getOperationsRealtimeToken();
    if (result.status === "unavailable") {
      setSubscriptionUnavailable(true);
      throw new Error("Realtime subscription is unavailable");
    }
    return result.token;
  };
  const realtime = useRealtime({
    autoCloseOnTerminal: false,
    bufferInterval: REALTIME_BUFFER_INTERVAL_MS,
    enabled: realtimeEnabled,
    historyLimit: 50,
    pauseOnHidden: true,
    ...(realtimeEnabled ? { token: requestToken } : {}),
  });

  useEffect(() => {
    if (realtime.messages.delta.length === 0) {
      return;
    }

    let requiresSnapshot = false;
    for (const message of realtime.messages.delta) {
      if (message.topic === OPERATIONS_REALTIME_CHANGED_TOPIC) {
        const parsed = operationsChangedRealtimeMessageSchema.safeParse(
          message.data,
        );
        if (parsed.success && addressesViewer(parsed.data, viewerId)) {
          requiresSnapshot = true;
        }
        continue;
      }
      if (message.topic !== OPERATIONS_REALTIME_STATUS_TOPIC) continue;
      const parsed = operationStatusRealtimeMessageSchema.safeParse(
        message.data,
      );
      if (!parsed.success) continue;
      if (addressesViewer(parsed.data, viewerId)) {
        requiresSnapshot = true;
      }
    }

    if (requiresSnapshot) {
      refetchSnapshot();
      if (pathname.startsWith("/market-analysis")) refreshRoute();
    }
  }, [pathname, realtime.messages.delta, viewerId]);

  useEffect(() => {
    const transition = transitionRealtimeConnection(connection.current, [
      realtime.connectionStatus,
    ]);
    connection.current = transition.connection;
    if (transition.catchUp) {
      refetchSnapshot();
    }
  }, [realtime.connectionStatus]);

  return {
    announcement: latestAnnouncement(realtime.messages.all, viewerId),
    isRefreshing: snapshot.isRefreshing,
    refresh: snapshot.requestRefresh,
    retry: () => setSubscriptionUnavailable(false),
    transport: transportOf(!subscriptionUnavailable, realtime.connectionStatus),
  };
}

function useOperationsSnapshotRefresh({
  isFetching,
  refetch,
}: {
  isFetching: boolean;
  refetch: () => Promise<unknown>;
}) {
  const queue = useRef<RealtimeRefreshQueue>("idle");
  const refetchLatest = useEffectEvent(refetch);

  const requestRefresh = () => {
    const transition = requestRealtimeRefresh(queue.current);
    queue.current = transition.queue;
    if (!transition.start) return;
    if (isFetching) {
      queue.current = "trailing";
      return;
    }
    void refetch();
  };

  useEffect(() => {
    if (isFetching || queue.current === "idle") return;
    const transition = settleRealtimeRefresh(queue.current);
    queue.current = transition.queue;
    if (transition.start) void refetchLatest();
  }, [isFetching]);

  return {
    isRefreshing: isFetching,
    requestRefresh,
  };
}

// The channel is workspace-wide: a message reaches its own operator, and a
// shared source import reaches everyone.
function addressesViewer(
  message: Pick<OperationStatusRealtimeMessage, "actorId" | "sharedImport">,
  viewerId: string,
) {
  return message.sharedImport || message.actorId === viewerId;
}

function latestAnnouncement(
  messages: readonly { data: unknown; topic?: string }[],
  viewerId: string,
): OperationStatusRealtimeMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || message.topic !== OPERATIONS_REALTIME_STATUS_TOPIC)
      continue;
    const parsed = operationStatusRealtimeMessageSchema.safeParse(message.data);
    if (parsed.success && addressesViewer(parsed.data, viewerId)) {
      return parsed.data;
    }
  }
  return undefined;
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
