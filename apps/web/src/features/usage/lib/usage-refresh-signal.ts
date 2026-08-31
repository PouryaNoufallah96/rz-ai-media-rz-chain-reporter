"use client";

const USAGE_REFRESH_EVENT = "chainreporter:usage-refresh";

export function signalUsageRefresh() {
  window.dispatchEvent(new Event(USAGE_REFRESH_EVENT));
}

export function subscribeToUsageRefresh(listener: () => void) {
  window.addEventListener(USAGE_REFRESH_EVENT, listener);
  return () => window.removeEventListener(USAGE_REFRESH_EVENT, listener);
}
