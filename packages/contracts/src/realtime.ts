import { z } from "zod";

import { attemptOutcomeSchema, operationLifecycleSchema } from "./operation";

export const OPERATIONS_REALTIME_TOPICS = ["status", "changed"] as const;
export const OPERATIONS_REALTIME_STATUS_TOPIC = OPERATIONS_REALTIME_TOPICS[0];
export const OPERATIONS_REALTIME_CHANGED_TOPIC = OPERATIONS_REALTIME_TOPICS[1];

export function getOperationsRealtimeChannelName(workspaceId: string) {
  return `operations:${workspaceId}` as const;
}

// The channel is workspace-wide, so every message carries the audience it is
// for: its own operator, or everyone when the work is a shared source import.
export const operationStatusRealtimeMessageSchema = z.strictObject({
  operationId: z.uuid(),
  actorId: z.string(),
  sharedImport: z.boolean(),
  lifecycle: operationLifecycleSchema,
  operationVersion: z.int().positive(),
  attemptCount: z.int().nonnegative().optional(),
  latestAttemptOutcome: attemptOutcomeSchema.optional(),
});

export type OperationStatusRealtimeMessage = z.infer<
  typeof operationStatusRealtimeMessageSchema
>;

export const operationsChangedRealtimeMessageSchema = z.strictObject({
  actorId: z.string(),
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  sharedImport: z.boolean(),
});

export type OperationsChangedRealtimeMessage = z.infer<
  typeof operationsChangedRealtimeMessageSchema
>;

const PUBLISHING_REALTIME_TOPICS = ["changed"] as const;
export const PUBLISHING_REALTIME_CHANGED_TOPIC = PUBLISHING_REALTIME_TOPICS[0];

export function getPublishingRealtimeChannelName(
  workspaceId: string,
  actorId: string,
) {
  return `publishing:${workspaceId}:${actorId}` as const;
}

export const publishingChangedRealtimeMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  operationId: z.uuid(),
  publicationId: z.uuid(),
  scheduleId: z.uuid().nullable(),
});

export type PublishingChangedRealtimeMessage = z.infer<
  typeof publishingChangedRealtimeMessageSchema
>;

export const USAGE_REALTIME_TOPICS = ["ledger"] as const;
export const USAGE_REALTIME_LEDGER_TOPIC = USAGE_REALTIME_TOPICS[0];

// Every usage row is owned by the operator who ran the work, so the ping is
// addressed to that operator instead of the whole installation.
export function getUsageRealtimeChannelName(
  workspaceId: string,
  actorId: string,
) {
  return `usage:${workspaceId}:${actorId}` as const;
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

const EDITORIAL_REALTIME_TOPICS = ["changed"] as const;
export const EDITORIAL_REALTIME_CHANGED_TOPIC = EDITORIAL_REALTIME_TOPICS[0];

export function getEditorialRealtimeChannelName(
  workspaceId: string,
  analysisRunId: string,
) {
  return `editorial:${workspaceId}:${analysisRunId}` as const;
}

// The run id repeats the channel scope so the island can drop a ping that
// arrives on a socket which has not torn down yet.
export const editorialChangedRealtimeMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  analysisRunId: z.uuid(),
});

export const DRAFTS_REALTIME_TOPICS = ["changed"] as const;
export const DRAFTS_REALTIME_CHANGED_TOPIC = DRAFTS_REALTIME_TOPICS[0];

export function getDraftsRealtimeChannelName(
  workspaceId: string,
  analysisRunId: string,
) {
  return `drafts:${workspaceId}:${analysisRunId}` as const;
}

export const DRAFT_CHANGE_CODES = [
  "queued",
  "running",
  "unit_succeeded",
  "unit_failed",
  "unit_cancelled",
  "partial",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
  "dispatch_exhausted",
  "rearmed",
] as const;

export const draftChangeCodeSchema = z.enum(DRAFT_CHANGE_CODES);

export const draftsChangedRealtimeMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  occurredAt: z.iso.datetime(),
  analysisRunId: z.uuid(),
  platformDraftId: z.uuid(),
  operationId: z.uuid(),
  code: draftChangeCodeSchema,
});

export type DraftsChangedRealtimeMessage = z.infer<
  typeof draftsChangedRealtimeMessageSchema
>;
