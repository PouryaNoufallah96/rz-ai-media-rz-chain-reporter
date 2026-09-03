import type {
  DraftsChangedRealtimeMessage,
  MarketAnalysisChangedRealtimeMessage,
  OperationStatusRealtimeMessage,
  OperationsChangedRealtimeMessage,
  PublishingChangedRealtimeMessage,
} from "@rz-chain-reporter/contracts";
import {
  draftsRealtimeChannel,
  editorialRealtimeChannel,
  marketAnalysisRealtimeChannel,
  operationsRealtimeChannel,
  publishingRealtimeChannel,
  sourcesRealtimeChannel,
  usageRealtimeChannel,
} from "@rz-chain-reporter/contracts/realtime-channels";

import { type WorkerLogFields, workerLogger } from "../logging/logger";
import type { WorkerInngestClient } from "./client";

export type WorkerStep = Parameters<
  Parameters<WorkerInngestClient["createFunction"]>[1]
>[0]["step"];

function settled(
  publish: Promise<unknown>,
  logEvent: string,
  fields: WorkerLogFields,
) {
  return publish
    .then(() => true)
    .catch(() => {
      workerLogger.warn(logEvent, fields);
      return false;
    });
}

function ping() {
  return { occurredAt: new Date().toISOString(), schemaVersion: 1 } as const;
}

export function publishOperationStatus(
  step: WorkerStep,
  workspaceId: string,
  message: OperationStatusRealtimeMessage,
  logEvent: string,
) {
  return settled(
    step.realtime.publish(
      `publish-${message.lifecycle}-status`,
      operationsRealtimeChannel(workspaceId).status,
      message,
    ),
    logEvent,
    {
      operationId: message.operationId,
      status: message.lifecycle,
      workspaceId,
    },
  );
}

export function publishOperationsChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  message: OperationsChangedRealtimeMessage,
) {
  return settled(
    client.realtime.publish(
      operationsRealtimeChannel(workspaceId).changed,
      message,
    ),
    "worker.operations.realtime-unavailable",
    { workspaceId },
  );
}

export function publishPublishingChanged(
  step: WorkerStep,
  workspaceId: string,
  actorId: string,
  message: PublishingChangedRealtimeMessage,
  callSite: string,
) {
  return settled(
    step.realtime.publish(
      `publish-publishing-changed-${callSite}`,
      publishingRealtimeChannel(workspaceId, actorId).changed,
      message,
    ),
    "worker.publishing.realtime-unavailable",
    { operationId: message.operationId, workspaceId },
  );
}

export function publishPublishingChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  actorId: string,
  message: PublishingChangedRealtimeMessage,
) {
  return settled(
    client.realtime.publish(
      publishingRealtimeChannel(workspaceId, actorId).changed,
      message,
    ),
    "worker.publishing.realtime-unavailable",
    { operationId: message.operationId, workspaceId },
  );
}

export function publishSourcesChanged(
  step: WorkerStep,
  workspaceId: string,
  callSite: string,
) {
  return settled(
    step.realtime.publish(
      `publish-sources-changed-${callSite}`,
      sourcesRealtimeChannel(workspaceId).changed,
      ping(),
    ),
    "worker.sources.realtime-unavailable",
    { workspaceId },
  );
}

export function publishSourcesChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
) {
  return settled(
    client.realtime.publish(
      sourcesRealtimeChannel(workspaceId).changed,
      ping(),
    ),
    "worker.sources.realtime-unavailable",
    { workspaceId },
  );
}

export function publishEditorialChanged(
  step: WorkerStep,
  workspaceId: string,
  analysisRunId: string,
  callSite: string,
) {
  return settled(
    step.realtime.publish(
      `publish-editorial-changed-${callSite}`,
      editorialRealtimeChannel(workspaceId, analysisRunId).changed,
      { analysisRunId, ...ping() },
    ),
    "worker.editorial.realtime-unavailable",
    { analysisRunId, workspaceId },
  );
}

export function publishEditorialChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  analysisRunId: string,
) {
  return settled(
    client.realtime.publish(
      editorialRealtimeChannel(workspaceId, analysisRunId).changed,
      { analysisRunId, ...ping() },
    ),
    "worker.editorial.realtime-unavailable",
    { analysisRunId, workspaceId },
  );
}

export function publishMarketAnalysisChanged(
  step: WorkerStep,
  workspaceId: string,
  message: MarketAnalysisChangedRealtimeMessage,
  callSite: string,
) {
  return settled(
    step.realtime.publish(
      `publish-market-analysis-changed-${callSite}`,
      marketAnalysisRealtimeChannel(workspaceId, message.marketAnalysisId)
        .changed,
      message,
    ),
    "worker.market-analysis.realtime-unavailable",
    {
      ...(message.operationId === null
        ? {}
        : { operationId: message.operationId }),
      workspaceId,
    },
  );
}

export function publishMarketAnalysisChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  message: MarketAnalysisChangedRealtimeMessage,
) {
  return settled(
    client.realtime.publish(
      marketAnalysisRealtimeChannel(workspaceId, message.marketAnalysisId)
        .changed,
      message,
    ),
    "worker.market-analysis.realtime-unavailable",
    {
      ...(message.operationId === null
        ? {}
        : { operationId: message.operationId }),
      workspaceId,
    },
  );
}

export function publishUsageLedgerChanged(
  step: WorkerStep,
  workspaceId: string,
  actorId: string | null,
) {
  if (!actorId) {
    return Promise.resolve(false);
  }
  return settled(
    step.realtime.publish(
      "publish-usage-ledger",
      usageRealtimeChannel(workspaceId, actorId).ledger,
      ping(),
    ),
    "worker.usage-ledger.realtime-unavailable",
    { workspaceId },
  );
}

export function publishDraftsChanged(
  step: WorkerStep,
  workspaceId: string,
  message: DraftsChangedRealtimeMessage,
  callSite: string,
) {
  return settled(
    step.realtime.publish(
      `publish-drafts-changed-${callSite}`,
      draftsRealtimeChannel(workspaceId, message.analysisRunId).changed,
      message,
    ),
    "worker.drafts.realtime-unavailable",
    { operationId: message.operationId, workspaceId },
  );
}

export function publishDraftsChangedNow(
  client: WorkerInngestClient,
  workspaceId: string,
  message: DraftsChangedRealtimeMessage,
) {
  return settled(
    client.realtime.publish(
      draftsRealtimeChannel(workspaceId, message.analysisRunId).changed,
      message,
    ),
    "worker.drafts.realtime-unavailable",
    { operationId: message.operationId, workspaceId },
  );
}
