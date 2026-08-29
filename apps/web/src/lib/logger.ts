import "server-only";

import * as Sentry from "@sentry/nextjs";

import type { WebLogFields } from "./web-log-fields";

type LogLevel = "error" | "info" | "warn";

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

function write(level: LogLevel, event: string, fields: WebLogFields = {}) {
  const attributes: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      attributes[key] = redact(value);
    }
  }

  if (Sentry.isEnabled()) {
    Sentry.logger[level](event, attributes);
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      event,
      ...attributes,
    })}\n`,
  );
}

export const webLogger = {
  error: (event: string, fields?: WebLogFields) =>
    write("error", event, fields),
  info: (event: string, fields?: WebLogFields) => write("info", event, fields),
  warn: (event: string, fields?: WebLogFields) => write("warn", event, fields),
};
