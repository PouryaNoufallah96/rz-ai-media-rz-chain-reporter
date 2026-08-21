import type { NodeOptions } from "@sentry/node";

import { WORKER_LOG_FIELDS } from "../logging/logger";

type ErrorEvent = Parameters<NonNullable<NodeOptions["beforeSend"]>>[0];
type SentryLog = Parameters<NonNullable<NodeOptions["beforeSendLog"]>>[0];
type TransactionEvent = Parameters<
  NonNullable<NodeOptions["beforeSendTransaction"]>
>[0];

const SAFE_LOG_ATTRIBUTES = new Set(WORKER_LOG_FIELDS);

const IDENTIFIER_SEGMENT =
  /\/(?:[0-9]+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=\/|$)/gi;

export function scrubWorkerErrorEvent(event: ErrorEvent): ErrorEvent {
  return {
    ...event,
    breadcrumbs: undefined,
    contexts: event.contexts?.trace
      ? { trace: event.contexts.trace }
      : undefined,
    exception: event.exception
      ? {
          ...event.exception,
          values: event.exception.values?.map((value) => ({
            ...value,
            value: "Worker operation failed",
          })),
        }
      : undefined,
    extra: undefined,
    message: event.message ? "Worker operation failed" : undefined,
    request: undefined,
    tags: event.tags?.errorCode
      ? { errorCode: event.tags.errorCode }
      : undefined,
    user: undefined,
  };
}

export function scrubWorkerTransaction(
  event: TransactionEvent,
): TransactionEvent {
  return {
    ...event,
    breadcrumbs: undefined,
    contexts: event.contexts?.trace
      ? { trace: event.contexts.trace }
      : undefined,
    extra: undefined,
    request: undefined,
    spans: event.spans?.map((span) => ({
      ...span,
      data: {},
      description: sanitizeOperationName(span.description),
    })),
    tags: undefined,
    transaction: sanitizeOperationName(event.transaction),
    user: undefined,
  };
}

export function scrubWorkerLog(log: SentryLog): SentryLog {
  const attributes: Record<string, number | string> = {};

  for (const [key, value] of Object.entries(log.attributes ?? {})) {
    if (
      SAFE_LOG_ATTRIBUTES.has(key) &&
      (typeof value === "number" || typeof value === "string")
    ) {
      attributes[key] = value;
    }
  }

  return {
    ...log,
    attributes,
    message:
      typeof log.message === "string"
        ? (sanitizeOperationName(log.message) ?? "worker.log")
        : "worker.log",
  };
}

function sanitizeOperationName(value: string | undefined) {
  if (!value) {
    return value;
  }

  return value.split("?", 1)[0]?.replace(IDENTIFIER_SEGMENT, "/:id");
}
