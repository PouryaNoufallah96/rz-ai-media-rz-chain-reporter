import { z } from "zod";

import { attemptOutcomeSchema, operationLifecycleSchema } from "./operation";

export const OPERATIONS_REALTIME_TOPICS = ["status"] as const;
export const OPERATIONS_REALTIME_STATUS_TOPIC = OPERATIONS_REALTIME_TOPICS[0];

export function getOperationsRealtimeChannelName(workspaceId: string) {
  return `operations:${workspaceId}` as const;
}

export const operationStatusRealtimeMessageSchema = z.strictObject({
  operationId: z.uuid(),
  lifecycle: operationLifecycleSchema,
  operationVersion: z.int().positive(),
  attemptCount: z.int().nonnegative().optional(),
  latestAttemptOutcome: attemptOutcomeSchema.optional(),
});

export type OperationStatusRealtimeMessage = z.infer<
  typeof operationStatusRealtimeMessageSchema
>;

export const USAGE_REALTIME_TOPICS = ["ledger"] as const;
export const USAGE_REALTIME_LEDGER_TOPIC = USAGE_REALTIME_TOPICS[0];

export function getUsageRealtimeChannelName(workspaceId: string) {
  return `usage:${workspaceId}` as const;
}

export const usageLedgerRealtimeMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
});

export const SOURCES_REALTIME_TOPICS = ["changed"] as const;
export const SOURCES_REALTIME_CHANGED_TOPIC = SOURCES_REALTIME_TOPICS[0];

export function getSourcesRealtimeChannelName(workspaceId: string) {
  return `sources:${workspaceId}` as const;
}

export const sourcesChangedRealtimeMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
});
