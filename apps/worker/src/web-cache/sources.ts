import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishSourcesChanged,
  publishSourcesChangedNow,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import { notifyCacheInvalidation } from "./notify";

// Web's tag flush settles a little after its 202, so a ping sent immediately
// makes the refresh re-read the entry the flush is still recomputing.
const CACHE_FLUSH_SETTLE = "1s";
const CACHE_FLUSH_SETTLE_MS = 1_000;

export async function notifySourcesChanged(
  step: WorkerStep,
  workspaceId: string,
  callSite: "running" | "enriching" | "settled" | "failed" | "replayed",
) {
  const cacheInvalidation = await step.run(
    `notify-sources-cache-${callSite}`,
    () => notifySourcesCacheChanged(workspaceId),
  );

  if (cacheInvalidation === "accepted") {
    await step.sleep(`let-web-cache-flush-${callSite}`, CACHE_FLUSH_SETTLE);
  }

  return {
    cacheInvalidation,
    sourcesRealtimePublished:
      cacheInvalidation === "accepted"
        ? await publishSourcesChanged(step, workspaceId, callSite)
        : false,
  };
}

export async function notifySourcesChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
) {
  const cacheInvalidation = await notifySourcesCacheChanged(workspaceId);

  if (cacheInvalidation !== "accepted") {
    return { cacheInvalidation, sourcesRealtimePublished: false };
  }

  await new Promise((resolve) => setTimeout(resolve, CACHE_FLUSH_SETTLE_MS));

  return {
    cacheInvalidation,
    sourcesRealtimePublished: await publishSourcesChangedNow(
      client,
      workspaceId,
    ),
  };
}

export function notifySourcesCacheChanged(workspaceId: string) {
  return notifyCacheInvalidation([workspaceCacheTag(workspaceId, "sources")]);
}
