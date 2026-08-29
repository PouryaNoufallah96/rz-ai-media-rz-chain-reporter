import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishEditorialChanged,
  publishEditorialChangedNow,
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import {
  notifyCacheInvalidation,
  notifyCacheInvalidationForDurableStep,
  waitForCacheFlush,
} from "./notify";

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

export function notifyEditorialChanged(
  step: WorkerStep,
  workspaceId: string,
  analysisRunId: string,
  callSite: EditorialNotificationCallSite,
) {
  return notifyEditorial(
    step,
    workspaceId,
    analysisRunId,
    callSite,
    false,
    null,
  );
}

export function notifyEditorialAndUsageChanged(
  step: WorkerStep,
  workspaceId: string,
  analysisRunId: string,
  callSite: EditorialNotificationCallSite,
  usageActorId: string | null,
) {
  return notifyEditorial(
    step,
    workspaceId,
    analysisRunId,
    callSite,
    true,
    usageActorId,
  );
}

async function notifyEditorial(
  step: WorkerStep,
  workspaceId: string,
  analysisRunId: string,
  callSite: EditorialNotificationCallSite,
  withUsage: boolean,
  usageActorId: string | null,
) {
  const tags = withUsage
    ? [
        workspaceCacheTag(workspaceId, "editorial"),
        workspaceCacheTag(workspaceId, "usage"),
      ]
    : [workspaceCacheTag(workspaceId, "editorial")];

  const cacheInvalidation = await step.run(
    `notify-editorial-cache-${callSite}`,
    () => notifyCacheInvalidationForDurableStep(tags),
  );

  if (cacheInvalidation !== "accepted") {
    return {
      cacheInvalidation,
      editorialRealtimePublished: false,
      usageRealtimePublished: false,
    };
  }

  await step.sleep(`let-web-cache-flush-${callSite}`, "1s");

  return {
    cacheInvalidation,
    editorialRealtimePublished: await publishEditorialChanged(
      step,
      workspaceId,
      analysisRunId,
      callSite,
    ),
    usageRealtimePublished: withUsage
      ? await publishUsageLedgerChanged(step, workspaceId, usageActorId)
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

  await waitForCacheFlush();

  return {
    cacheInvalidation,
    editorialRealtimePublished: await publishEditorialChangedNow(
      client,
      workspaceId,
      analysisRunId,
    ),
  };
}
