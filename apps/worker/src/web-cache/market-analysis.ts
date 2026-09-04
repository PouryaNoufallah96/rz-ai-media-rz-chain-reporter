import {
  type MarketAnalysisChangedRealtimeMessage,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";
import {
  publishMarketAnalysisChanged,
  publishMarketAnalysisChangedNow,
  publishUsageLedgerChanged,
  type WorkerStep,
} from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import {
  notifyCacheInvalidation,
  notifyCacheInvalidationForDurableStep,
  waitForCacheFlush,
} from "./notify";

function message(
  marketAnalysisId: string,
): MarketAnalysisChangedRealtimeMessage {
  return {
    marketAnalysisId,
    operationId: null,
    occurredAt: new Date().toISOString(),
    schemaVersion: 1,
  };
}

export async function notifyMarketAnalysisChanged(
  step: WorkerStep,
  workspaceId: string,
  marketAnalysisId: string,
  callSite: string,
) {
  const cacheInvalidation = await step.run(
    `notify-market-analysis-cache-${callSite}`,
    () =>
      notifyCacheInvalidationForDurableStep([
        workspaceCacheTag(workspaceId, "market-analysis"),
      ]),
  );
  if (cacheInvalidation !== "accepted")
    return { cacheInvalidation, realtimePublished: false };
  await step.sleep(`let-market-analysis-cache-flush-${callSite}`, "1s");
  return {
    cacheInvalidation,
    realtimePublished: await publishMarketAnalysisChanged(
      step,
      workspaceId,
      message(marketAnalysisId),
      callSite,
    ),
  };
}

export async function notifyMarketAnalysisAndUsageChanged(
  step: WorkerStep,
  workspaceId: string,
  marketAnalysisId: string,
  callSite: string,
  usageActorId: string | null,
) {
  const cacheInvalidation = await step.run(
    `notify-market-analysis-usage-cache-${callSite}`,
    () =>
      notifyCacheInvalidationForDurableStep([
        workspaceCacheTag(workspaceId, "market-analysis"),
        workspaceCacheTag(workspaceId, "usage"),
      ]),
  );
  if (cacheInvalidation !== "accepted")
    return {
      cacheInvalidation,
      realtimePublished: false,
      usageRealtimePublished: false,
    };
  await step.sleep(`let-market-analysis-usage-cache-flush-${callSite}`, "1s");
  return {
    cacheInvalidation,
    realtimePublished: await publishMarketAnalysisChanged(
      step,
      workspaceId,
      message(marketAnalysisId),
      callSite,
    ),
    usageRealtimePublished: await publishUsageLedgerChanged(
      step,
      workspaceId,
      usageActorId,
    ),
  };
}

export function notifyMarketCatalogChanged(
  step: WorkerStep,
  workspaceId: string,
  callSite: string,
) {
  return step.run(`notify-market-catalog-cache-${callSite}`, () =>
    notifyCacheInvalidationForDurableStep([
      workspaceCacheTag(workspaceId, "market-analysis"),
    ]),
  );
}

export async function notifyMarketAnalysisChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  marketAnalysisId: string,
) {
  const cacheInvalidation = await notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "market-analysis"),
  ]);
  if (cacheInvalidation !== "accepted")
    return { cacheInvalidation, realtimePublished: false };
  await waitForCacheFlush();
  return {
    cacheInvalidation,
    realtimePublished: await publishMarketAnalysisChangedNow(
      client,
      workspaceId,
      message(marketAnalysisId),
    ),
  };
}

export async function notifyMarketDraftsChanged(
  step: WorkerStep,
  workspaceId: string,
  marketAnalysisId: string,
  callSite: string,
  usageActorId?: string | null,
) {
  const cacheInvalidation = await step.run(
    `notify-market-drafts-cache-${callSite}`,
    () =>
      notifyCacheInvalidationForDurableStep([
        workspaceCacheTag(workspaceId, "market-analysis"),
        workspaceCacheTag(workspaceId, "drafts"),
        ...(usageActorId === undefined
          ? []
          : [workspaceCacheTag(workspaceId, "usage")]),
      ]),
  );
  if (cacheInvalidation !== "accepted") {
    return { cacheInvalidation, realtimePublished: false };
  }
  await step.sleep(`let-market-drafts-cache-flush-${callSite}`, "1s");
  const realtimePublished = await publishMarketAnalysisChanged(
    step,
    workspaceId,
    message(marketAnalysisId),
    `drafts-${callSite}`,
  );
  if (usageActorId !== undefined) {
    await publishUsageLedgerChanged(step, workspaceId, usageActorId);
  }
  return { cacheInvalidation, realtimePublished };
}

export async function notifyMarketDraftsChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  marketAnalysisId: string,
) {
  const cacheInvalidation = await notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "market-analysis"),
    workspaceCacheTag(workspaceId, "drafts"),
  ]);
  if (cacheInvalidation !== "accepted") {
    return { cacheInvalidation, realtimePublished: false };
  }
  await waitForCacheFlush();
  return {
    cacheInvalidation,
    realtimePublished: await publishMarketAnalysisChangedNow(
      client,
      workspaceId,
      message(marketAnalysisId),
    ),
  };
}
