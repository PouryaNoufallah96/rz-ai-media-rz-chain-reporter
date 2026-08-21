import * as Sentry from "@sentry/nextjs";

import { scrubErrorEvent, scrubTransactionEvent } from "@/lib/sentry-privacy";

const NAVIGATION_TYPES = new Set([
  "back-forward",
  "back-forward-cache",
  "navigate",
  "prerender",
  "reload",
  "restore",
]);
const RATINGS = new Set(["good", "needs-improvement", "poor"]);
const WEB_VITAL_NAMES = new Set(["CLS", "FCP", "FID", "INP", "LCP", "TTFB"]);

const ALLOWED_STRING_ATTRIBUTES: Record<string, Set<string>> = {
  metric: WEB_VITAL_NAMES,
  navigationType: NAVIGATION_TYPES,
  rating: RATINGS,
};

function webVitalAttributes(attributes: Record<string, unknown> | undefined) {
  const safe: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (
      (key === "delta" || key === "value") &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) {
      safe[key] = value;
    }
    if (
      typeof value === "string" &&
      ALLOWED_STRING_ATTRIBUTES[key]?.has(value)
    ) {
      safe[key] = value;
    }
  }
  return safe;
}

if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    beforeSend: (event) => scrubErrorEvent(event, "Browser operation failed"),
    beforeSendTransaction: scrubTransactionEvent,
    beforeSendLog: (log) => ({
      ...log,
      attributes: webVitalAttributes(log.attributes),
      message: log.message === "web.vital" ? log.message : "web.log",
    }),
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    enableLogs: true,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
