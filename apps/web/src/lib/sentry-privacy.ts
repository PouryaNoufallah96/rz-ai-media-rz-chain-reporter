import type { init } from "@sentry/nextjs";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;
type ErrorEvent = Parameters<NonNullable<SentryOptions["beforeSend"]>>[0];
type TransactionEvent = Parameters<
  NonNullable<SentryOptions["beforeSendTransaction"]>
>[0];

const IDENTIFIER_SEGMENT =
  /\/(?:[0-9]+|[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})(?=\/|$)/gi;
const PUBLISHING_MEDIA_GRANT_SEGMENT = /(\/api\/publishing-media\/)[^/?\s]+/gi;

export function sanitizeRoute(value: string | undefined) {
  return value
    ?.split("?", 1)[0]
    ?.replace(PUBLISHING_MEDIA_GRANT_SEGMENT, "$1:grant")
    .replace(IDENTIFIER_SEGMENT, "/:id");
}

export function scrubErrorEvent(
  event: ErrorEvent,
  message: string,
): ErrorEvent {
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
            value: message,
          })),
        }
      : undefined,
    extra: undefined,
    message: event.message ? message : undefined,
    request: undefined,
    tags: undefined,
    user: undefined,
  };
}

export function scrubTransactionEvent(
  event: TransactionEvent,
): TransactionEvent {
  return {
    ...event,
    breadcrumbs: undefined,
    extra: undefined,
    request: undefined,
    spans: event.spans?.map((span) => ({
      ...span,
      data: {},
      description: sanitizeRoute(span.description),
    })),
    tags: undefined,
    transaction: sanitizeRoute(event.transaction),
    user: undefined,
  };
}
