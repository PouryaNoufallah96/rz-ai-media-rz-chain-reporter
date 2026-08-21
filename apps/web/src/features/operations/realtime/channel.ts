import {
  getOperationsRealtimeChannelName,
  OPERATIONS_REALTIME_STATUS_TOPIC,
  operationStatusRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { realtime } from "inngest";

export const operationsRealtimeChannel = realtime.channel({
  name: getOperationsRealtimeChannelName,
  topics: {
    [OPERATIONS_REALTIME_STATUS_TOPIC]: {
      schema: operationStatusRealtimeMessageSchema,
    },
  },
});
