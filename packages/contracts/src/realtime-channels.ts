import { realtime } from "inngest";

import {
  DRAFTS_REALTIME_CHANGED_TOPIC,
  draftsChangedRealtimeMessageSchema,
  EDITORIAL_REALTIME_CHANGED_TOPIC,
  editorialChangedRealtimeMessageSchema,
  getDraftsRealtimeChannelName,
  getEditorialRealtimeChannelName,
  getMarketAnalysisRealtimeChannelName,
  getOperationsRealtimeChannelName,
  getPublishingRealtimeChannelName,
  getSourcesRealtimeChannelName,
  getUsageRealtimeChannelName,
  MARKET_ANALYSIS_REALTIME_CHANGED_TOPIC,
  marketAnalysisChangedRealtimeMessageSchema,
  OPERATIONS_REALTIME_CHANGED_TOPIC,
  OPERATIONS_REALTIME_STATUS_TOPIC,
  operationStatusRealtimeMessageSchema,
  operationsChangedRealtimeMessageSchema,
  PUBLISHING_REALTIME_CHANGED_TOPIC,
  publishingChangedRealtimeMessageSchema,
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
    [OPERATIONS_REALTIME_CHANGED_TOPIC]: {
      schema: operationsChangedRealtimeMessageSchema,
    },
  },
});

export const publishingRealtimeChannel = realtime.channel({
  name: getPublishingRealtimeChannelName,
  topics: {
    [PUBLISHING_REALTIME_CHANGED_TOPIC]: {
      schema: publishingChangedRealtimeMessageSchema,
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

export const draftsRealtimeChannel = realtime.channel({
  name: getDraftsRealtimeChannelName,
  topics: {
    [DRAFTS_REALTIME_CHANGED_TOPIC]: {
      schema: draftsChangedRealtimeMessageSchema,
    },
  },
});

export const marketAnalysisRealtimeChannel = realtime.channel({
  name: getMarketAnalysisRealtimeChannelName,
  topics: {
    [MARKET_ANALYSIS_REALTIME_CHANGED_TOPIC]: {
      schema: marketAnalysisChangedRealtimeMessageSchema,
    },
  },
});
