import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishEditorialChanged,
  publishEditorialChangedNow,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import { notifyCacheInvalidation } from "./notify";

// Web's tag flush settles a little after its 202, so a ping sent immediately
// makes the refresh re-read the entry the flush is still recomputing.
const CACHE_FLUSH_SETTLE = "1s";
const CACHE_FLUSH_SETTLE_MS = 1_000;

type EditorialNotificationCallSite =
  | "claimed"
  | "source-bound"
  | "semantic-started"
  | "filtered"
  | "planned"
  | "unit-started"
  | "unit"
  | "cancelled"
  | "settled"
  | "failed";

export async function notifyEditorialChanged(
  step: WorkerStep,
  workspaceId: string,
  analysisRunId: string,
  callSite: EditorialNotificationCallSite,
) {
  const cacheInvalidation = await step.run(
    `notify-editorial-cache-${callSite}`,
    () =>
      notifyCacheInvalidation([workspaceCacheTag(workspaceId, "editorial")]),
  );

  if (cacheInvalidation === "accepted") {
    await step.sleep(`let-web-cache-flush-${callSite}`, CACHE_FLUSH_SETTLE);
  }

  return {
    cacheInvalidation,
    editorialRealtimePublished:
      cacheInvalidation === "accepted"
        ? await publishEditorialChanged(
            step,
            workspaceId,
            analysisRunId,
            callSite,
          )
        : false,
  };
}

export async function notifyEditorialChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  analysisRunId: string,
) {
  const cacheInvalidation = await notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "editorial"),
  ]);

  if (cacheInvalidation !== "accepted") {
    return { cacheInvalidation, editorialRealtimePublished: false };
  }

  await new Promise((resolve) => setTimeout(resolve, CACHE_FLUSH_SETTLE_MS));

  return {
    cacheInvalidation,
    editorialRealtimePublished: await publishEditorialChangedNow(
      client,
      workspaceId,
      analysisRunId,
    ),
  };
}
