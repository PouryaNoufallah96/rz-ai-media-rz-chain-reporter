import {
  getOperationsRealtimeChannelName,
  OPERATIONS_REALTIME_STATUS_TOPIC,
  type OperationStatusRealtimeMessage,
  operationStatusRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { realtime } from "inngest";

import { workerLogger } from "../logging/logger";
import type { WorkerInngestClient } from "./client";

export const operationsRealtimeChannel = realtime.channel({
  name: getOperationsRealtimeChannelName,
  topics: {
    [OPERATIONS_REALTIME_STATUS_TOPIC]: {
      schema: operationStatusRealtimeMessageSchema,
    },
  },
});

type WorkerStep = Parameters<
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
