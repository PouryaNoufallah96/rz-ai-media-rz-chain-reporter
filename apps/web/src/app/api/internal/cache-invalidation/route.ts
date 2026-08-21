import "server-only";

import {
  problemResponse,
  resolveRequestId,
  withRequestId,
} from "@rz-chain-reporter/api/request";
import { verify } from "@rz-chain-reporter/cache-invalidation";
import {
  CACHE_INVALIDATION_MAX_BODY_BYTES,
  CACHE_INVALIDATION_SIGNATURE_HEADER,
  CACHE_INVALIDATION_TIMESTAMP_HEADER,
  type CacheInvalidationResponse,
  cacheInvalidationRequestSchema,
} from "@rz-chain-reporter/contracts";
import { env } from "@rz-chain-reporter/env/server";
import { revalidateTag } from "next/cache";

export async function POST(request: Request) {
  const requestId = resolveRequestId(request.headers);
  const secret = env.CACHE_INVALIDATION_WEBHOOK_SECRET;

  if (!secret) {
    return problemResponse(
      requestId,
      503,
      "cache_invalidation_disabled",
      "Cache invalidation is not configured",
    );
  }

  if (
    Number(request.headers.get("content-length")) >
    CACHE_INVALIDATION_MAX_BODY_BYTES
  ) {
    return payloadTooLarge(requestId);
  }

  const rawBody = await request.text();
  if (Buffer.byteLength(rawBody) > CACHE_INVALIDATION_MAX_BODY_BYTES) {
    return payloadTooLarge(requestId);
  }

  const authentic = verify(
    secret,
    request.headers.get(CACHE_INVALIDATION_TIMESTAMP_HEADER),
    request.headers.get(CACHE_INVALIDATION_SIGNATURE_HEADER),
    rawBody,
  );

  if (!authentic) {
    return problemResponse(
      requestId,
      401,
      "invalid_signature",
      "Invalid signature",
    );
  }

  const parsed = cacheInvalidationRequestSchema.safeParse(parseJson(rawBody));
  if (!parsed.success) {
    return problemResponse(requestId, 400, "invalid_body", "Invalid body");
  }

  const body: CacheInvalidationResponse = {
    status: "accepted",
    tags: parsed.data.tags.map((tag) => ({
      revalidated: tryRevalidate(tag),
      tag,
    })),
  };

  return withRequestId(Response.json(body, { status: 202 }), requestId);
}

function payloadTooLarge(requestId: string) {
  return problemResponse(
    requestId,
    413,
    "payload_too_large",
    "Payload too large",
  );
}

// A push-driven refresh follows immediately, so the next read must block on
// fresh data instead of serving the stale entry `"max"` would leave behind.
function tryRevalidate(tag: string) {
  try {
    revalidateTag(tag, { expire: 0 });
    return true;
  } catch {
    return false;
  }
}

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}
