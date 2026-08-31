"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";

import {
  type RealtimeRefreshQueue,
  requestRealtimeRefresh,
  settleRealtimeRefresh,
} from "@/lib/realtime-freshness";

export function useRealtimeRouterRefresh() {
  const router = useRouter();
  const queue = useRef<RealtimeRefreshQueue>("idle");
  const pendingAction = useRef<(() => void | Promise<void>) | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const requestRefresh = (action?: () => void | Promise<void>) => {
    const transition = requestRealtimeRefresh(queue.current);
    queue.current = transition.queue;
    if (transition.start) {
      startRefresh(action ?? (() => router.refresh()));
    } else if (action) {
      pendingAction.current = action;
    }
  };

  useEffect(() => {
    if (isRefreshing || queue.current === "idle") {
      return;
    }
    const transition = settleRealtimeRefresh(queue.current);
    queue.current = transition.queue;
    if (transition.start) {
      const action = pendingAction.current;
      pendingAction.current = null;
      startRefresh(action ?? (() => router.refresh()));
    }
  }, [isRefreshing, router]);

  return { isRefreshing, requestRefresh };
}
