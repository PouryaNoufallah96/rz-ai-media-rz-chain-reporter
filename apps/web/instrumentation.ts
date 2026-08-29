import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) {
    return;
  }

  await import("./instrumentation.node");
}

export const onRequestError = Sentry.captureRequestError;
