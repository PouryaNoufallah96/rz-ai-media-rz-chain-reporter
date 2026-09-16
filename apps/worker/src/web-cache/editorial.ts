import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

import {
  publishDraftsChanged,
  publishDraftsChangedNow,
  publishEditorialChanged,
  publishEditorialChangedNow,
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import { type DraftChange, draftsChangedMessage } from "./drafts";
import {
  notifyCacheInvalidation,
  notifyCacheInvalidationForDurableStep,
  waitForCacheFlush,
} from "./notify";

type PresentationTranslationChange = {
  analysisRunId: string;
  code: DraftChange["code"];
  operationId: string;
  platformDraftIds: readonly string[];
};

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
  | "failed"
  | "translation";

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
    [],
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
    [],
  );
}

export function notifyEditorialPresentationTranslationChanged(
  step: WorkerStep,
  workspaceId: string,
  change: PresentationTranslationChange,
  usageActorId: string,
) {
  return notifyEditorial(
    step,
    workspaceId,
    change.analysisRunId,
    "translation",
    true,
    usageActorId,
    presentationTranslationDraftChanges(change),
  );
}

async function notifyEditorial(
  step: WorkerStep,
  workspaceId: string,
  analysisRunId: string,
  callSite: EditorialNotificationCallSite,
  withUsage: boolean,
  usageActorId: string | null,
  draftChanges: readonly DraftChange[],
) {
  const tags = [
    workspaceCacheTag(workspaceId, "editorial"),
    ...(draftChanges.length > 0
      ? [workspaceCacheTag(workspaceId, "drafts")]
      : []),
    ...(withUsage ? [workspaceCacheTag(workspaceId, "usage")] : []),
  ];

  const cacheInvalidation = await step.run(
    `notify-editorial-cache-${callSite}`,
    () => notifyCacheInvalidationForDurableStep(tags),
  );

  if (cacheInvalidation !== "accepted") {
    return {
      cacheInvalidation,
      draftsRealtimePublished: false,
      editorialRealtimePublished: false,
      usageRealtimePublished: false,
    };
  }

  await step.sleep(`let-web-cache-flush-${callSite}`, "1s");

  const [
    editorialRealtimePublished,
    draftsRealtimePublished,
    usageRealtimePublished,
  ] = await Promise.all([
    publishEditorialChanged(step, workspaceId, analysisRunId, callSite),
    publishDraftChanges(step, workspaceId, draftChanges, callSite),
    withUsage
      ? publishUsageLedgerChanged(step, workspaceId, usageActorId, callSite)
      : false,
  ]);

  return {
    cacheInvalidation,
    draftsRealtimePublished,
    editorialRealtimePublished,
    usageRealtimePublished,
  };
}

export async function notifyEditorialChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  analysisRunId: string,
) {
  return notifyEditorialChangedNowForTags(client, workspaceId, analysisRunId, [
    workspaceCacheTag(workspaceId, "editorial"),
  ]);
}

export async function notifyEditorialTranslationDispatchChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  change: PresentationTranslationChange,
) {
  const draftChanges = presentationTranslationDraftChanges(change);
  return notifyEditorialChangedNowForTags(
    client,
    workspaceId,
    change.analysisRunId,
    [
      workspaceCacheTag(workspaceId, "editorial"),
      ...(draftChanges.length > 0
        ? [workspaceCacheTag(workspaceId, "drafts")]
        : []),
    ],
    draftChanges,
  );
}

async function notifyEditorialChangedNowForTags(
  client: WorkerInngestClient,
  workspaceId: string,
  analysisRunId: string,
  tags: readonly string[],
  draftChanges: readonly DraftChange[] = [],
) {
  const cacheInvalidation = await notifyCacheInvalidation(tags);

  if (cacheInvalidation !== "accepted") {
    return {
      cacheInvalidation,
      draftsRealtimePublished: false,
      editorialRealtimePublished: false,
    };
  }

  await waitForCacheFlush();

  const [editorialRealtimePublished, draftsRealtimePublished] =
    await Promise.all([
      publishEditorialChangedNow(client, workspaceId, analysisRunId),
      publishDraftChangesNow(client, workspaceId, draftChanges),
    ]);

  return {
    cacheInvalidation,
    draftsRealtimePublished,
    editorialRealtimePublished,
  };
}

function presentationTranslationDraftChanges(
  change: PresentationTranslationChange,
): DraftChange[] {
  return change.platformDraftIds.map((platformDraftId) => ({
    analysisRunId: change.analysisRunId,
    code: change.code,
    operationId: change.operationId,
    platformDraftId,
  }));
}

async function publishDraftChanges(
  step: WorkerStep,
  workspaceId: string,
  changes: readonly DraftChange[],
  callSite: string,
) {
  const published = await Promise.all(
    changes.map((change) =>
      publishDraftsChanged(
        step,
        workspaceId,
        draftsChangedMessage(change),
        `${callSite}-${change.platformDraftId}`,
      ),
    ),
  );
  return published.length > 0 && published.every(Boolean);
}

async function publishDraftChangesNow(
  client: WorkerInngestClient,
  workspaceId: string,
  changes: readonly DraftChange[],
) {
  const published = await Promise.all(
    changes.map((change) =>
      publishDraftsChangedNow(
        client,
        workspaceId,
        draftsChangedMessage(change),
      ),
    ),
  );
  return published.length > 0 && published.every(Boolean);
}
