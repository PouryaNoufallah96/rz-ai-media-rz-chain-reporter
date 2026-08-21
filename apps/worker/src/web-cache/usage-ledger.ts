import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import { notifyCacheInvalidation } from "./notify";

// Web's tag flush settles a little after its 202, so a ping sent immediately
// makes the refresh re-read the entry the flush is still recomputing.
const CACHE_FLUSH_SETTLE = "1s";

export async function notifyUsageLedgerChanged(
  step: WorkerStep,
  workspaceId: string,
) {
  const cacheInvalidation = await step.run("notify-usage-cache", () =>
    notifyCacheInvalidation([workspaceCacheTag(workspaceId, "usage")]),
  );

  if (cacheInvalidation === "accepted") {
    await step.sleep("let-web-cache-flush", CACHE_FLUSH_SETTLE);
  }

  return {
    cacheInvalidation,
    usageRealtimePublished: await publishUsageLedgerChanged(step, workspaceId),
  };
}
