"use client";

import { useSyncExternalStore } from "react";

const NARROW_VIEWPORT_QUERY = "(width < 37.5rem)";

function subscribeToNarrowViewport(change: () => void) {
  const query = window.matchMedia(NARROW_VIEWPORT_QUERY);
  query.addEventListener("change", change);
  return () => query.removeEventListener("change", change);
}

function narrowViewportSnapshot() {
  return window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}

function narrowViewportServerSnapshot() {
  return false;
}

export function useNarrowViewport() {
  return useSyncExternalStore(
    subscribeToNarrowViewport,
    narrowViewportSnapshot,
    narrowViewportServerSnapshot,
  );
}
