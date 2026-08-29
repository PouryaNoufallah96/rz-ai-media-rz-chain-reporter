import { OpenTelemetry } from "@ai-sdk/otel";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import * as Sentry from "@sentry/node";
import { registerTelemetry } from "ai";
import { InngestSpanProcessor } from "inngest/experimental";

import {
  createInngestClient,
  type WorkerInngestClient,
} from "../inngest/client";
import {
  flushWorkerLogging,
  setWorkerSentryInitialized,
} from "../logging/logger";
import { scrubWorkerErrorEvent, scrubWorkerLog } from "./privacy";

const SENTRY_CLOSE_TIMEOUT_MS = 2_000;

let tracerProvider: NodeTracerProvider | undefined;

export function initializeWorkerObservability(options: {
  appVersion: string;
  sentryDsn?: string;
}): WorkerInngestClient {
  if (tracerProvider) {
    throw new Error("WORKER_OBSERVABILITY_ALREADY_INITIALIZED");
  }

  if (options.sentryDsn) {
    Sentry.init({
      beforeSend: scrubWorkerErrorEvent,
      beforeSendLog: scrubWorkerLog,
      dsn: options.sentryDsn,
      enableLogs: true,
      sendDefaultPii: false,
      skipOpenTelemetrySetup: true,
    });
  }
  setWorkerSentryInitialized(Sentry.isEnabled());

  const client = createInngestClient(options.appVersion);

  tracerProvider = new NodeTracerProvider({
    spanProcessors: [new InngestSpanProcessor(client)],
  });
  tracerProvider.register();
  registerTelemetry(new OpenTelemetry());

  return client;
}

export function captureWorkerFailure(errorCode: string) {
  if (!Sentry.isEnabled()) {
    return;
  }

  Sentry.captureException(new Error("Worker operation failed"), {
    tags: { errorCode },
  });
}

// Sentry keeps its own handles open; flushing alone leaves the event loop alive.
export async function shutdownWorkerObservability() {
  await tracerProvider?.shutdown();
  await flushWorkerLogging();
  await Sentry.close(SENTRY_CLOSE_TIMEOUT_MS);
}
