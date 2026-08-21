import * as Sentry from "@sentry/node";
import type { Logger as InngestLogger } from "inngest";

const WORKER_LOG_TEXT_FIELDS = [
  "appVersion",
  "attemptId",
  "capability",
  "connectionState",
  "errorCode",
  "eventType",
  "mediaAssetId",
  "mode",
  "operationId",
  "outboxId",
  "reason",
  "signal",
  "status",
  "usageEventId",
  "workspaceId",
] as const;

const WORKER_LOG_NUMBER_FIELDS = [
  "attempt",
  "delayMs",
  "durationMs",
  "port",
] as const;

export const WORKER_LOG_FIELDS: readonly string[] = [
  ...WORKER_LOG_TEXT_FIELDS,
  ...WORKER_LOG_NUMBER_FIELDS,
];

export type WorkerLogFields = Partial<
  Record<(typeof WORKER_LOG_TEXT_FIELDS)[number], string> &
    Record<(typeof WORKER_LOG_NUMBER_FIELDS)[number], number>
>;

type LogLevel = "debug" | "error" | "info" | "warn";

let sentryInitialized = false;

const SECRET_ASSIGNMENT =
  /\b(authorization|cookie|password|secret|token|api[_-]?key)\b\s*[:=]\s*[^\s,;]+/gi;
const BEARER_VALUE = /\bbearer\s+[^\s,;]+/gi;
const URL_QUERY = /(https?:\/\/[^\s?]+)\?[^\s]*/gi;

function redact(value: string) {
  return value
    .replace(SECRET_ASSIGNMENT, "$1=[redacted]")
    .replace(BEARER_VALUE, "bearer [redacted]")
    .replace(URL_QUERY, "$1?[redacted]")
    .slice(0, 512);
}

function toStdout(level: LogLevel, event: string, extra: object) {
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...extra,
    })}\n`,
  );
}

function write(level: LogLevel, event: string, fields: WorkerLogFields = {}) {
  const attributes: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      attributes[key] = typeof value === "string" ? redact(value) : value;
    }
  }

  if (sentryInitialized && Sentry.isEnabled()) {
    Sentry.logger[level](event, attributes);
    return;
  }

  toStdout(level, event, attributes);
}

export function setWorkerSentryInitialized(initialized: boolean) {
  sentryInitialized = initialized;
}

export async function flushWorkerLogging() {
  if (sentryInitialized) {
    await Sentry.flush(2_000);
  }
}

export const workerLogger = {
  debug: (event: string, fields?: WorkerLogFields) =>
    write("debug", event, fields),
  error: (event: string, fields?: WorkerLogFields) =>
    write("error", event, fields),
  info: (event: string, fields?: WorkerLogFields) =>
    write("info", event, fields),
  warn: (event: string, fields?: WorkerLogFields) =>
    write("warn", event, fields),
};

// SDK diagnostics are third-party free text, so they stay on stdout and never
// reach the typed Sentry field set. Worker code logs through `workerLogger`.
function writeSdk(level: LogLevel, args: unknown[]) {
  const detail = args.find(
    (argument): argument is string => typeof argument === "string",
  );
  toStdout(level, "inngest.sdk", {
    detail: detail === undefined ? undefined : redact(detail),
  });
}

export const inngestLogger: InngestLogger = {
  debug: (...args: unknown[]) => writeSdk("debug", args),
  error: (...args: unknown[]) => writeSdk("error", args),
  info: (...args: unknown[]) => writeSdk("info", args),
  warn: (...args: unknown[]) => writeSdk("warn", args),
};
