import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import { notifyCacheInvalidationForDurableStep } from "./notify";

export async function notifyUsageLedgerChanged(
  step: WorkerStep,
  workspaceId: string,
  actorId: string | null,
  callSite: string,
) {
  const cacheInvalidation = await step.run(
    `notify-usage-cache-${callSite}`,
    () =>
      notifyCacheInvalidationForDurableStep([
        workspaceCacheTag(workspaceId, "usage"),
      ]),
  );

  if (cacheInvalidation === "accepted") {
    await step.sleep(`let-usage-cache-flush-${callSite}`, "1s");
  }

  return {
    cacheInvalidation,
    usageRealtimePublished:
      cacheInvalidation === "accepted"
        ? await publishUsageLedgerChanged(step, workspaceId, actorId)
        : false,
  };
}
