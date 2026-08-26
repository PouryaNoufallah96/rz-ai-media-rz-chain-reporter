import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import { notifyCacheInvalidation } from "./notify";

export async function notifyUsageLedgerChanged(
  step: WorkerStep,
  workspaceId: string,
) {
  const cacheInvalidation = await step.run("notify-usage-cache", () =>
    notifyCacheInvalidation([workspaceCacheTag(workspaceId, "usage")]),
  );

  if (cacheInvalidation === "accepted") {
    await step.sleep("let-web-cache-flush", "1s");
  }

  return {
    cacheInvalidation,
    usageRealtimePublished:
      cacheInvalidation === "accepted"
        ? await publishUsageLedgerChanged(step, workspaceId)
        : false,
  };
}
