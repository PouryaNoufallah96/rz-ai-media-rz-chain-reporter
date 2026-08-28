import type { CacheInvalidationOutcome } from "@rz-chain-reporter/cache-invalidation";
import {
  type PublishingChangedRealtimeMessage,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";

import {
  publishPublishingChanged,
  publishPublishingChangedNow,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import { notifyCacheInvalidation, waitForCacheFlush } from "./notify";

type PublishingChange = Omit<
  PublishingChangedRealtimeMessage,
  "occurredAt" | "schemaVersion"
>;

export async function notifyPublishingChanged(
  step: WorkerStep,
  workspaceId: string,
  change: PublishingChange,
  callSite: string,
) {
  const cacheInvalidation = await step.run(
    `notify-publishing-cache-${callSite}`,
    () =>
      settlePublishingNotification(
        () => notifyPublishingCacheChanged(workspaceId),
        waitForCacheFlush,
      ),
  );
  return {
    cacheInvalidation,
    publishingRealtimePublished:
      cacheInvalidation === "accepted"
        ? await publishPublishingChanged(
            step,
            workspaceId,
            publishingMessage(change),
            callSite,
          )
        : false,
  };
}

export async function settlePublishingNotification(
  notifyLane2: () => Promise<CacheInvalidationOutcome>,
  settle: () => Promise<void>,
) {
  const outcome = await notifyLane2();
  if (outcome === "accepted") {
    await settle();
  }
  return outcome;
}

export async function notifyPublishingChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  change: PublishingChange,
) {
  const cacheInvalidation = await notifyPublishingCacheChanged(workspaceId);
  if (cacheInvalidation === "accepted") {
    await waitForCacheFlush();
  }
  return {
    cacheInvalidation,
    publishingRealtimePublished:
      cacheInvalidation === "accepted"
        ? await publishPublishingChangedNow(
            client,
            workspaceId,
            publishingMessage(change),
          )
        : false,
  };
}

export function notifyPublishingCacheChanged(workspaceId: string) {
  return notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "publishing"),
  ]);
}

function publishingMessage(
  change: PublishingChange,
): PublishingChangedRealtimeMessage {
  return {
    ...change,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
