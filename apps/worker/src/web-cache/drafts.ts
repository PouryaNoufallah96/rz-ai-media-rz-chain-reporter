import {
  type DraftsChangedRealtimeMessage,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";

import {
  publishDraftsChanged,
  publishDraftsChangedNow,
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import {
  notifyCacheInvalidation,
  notifyCacheInvalidationForDurableStep,
  waitForCacheFlush,
} from "./notify";

export type DraftChange = Omit<
  DraftsChangedRealtimeMessage,
  "occurredAt" | "schemaVersion"
>;

export function notifyDraftsChanged(
  step: WorkerStep,
  workspaceId: string,
  change: DraftChange,
  callSite: string,
) {
  return notifyDrafts(step, workspaceId, change, callSite, false, null);
}

export function notifyDraftsAndUsageChanged(
  step: WorkerStep,
  workspaceId: string,
  change: DraftChange,
  callSite: string,
  usageActorId: string | null,
) {
  return notifyDrafts(step, workspaceId, change, callSite, true, usageActorId);
}

async function notifyDrafts(
  step: WorkerStep,
  workspaceId: string,
  change: DraftChange,
  callSite: string,
  withUsage: boolean,
  usageActorId: string | null,
) {
  const tags = withUsage
    ? [
        workspaceCacheTag(workspaceId, "drafts"),
        workspaceCacheTag(workspaceId, "usage"),
      ]
    : [workspaceCacheTag(workspaceId, "drafts")];

  const cacheInvalidation = await step.run(
    `notify-drafts-cache-${callSite}`,
    () => notifyCacheInvalidationForDurableStep(tags),
  );

  if (cacheInvalidation !== "accepted") {
    return {
      cacheInvalidation,
      draftsRealtimePublished: false,
      usageRealtimePublished: false,
    };
  }

  await step.sleep(`let-drafts-cache-flush-${callSite}`, "1s");

  return {
    cacheInvalidation,
    draftsRealtimePublished: await publishDraftsChanged(
      step,
      workspaceId,
      draftMessage(change),
      callSite,
    ),
    usageRealtimePublished: withUsage
      ? await publishUsageLedgerChanged(step, workspaceId, usageActorId)
      : false,
  };
}

export async function notifyDraftsChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  change: DraftChange,
) {
  const cacheInvalidation = await notifyDraftsCacheChanged(workspaceId);
  if (cacheInvalidation !== "accepted") {
    return { cacheInvalidation, draftsRealtimePublished: false };
  }

  await waitForCacheFlush();
  return {
    cacheInvalidation,
    draftsRealtimePublished: await publishDraftsChangedNow(
      client,
      workspaceId,
      draftMessage(change),
    ),
  };
}

export function notifyDraftsCacheChanged(workspaceId: string) {
  return notifyCacheInvalidation([workspaceCacheTag(workspaceId, "drafts")]);
}

function draftMessage(change: DraftChange): DraftsChangedRealtimeMessage {
  return {
    ...change,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}
