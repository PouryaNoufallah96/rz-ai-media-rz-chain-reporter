import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import { publishSourcesChanged, type WorkerStep } from "../inngest/channels";
import { notifyCacheInvalidation } from "./notify";

// Web's tag flush settles a little after its 202, so a ping sent immediately
// makes the refresh re-read the entry the flush is still recomputing.
const CACHE_FLUSH_SETTLE = "1s";

export async function notifySourcesChanged(
  step: WorkerStep,
  workspaceId: string,
  callSite: "running" | "enriching" | "settled" | "failed",
) {
  const cacheInvalidation = await step.run(
    `notify-sources-cache-${callSite}`,
    () => notifyCacheInvalidation([workspaceCacheTag(workspaceId, "sources")]),
  );

  if (cacheInvalidation === "accepted") {
    await step.sleep(`let-web-cache-flush-${callSite}`, CACHE_FLUSH_SETTLE);
  }

  return {
    cacheInvalidation,
    sourcesRealtimePublished: await publishSourcesChanged(
      step,
      workspaceId,
      callSite,
    ),
  };
}
