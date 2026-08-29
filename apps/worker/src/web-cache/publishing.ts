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
import {
  notifyCacheInvalidation,
  notifyCacheInvalidationForDurableStep,
  waitForCacheFlush,
} from "./notify";

type PublishingChange = Omit<
  PublishingChangedRealtimeMessage,
  "occurredAt" | "schemaVersion"
>;

export async function notifyPublishingChanged(
  step: WorkerStep,
  workspaceId: string,
  actorId: string | null,
  change: PublishingChange,
  callSite: string,
) {
  const cacheInvalidation = await step.run(
    `notify-publishing-cache-${callSite}`,
    async () => {
      const outcome = await notifyCacheInvalidationForDurableStep([
        workspaceCacheTag(workspaceId, "publishing"),
      ]);
      if (outcome === "accepted") {
        await waitForCacheFlush();
      }
      return outcome;
    },
  );
  return {
    cacheInvalidation,
    publishingRealtimePublished:
      cacheInvalidation === "accepted" && actorId !== null
        ? await publishPublishingChanged(
            step,
            workspaceId,
            actorId,
            publishingMessage(change),
            callSite,
          )
        : false,
  };
}

export async function notifyPublishingChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  actorId: string | null,
  change: PublishingChange,
) {
  const cacheInvalidation = await notifyPublishingCacheChanged(workspaceId);
  if (cacheInvalidation === "accepted") {
    await waitForCacheFlush();
  }
  return {
    cacheInvalidation,
    publishingRealtimePublished:
      cacheInvalidation === "accepted" && actorId !== null
        ? await publishPublishingChangedNow(
            client,
            workspaceId,
            actorId,
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
