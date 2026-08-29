import "server-only";

import { createHash } from "node:crypto";

import type { createDb } from "@rz-chain-reporter/db";
import { APIError, createAuthMiddleware, getIP } from "better-auth/api";

const SIGN_IN_PATH = "/sign-in/email";

const RATE_LIMITED_CODE = "RATE_LIMITED";

// Shared window so one statement consumes every bucket; retention equals the window.
const WINDOW_SECONDS = 300;
const MAX_ATTEMPTS_PER_IP = 5;
const MAX_ATTEMPTS_PER_IDENTIFIER = 5;
const MAX_ATTEMPTS_PER_DEPLOYMENT = 50;
const PRUNE_BATCH_SIZE = 200;

const DEPLOYMENT_BUCKET = "deployment";

const WINDOW = `make_interval(secs => ${WINDOW_SECONDS})`;
const IN_WINDOW = `t.window_started_at > now() - ${WINDOW}`;

const PRUNE_EXPIRED_WINDOWS = `
  delete from auth_throttle as t
  where t.window_started_at <= now() - ${WINDOW}
    and t.bucket in (
      select bucket
      from auth_throttle
      where window_started_at <= now() - ${WINDOW}
      order by window_started_at
      limit ${PRUNE_BATCH_SIZE}
    )
`;

type AuthDatabase = ReturnType<typeof createDb>["db"];

type Bucket = {
  key: string;
  max: number;
};

type ConsumedBucket = {
  bucket: string;
  attempt_count: number;
  retry_after_seconds: number;
};

function rateLimited(retryAfterSeconds: number) {
  return new APIError(
    "TOO_MANY_REQUESTS",
    {
      code: RATE_LIMITED_CODE,
      message: "Too many sign-in attempts. Try again later.",
      retryAfterSeconds,
    },
    { "retry-after": String(retryAfterSeconds) },
  );
}

// Identifier stored as SHA-256 digest only; email never persisted.
function identifierDigest(body: unknown) {
  if (typeof body !== "object" || body === null || !("email" in body)) {
    return null;
  }
  const { email } = body;
  if (typeof email !== "string") return null;

  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  return createHash("sha256").update(normalized).digest("hex");
}

// Atomic consume via INSERT … ON CONFLICT; packages/auth cannot use drizzle-orm's `sql` tag.
async function consume(db: AuthDatabase, buckets: Bucket[]) {
  const rows = buckets
    .map((_, index) => `($${index + 1}, now(), 1)`)
    .join(", ");
  const consumed = await db.$client.query<ConsumedBucket>(
    `insert into auth_throttle as t (bucket, window_started_at, attempt_count)
     values ${rows}
     on conflict (bucket) do update set
       window_started_at =
         case when ${IN_WINDOW} then t.window_started_at else now() end,
       attempt_count =
         case when ${IN_WINDOW} then t.attempt_count + 1 else 1 end
     returning
       t.bucket,
       t.attempt_count,
       ceil(
         extract(epoch from t.window_started_at + ${WINDOW} - now())
       )::int as retry_after_seconds`,
    buckets.map((bucket) => bucket.key),
  );

  const counted = new Map(consumed.rows.map((row) => [row.bucket, row]));
  let retryAfterSeconds = 0;

  for (const bucket of buckets) {
    const row = counted.get(bucket.key);
    if (row && row.attempt_count > bucket.max) {
      retryAfterSeconds = Math.max(retryAfterSeconds, row.retry_after_seconds);
    }
  }

  return retryAfterSeconds > 0
    ? Math.min(Math.max(retryAfterSeconds, 1), WINDOW_SECONDS)
    : null;
}

// Better Auth matches the single `before` hook with `matcher: () => true`,
// so the path guard must be first or every /get-session pays for the throttle.
export function createSignInThrottleHook(db: AuthDatabase) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== SIGN_IN_PATH) return;

    const headers = ctx.headers ?? ctx.request?.headers;
    const ip = headers ? getIP(headers, ctx.context.options) : null;
    // Fail closed rather than sharing one bucket: docs/operations/sign-in-trust-boundary.md.
    if (!ip) throw rateLimited(WINDOW_SECONDS);

    const digest = identifierDigest(ctx.body);
    const buckets: Bucket[] = [
      { key: `ip:${ip}`, max: MAX_ATTEMPTS_PER_IP },
      { key: DEPLOYMENT_BUCKET, max: MAX_ATTEMPTS_PER_DEPLOYMENT },
    ];
    if (digest) {
      buckets.push({
        key: `identifier:${digest}`,
        max: MAX_ATTEMPTS_PER_IDENTIFIER,
      });
    }

    const retryAfterSeconds = await consume(db, buckets);
    await db.$client.query(PRUNE_EXPIRED_WINDOWS);

    if (retryAfterSeconds !== null) throw rateLimited(retryAfterSeconds);
  });
}

export function signInThrottleRetryAfter(error: unknown) {
  if (!(error instanceof APIError) || error.body?.code !== RATE_LIMITED_CODE) {
    return null;
  }
  const retryAfterSeconds: unknown = error.body.retryAfterSeconds;

  return typeof retryAfterSeconds === "number"
    ? retryAfterSeconds
    : WINDOW_SECONDS;
}
