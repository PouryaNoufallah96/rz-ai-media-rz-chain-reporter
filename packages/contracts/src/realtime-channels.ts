import { realtime } from "inngest";

import {
  EDITORIAL_REALTIME_CHANGED_TOPIC,
  editorialChangedRealtimeMessageSchema,
  getEditorialRealtimeChannelName,
  getOperationsRealtimeChannelName,
  getSourcesRealtimeChannelName,
  getUsageRealtimeChannelName,
  OPERATIONS_REALTIME_STATUS_TOPIC,
  operationStatusRealtimeMessageSchema,
  SOURCES_REALTIME_CHANGED_TOPIC,
  sourcesChangedRealtimeMessageSchema,
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

export const sourcesRealtimeChannel = realtime.channel({
  name: getSourcesRealtimeChannelName,
  topics: {
    [SOURCES_REALTIME_CHANGED_TOPIC]: {
      schema: sourcesChangedRealtimeMessageSchema,
    },
  },
});

export const editorialRealtimeChannel = realtime.channel({
  name: getEditorialRealtimeChannelName,
  topics: {
    [EDITORIAL_REALTIME_CHANGED_TOPIC]: {
      schema: editorialChangedRealtimeMessageSchema,
    },
  },
});
