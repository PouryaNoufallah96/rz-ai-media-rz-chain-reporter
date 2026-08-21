import type { OperationStatusRealtimeMessage } from "@rz-chain-reporter/contracts";
import {
  operationsRealtimeChannel,
  usageRealtimeChannel,
} from "@rz-chain-reporter/contracts/realtime-channels";

import { workerLogger } from "../logging/logger";
import type { WorkerInngestClient } from "./client";

export type WorkerStep = Parameters<
  Parameters<WorkerInngestClient["createFunction"]>[1]
>[0]["step"];

export function publishOperationStatus(
  step: WorkerStep,
  workspaceId: string,
  message: OperationStatusRealtimeMessage,
  logEvent: string,
) {
  return step.realtime
    .publish(
      `publish-${message.lifecycle}-status`,
      operationsRealtimeChannel(workspaceId).status,
      message,
    )
    .then(() => true)
    .catch(() => {
      workerLogger.warn(logEvent, {
        operationId: message.operationId,
        status: message.lifecycle,
        workspaceId,
      });
      return false;
    });
}

export function publishUsageLedgerChanged(
  step: WorkerStep,
  workspaceId: string,
) {
  return step.realtime
    .publish("publish-usage-ledger", usageRealtimeChannel(workspaceId).ledger, {
      occurredAt: new Date().toISOString(),
      schemaVersion: 1,
    })
    .then(() => true)
    .catch(() => {
      workerLogger.warn("worker.usage-ledger.realtime-unavailable", {
        workspaceId,
      });
      return false;
    });
}
