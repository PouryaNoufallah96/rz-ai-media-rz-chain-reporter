import * as Sentry from "@sentry/nextjs";

import { scrubErrorEvent, scrubTransactionEvent } from "@/lib/sentry-privacy";
import { WEB_LOG_FIELDS } from "@/lib/web-log-fields";

const SAFE_LOG_ATTRIBUTES = new Set(WEB_LOG_FIELDS);

function safeLogAttributes(attributes: Record<string, unknown> | undefined) {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(attributes ?? {})) {
    if (SAFE_LOG_ATTRIBUTES.has(key) && typeof value === "string") {
      safe[key] = value;
    }
  }
  return safe;
}

Sentry.init({
  beforeSend: (event) => scrubErrorEvent(event, "Web request failed"),
  beforeSendTransaction: scrubTransactionEvent,
  beforeSendLog: (log) => ({
    ...log,
    attributes: safeLogAttributes(log.attributes),
  }),
  dsn: process.env.SENTRY_DSN,
  enableLogs: true,
  sendDefaultPii: false,
  tracesSampleRate: 0.1,
});
