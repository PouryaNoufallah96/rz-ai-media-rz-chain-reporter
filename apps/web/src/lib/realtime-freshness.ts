import type { UseRealtimeConnectionStatus } from "inngest/react";

export type RealtimeRefreshQueue = "idle" | "refreshing" | "trailing";

export type RealtimeConnectionState = {
  active: boolean;
  needsCatchUp: boolean;
};

type RealtimeRefreshTransition = {
  queue: RealtimeRefreshQueue;
  start: boolean;
};

export function requestRealtimeRefresh(
  queue: RealtimeRefreshQueue,
): RealtimeRefreshTransition {
  if (queue === "idle") {
    return { queue: "refreshing", start: true };
  }
  return { queue: "trailing", start: false };
}

export function settleRealtimeRefresh(
  queue: RealtimeRefreshQueue,
): RealtimeRefreshTransition {
  if (queue === "trailing") {
    return { queue: "refreshing", start: true };
  }
  return { queue: "idle", start: false };
}

export function transitionRealtimeConnection(
  current: RealtimeConnectionState,
  statuses: readonly UseRealtimeConnectionStatus[],
) {
  const active = statuses.every((status) => status === "open");
  const interrupted = statuses.some(
    (status) =>
      status === "closed" || status === "error" || status === "paused",
  );
  const needsCatchUp =
    current.needsCatchUp || interrupted || (current.active && !active);
  return {
    connection: {
      active,
      needsCatchUp: active ? false : needsCatchUp,
    },
    catchUp: active && needsCatchUp,
  };
}
