# `@rz-chain-reporter/cache-invalidation`

Signing, verification and delivery for the internal cache-invalidation call. When
the worker changes data the web application has cached, it tells the web
application which tags to expire — and this package is how that message is
authenticated.

It depends only on `@rz-chain-reporter/contracts` and Node's `crypto`. No `next`,
no `server-only`, no auth. That is deliberate: the web application, the worker
and the database package's reconcile command all need it.

## What it exports

| Export | Purpose |
|---|---|
| `notifyCacheInvalidation({ baseUrl, secret, tags })` | Send a signed invalidation. Returns an outcome, never throws. |
| `verify(secret, timestamp, signature, rawBody)` | Verify an incoming request. Returns a boolean. |
| `CacheInvalidationOutcome` | `"accepted" \| "disabled" \| "failed" \| "rejected"` |

The wire contract itself — the path, the header names, the maximum clock skew and
the request and response schemas — lives in `packages/contracts`, so the sender
and the receiving route cannot disagree about it.

## The scheme

The signature is `HMAC-SHA256(secret, "<timestamp>.<rawBody>")`, hex-encoded, sent
alongside the timestamp in a header.

Verification rejects unless all of the following hold:

1. Both the timestamp and signature headers are present.
2. The timestamp is a safe integer within the allowed clock skew of now. This is
   what stops a captured request from being replayed later.
3. The computed and supplied signatures are the same length and compare equal
   under `timingSafeEqual` — a constant-time comparison, so the check does not
   leak the expected value one byte at a time.

## Failure behaviour

Invalidation is best-effort by design, and the four outcomes say exactly what
happened:

- **`disabled`** — no base URL or no secret was configured. Not an error. An
  installation that has not set up the internal call simply does not make it, and
  cached entries expire on their own schedule.
- **`rejected`** — the tags failed schema validation, the response was not `ok`,
  or the response did not confirm every requested tag as revalidated. The
  response is verified item by item rather than trusted because it returned 200.
- **`failed`** — the request threw or exceeded its 3-second timeout.
- **`accepted`** — every requested tag was confirmed revalidated.

Nothing here throws. A caller that cannot reach the web application must still
finish its own work: cache freshness is a nicety, and the database write it just
made is the truth.

## Related

- The receiving route: `apps/web/src/app/api/internal/cache-invalidation/route.ts`
- How tags are built and when they are expired:
  [`../../documentation/architecture/caching-and-realtime.md`](../../documentation/architecture/caching-and-realtime.md)
