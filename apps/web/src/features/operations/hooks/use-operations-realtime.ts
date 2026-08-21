"use client";

import {
  type OperationStatusRealtimeMessage,
  operationStatusRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useRealtime } from "inngest/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { getOperationsRealtimeToken } from "../actions/get-realtime-token";
import type { OperationSummary } from "../schemas/operation-summary";
import { operationsListQueryKey } from "./use-operations-list";

export type RealtimeTransport =
  | "live"
  | "reconnecting"
  | "stale"
  | "unavailable";

export function useOperationsRealtime({
  enabled,
  refetch,
}: {
  enabled: boolean;
  refetch: () => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const hasConnected = useRef(false);
  const [initialConnectionUnavailable, setInitialConnectionUnavailable] =
    useState(false);
  const realtimeEnabled = enabled && !initialConnectionUnavailable;
  const refetchSnapshot = useEffectEvent(() => {
    if (enabled) {
      void refetch();
    }
  });
  const requestToken = () =>
    getOperationsRealtimeToken()
      .then((result) => {
        if (result.status === "unavailable") {
          throw new Error("Realtime subscription is unavailable");
        }
        return result.token;
      })
      .catch((error: unknown) => {
        if (!hasConnected.current) {
          setInitialConnectionUnavailable(true);
        }
        throw error;
      });
  const realtime = useRealtime({
    autoCloseOnTerminal: false,
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

    queryClient.setQueryData<OperationSummary[]>(
      operationsListQueryKey,
      (current) => {
        if (!current) {
          requiresSnapshot = true;
          return current;
        }

        let next = current;
        for (const message of realtime.messages.delta) {
          const parsed = operationStatusRealtimeMessageSchema.safeParse(
            message.data,
          );
          if (!parsed.success) {
            requiresSnapshot = true;
            continue;
          }
          const status = parsed.data;
          const index = next.findIndex(
            (operation) => operation.id === status.operationId,
          );
          if (index === -1) {
            requiresSnapshot = true;
            continue;
          }

          const operation = next[index];
          if (!operation || status.operationVersion <= operation.version) {
            continue;
          }
          if (status.operationVersion > operation.version + 1) {
            requiresSnapshot = true;
            continue;
          }

          const updated: OperationSummary = {
            ...operation,
            attemptCount: status.attemptCount ?? operation.attemptCount,
            latestAttemptOutcome:
              status.latestAttemptOutcome ?? operation.latestAttemptOutcome,
            lifecycle: status.lifecycle,
            version: status.operationVersion,
          };
          next = next.with(index, updated);
        }
        return next;
      },
    );

    if (requiresSnapshot) {
      refetchSnapshot();
    }
  }, [queryClient, realtime.messages.delta]);

  const handleConnectionOpen = useEffectEvent(() => {
    if (hasConnected.current) {
      refetchSnapshot();
      return;
    }
    hasConnected.current = true;
  });

  useEffect(() => {
    if (realtime.connectionStatus === "open") {
      handleConnectionOpen();
    }
  }, [realtime.connectionStatus]);

  const refetchVisibleSnapshot = useEffectEvent(() => {
    if (document.visibilityState === "visible") {
      refetchSnapshot();
    }
  });

  useEffect(() => {
    document.addEventListener("visibilitychange", refetchVisibleSnapshot);
    return () =>
      document.removeEventListener("visibilitychange", refetchVisibleSnapshot);
  }, []);

  return {
    announcement: parseAnnouncement(realtime.messages.last?.data),
    retry: () => {
      if (enabled) {
        setInitialConnectionUnavailable(false);
      }
    },
    transport: transportOf(
      !initialConnectionUnavailable,
      realtime.connectionStatus,
      realtime.runStatus !== "unknown",
    ),
  };
}

function parseAnnouncement(
  value: unknown,
): OperationStatusRealtimeMessage | undefined {
  const parsed = operationStatusRealtimeMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
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
  hasConnected: boolean,
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
  return hasConnected ? "stale" : "unavailable";
}
