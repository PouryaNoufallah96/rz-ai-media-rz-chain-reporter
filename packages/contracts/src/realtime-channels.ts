import { realtime } from "inngest";

import {
  getOperationsRealtimeChannelName,
  getUsageRealtimeChannelName,
  OPERATIONS_REALTIME_STATUS_TOPIC,
  operationStatusRealtimeMessageSchema,
  USAGE_REALTIME_LEDGER_TOPIC,
  usageLedgerRealtimeMessageSchema,
} from "./realtime";

// Deliberately not re-exported from index: binding the wire schemas to the
// Inngest SDK must not follow a browser import of the message schemas.
export const operationsRealtimeChannel = realtime.channel({
  name: getOperationsRealtimeChannelName,
  topics: {
    [OPERATIONS_REALTIME_STATUS_TOPIC]: {
      schema: operationStatusRealtimeMessageSchema,
    },
  },
});

export const usageRealtimeChannel = realtime.channel({
  name: getUsageRealtimeChannelName,
  topics: {
    [USAGE_REALTIME_LEDGER_TOPIC]: {
      schema: usageLedgerRealtimeMessageSchema,
    },
  },
});
