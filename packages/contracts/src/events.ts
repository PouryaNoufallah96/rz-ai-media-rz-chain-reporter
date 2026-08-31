import { z } from "zod";

export const DURABLE_EVENT_SCHEMA_VERSION = 1;

export const OPERATION_GENERATION_REQUESTED_EVENT_NAME =
  "operation/generation.requested";
export const OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME =
  "operation/scheduled-effect.requested";
export const MEDIA_UPLOAD_CONFIRMED_EVENT_NAME = "media/upload.confirmed";
export const STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME =
  "storage/reconciliation.requested";
export const OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME =
  "operation/source-import.requested";
export const OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME =
  "operation/analysis-run.requested";
export const OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME =
  "operation/analysis-run.cancelled";
export const OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME =
  "operation/copy-generation.requested";
export const OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME =
  "operation/image-generation.requested";
export const OPERATION_PUBLICATION_REQUESTED_EVENT_NAME =
  "operation/publication.requested";
export const OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME =
  "operation/publication-reconciliation.requested";
export const SOURCE_IMPORT_ENRICHMENT_REQUESTED_EVENT_NAME =
  "source-import/enrichment.requested";
export const OPERATION_SOURCE_IMPORT_READY_EVENT_NAME =
  "operation/source-import.ready";
export const OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME =
  "operation/presentation-translation.requested";
export const OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME =
  "operation/copy-variant-translation.requested";

export const DURABLE_EVENT_NAMES = [
  OPERATION_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME,
  OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
  OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
  OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
  OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
  SOURCE_IMPORT_ENRICHMENT_REQUESTED_EVENT_NAME,
  OPERATION_SOURCE_IMPORT_READY_EVENT_NAME,
  OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
] as const;

export type DurableEventName = (typeof DURABLE_EVENT_NAMES)[number];

export const durableEventNameSchema = z.enum(DURABLE_EVENT_NAMES);

export const GENERATION_PROBE_COMMAND_PREFIX = "generation-probe:";
export const SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX = "scheduled-effect-probe:";
export const SOURCE_IMPORT_COMMAND_PREFIX = "source-import:";
export const ANALYSIS_RUN_COMMAND_PREFIX = "analysis-run:";
export const COPY_GENERATION_COMMAND_PREFIX = "copy-generation:";
export const IMAGE_GENERATION_COMMAND_PREFIX = "image-generation:";
export const PRESENTATION_TRANSLATION_COMMAND_TYPE = "presentation-translation";
export const COPY_VARIANT_TRANSLATION_COMMAND_TYPE = "copy-variant-translation";

export const ASSISTANT_SYNTHESIS_COMMAND_TYPE = "assistant-synthesis";

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

export const sourceImportEnrichmentRequestedPayloadSchema =
  durableEventPayloadSchema.extend({
    operationAttemptId: z.uuid(),
    operationId: z.uuid(),
    sourceItemRevisionId: z.uuid(),
  });

export const operationSourceImportReadyPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const analysisRunRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const analysisRunCancelledPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const copyGenerationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const imageGenerationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({
    imageGenerationId: z.uuid(),
    operationId: z.uuid(),
  });

export const presentationTranslationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const copyVariantTranslationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({ operationId: z.uuid() });

export const publicationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({
    operationId: z.uuid(),
    publicationId: z.uuid(),
    scheduleId: z.uuid().optional(),
  });

export const publicationReconciliationRequestedPayloadSchema =
  durableEventPayloadSchema.extend({
    operationId: z.uuid(),
    publicationId: z.uuid(),
    ambiguousAttemptId: z.uuid(),
  });
