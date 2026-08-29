import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishSourcesChanged,
  publishSourcesChangedNow,
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import {
  notifyCacheInvalidation,
  notifyCacheInvalidationForDurableStep,
  waitForCacheFlush,
} from "./notify";

type SourcesNotificationCallSite =
  | "running"
  | "enriching"
  | "settled"
  | "failed"
  | "replayed";

export function notifySourcesChanged(
  step: WorkerStep,
  workspaceId: string,
  callSite: SourcesNotificationCallSite,
) {
  return notifySources(step, workspaceId, callSite, false, null);
}

export function notifySourcesAndUsageChanged(
  step: WorkerStep,
  workspaceId: string,
  callSite: SourcesNotificationCallSite,
  usageActorId: string | null,
) {
  return notifySources(step, workspaceId, callSite, true, usageActorId);
}

async function notifySources(
  step: WorkerStep,
  workspaceId: string,
  callSite: SourcesNotificationCallSite,
  withUsage: boolean,
  usageActorId: string | null,
) {
  const tags = withUsage
    ? [
        workspaceCacheTag(workspaceId, "sources"),
        workspaceCacheTag(workspaceId, "usage"),
      ]
    : [workspaceCacheTag(workspaceId, "sources")];

  const cacheInvalidation = await step.run(
    `notify-sources-cache-${callSite}`,
    () => notifyCacheInvalidationForDurableStep(tags),
  );

  if (cacheInvalidation !== "accepted") {
    return {
      cacheInvalidation,
      sourcesRealtimePublished: false,
      usageRealtimePublished: false,
    };
  }

  await step.sleep(`let-web-cache-flush-${callSite}`, "1s");

  return {
    cacheInvalidation,
    sourcesRealtimePublished: await publishSourcesChanged(
      step,
      workspaceId,
      callSite,
    ),
    usageRealtimePublished: withUsage
      ? await publishUsageLedgerChanged(step, workspaceId, usageActorId)
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

  await waitForCacheFlush();

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
