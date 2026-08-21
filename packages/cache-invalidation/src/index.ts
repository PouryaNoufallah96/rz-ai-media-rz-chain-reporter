import { createHmac, timingSafeEqual } from "node:crypto";

import {
  CACHE_INVALIDATION_MAX_SKEW_MS,
  CACHE_INVALIDATION_PATH,
  CACHE_INVALIDATION_SIGNATURE_HEADER,
  CACHE_INVALIDATION_TIMESTAMP_HEADER,
  cacheInvalidationRequestSchema,
} from "@rz-chain-reporter/contracts";

const REQUEST_TIMEOUT_MS = 3_000;

export type CacheInvalidationOutcome =
  | "accepted"
  | "disabled"
  | "failed"
  | "rejected";

function sign(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

export function verify(
  secret: string,
  timestamp: string | null,
  signature: string | null,
  rawBody: string,
) {
  if (!timestamp || !signature) {
    return false;
  }

  const sentAt = Number(timestamp);
  if (
    !Number.isSafeInteger(sentAt) ||
    Math.abs(Date.now() - sentAt) > CACHE_INVALIDATION_MAX_SKEW_MS
  ) {
    return false;
  }

  const expected = Buffer.from(sign(secret, timestamp, rawBody));
  const supplied = Buffer.from(signature);

  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

export async function notifyCacheInvalidation({
  baseUrl,
  secret,
  tags,
}: {
  baseUrl?: string;
  secret?: string;
  tags: readonly string[];
}): Promise<CacheInvalidationOutcome> {
  if (!baseUrl || !secret) {
    return "disabled";
  }

  const parsed = cacheInvalidationRequestSchema.safeParse({ tags });
  if (!parsed.success) {
    return "rejected";
  }

  const body = JSON.stringify(parsed.data);
  const timestamp = Date.now().toString();

  try {
    const response = await fetch(new URL(CACHE_INVALIDATION_PATH, baseUrl), {
      body,
      headers: {
        "content-type": "application/json",
        [CACHE_INVALIDATION_SIGNATURE_HEADER]: sign(secret, timestamp, body),
        [CACHE_INVALIDATION_TIMESTAMP_HEADER]: timestamp,
      },
      method: "POST",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    return response.ok ? "accepted" : "rejected";
  } catch {
    return "failed";
  }
}
