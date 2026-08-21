import * as Sentry from "@sentry/nextjs";

import { scrubErrorEvent, scrubTransactionEvent } from "@/lib/sentry-privacy";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) {
    return;
  }

  Sentry.init({
    beforeSend: (event) => scrubErrorEvent(event, "Web request failed"),
    beforeSendTransaction: scrubTransactionEvent,
    beforeSendLog: (log) => ({ ...log, attributes: {}, message: "web.log" }),
    dsn: process.env.SENTRY_DSN,
    enableLogs: true,
    sendDefaultPii: false,
    tracesSampleRate: 0.1,
  });
}

export const onRequestError = Sentry.captureRequestError;
