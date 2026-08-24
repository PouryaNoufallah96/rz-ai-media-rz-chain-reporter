import { z } from "zod";

export const DURABLE_EVENT_SCHEMA_VERSION = 1;

export const DURABLE_EVENT_NAMES = [
  "operation/generation.requested",
  "operation/scheduled-effect.requested",
  "media/upload.confirmed",
  "storage/reconciliation.requested",
  "operation/source-import.requested",
  "operation/analysis-run.requested",
  "operation/analysis-run.cancelled",
] as const;

export const OPERATION_GENERATION_REQUESTED_EVENT_NAME = DURABLE_EVENT_NAMES[0];
export const OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME =
  DURABLE_EVENT_NAMES[1];
export const MEDIA_UPLOAD_CONFIRMED_EVENT_NAME = DURABLE_EVENT_NAMES[2];
export const STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME =
  DURABLE_EVENT_NAMES[3];
export const OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME =
  DURABLE_EVENT_NAMES[4];
export const OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME =
  DURABLE_EVENT_NAMES[5];
export const OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME =
  DURABLE_EVENT_NAMES[6];

export type DurableEventName = (typeof DURABLE_EVENT_NAMES)[number];

export const durableEventNameSchema = z.enum(DURABLE_EVENT_NAMES);

export const GENERATION_PROBE_COMMAND_PREFIX = "generation-probe:";
export const SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX = "scheduled-effect-probe:";
export const SOURCE_IMPORT_COMMAND_PREFIX = "source-import:";
export const ANALYSIS_RUN_COMMAND_PREFIX = "analysis-run:";

const durableEventPayloadSchema = z.strictObject({
  schemaVersion: z.literal(DURABLE_EVENT_SCHEMA_VERSION),
  workspaceId: z.uuid(),
});

export const operationGenerationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const operationScheduledEffectRequestedPayloadSchema =
  durableEventPayloadSchema.extend({
    operationId: z.uuid(),
    scheduleId: z.uuid(),
  });

export const mediaUploadConfirmedPayloadSchema =
  durableEventPayloadSchema.extend({
    mediaAssetId: z.uuid(),
    operationId: z.uuid(),
  });

export const MAX_RECONCILIATION_CURSOR_LENGTH = 512;

export const storageReconciliationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({
    cursor: z.string().min(1).max(MAX_RECONCILIATION_CURSOR_LENGTH).optional(),
  });

export const operationSourceImportRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const analysisRunRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const analysisRunCancelledPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });
