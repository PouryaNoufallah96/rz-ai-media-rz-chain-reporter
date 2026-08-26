import {
  type CacheInvalidationOutcome,
  notifyCacheInvalidation as postCacheInvalidation,
} from "@rz-chain-reporter/cache-invalidation";

import { workerLogger } from "../logging/logger";
import { workerEnv } from "../runtime/env";

const CACHE_FLUSH_SETTLE_MS = 250;

export function waitForCacheFlush() {
  return new Promise<void>((resolve) =>
    setTimeout(resolve, CACHE_FLUSH_SETTLE_MS),
  );
}

export function reportCacheInvalidationConfiguration() {
  const hasSecret = workerEnv.CACHE_INVALIDATION_WEBHOOK_SECRET !== undefined;
  const hasBaseUrl = workerEnv.WEB_INTERNAL_BASE_URL !== undefined;

  if (hasSecret === hasBaseUrl) {
    workerLogger.info("worker.cache-invalidation.configured", {
      mode: hasSecret ? "enabled" : "disabled",
    });
    return;
  }

  workerLogger.warn("worker.cache-invalidation.misconfigured", {
    reason: hasSecret ? "missing-base-url" : "missing-secret",
  });
}

export async function notifyCacheInvalidation(
  tags: readonly string[],
): Promise<CacheInvalidationOutcome> {
  const outcome = await postCacheInvalidation({
    baseUrl: workerEnv.WEB_INTERNAL_BASE_URL,
    secret: workerEnv.CACHE_INVALIDATION_WEBHOOK_SECRET,
    tags,
  });

  if (outcome === "failed" || outcome === "rejected") {
    workerLogger.warn(`worker.cache-invalidation.${outcome}`, {
      tagCount: tags.length,
    });
  }

  return outcome;
}
