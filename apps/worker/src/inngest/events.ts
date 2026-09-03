import {
  analysisRunCancelledPayloadSchema,
  analysisRunRequestedPayloadSchema,
  copyGenerationRequestedPayloadSchema,
  copyVariantTranslationRequestedPayloadSchema,
  DURABLE_EVENT_SCHEMA_VERSION,
  imageGenerationRequestedPayloadSchema,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  marketCatalogRefreshRequestedPayloadSchema,
  marketChartRenderRequestedPayloadSchema,
  marketGenerationRequestedPayloadSchema,
  marketVerificationRequestedPayloadSchema,
  mediaUploadConfirmedPayloadSchema,
  OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
  OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
  OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
  OPERATION_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_CHART_RENDER_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
  OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
  OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME,
  OPERATION_SOURCE_IMPORT_READY_EVENT_NAME,
  OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
  operationGenerationRequestedPayloadSchema,
  operationScheduledEffectRequestedPayloadSchema,
  operationSourceImportReadyPayloadSchema,
  operationSourceImportRequestedPayloadSchema,
  presentationTranslationRequestedPayloadSchema,
  publicationReconciliationRequestedPayloadSchema,
  publicationRequestedPayloadSchema,
  SOURCE_IMPORT_ENRICHMENT_REQUESTED_EVENT_NAME,
  STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME,
  sourceImportEnrichmentRequestedPayloadSchema,
  storageReconciliationRequestedPayloadSchema,
} from "@rz-chain-reporter/contracts";
import { eventType } from "inngest";

const eventVersion = String(DURABLE_EVENT_SCHEMA_VERSION);

export const durableEvents = {
  mediaUploadConfirmed: eventType(MEDIA_UPLOAD_CONFIRMED_EVENT_NAME, {
    schema: mediaUploadConfirmedPayloadSchema,
    version: eventVersion,
  }),
  operationAnalysisRunCancelled: eventType(
    OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
    {
      schema: analysisRunCancelledPayloadSchema,
      version: eventVersion,
    },
  ),
  operationAnalysisRunRequested: eventType(
    OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
    {
      schema: analysisRunRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationCopyGenerationRequested: eventType(
    OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
    {
      schema: copyGenerationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationCopyVariantTranslationRequested: eventType(
    OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
    {
      schema: copyVariantTranslationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationImageGenerationRequested: eventType(
    OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
    {
      schema: imageGenerationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationMarketCatalogRefreshRequested: eventType(
    OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
    {
      schema: marketCatalogRefreshRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationMarketChartRenderRequested: eventType(
    OPERATION_MARKET_CHART_RENDER_REQUESTED_EVENT_NAME,
    { schema: marketChartRenderRequestedPayloadSchema, version: eventVersion },
  ),
  operationMarketGenerationRequested: eventType(
    OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
    { schema: marketGenerationRequestedPayloadSchema, version: eventVersion },
  ),
  operationMarketVerificationRequested: eventType(
    OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
    { schema: marketVerificationRequestedPayloadSchema, version: eventVersion },
  ),
  operationPresentationTranslationRequested: eventType(
    OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
    {
      schema: presentationTranslationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationPublicationRequested: eventType(
    OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
    {
      schema: publicationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationPublicationReconciliationRequested: eventType(
    OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
    {
      schema: publicationReconciliationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationGenerationRequested: eventType(
    OPERATION_GENERATION_REQUESTED_EVENT_NAME,
    {
      schema: operationGenerationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationScheduledEffectRequested: eventType(
    OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME,
    {
      schema: operationScheduledEffectRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  operationSourceImportRequested: eventType(
    OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
    {
      schema: operationSourceImportRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  sourceImportReady: eventType(OPERATION_SOURCE_IMPORT_READY_EVENT_NAME, {
    schema: operationSourceImportReadyPayloadSchema,
    version: eventVersion,
  }),
  sourceImportEnrichmentRequested: eventType(
    SOURCE_IMPORT_ENRICHMENT_REQUESTED_EVENT_NAME,
    {
      schema: sourceImportEnrichmentRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
  storageReconciliationRequested: eventType(
    STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME,
    {
      schema: storageReconciliationRequestedPayloadSchema,
      version: eventVersion,
    },
  ),
};

type OutboxEvent = {
  eventType: string;
  id: string;
  payload: unknown;
  schemaVersion: number;
};

export class OutboxEventContractError extends Error {
  readonly code:
    | "OUTBOX_EVENT_TYPE_UNSUPPORTED"
    | "OUTBOX_PAYLOAD_INVALID"
    | "OUTBOX_SCHEMA_VERSION_UNSUPPORTED";

  constructor(code: OutboxEventContractError["code"]) {
    super(code);
    this.name = "OutboxEventContractError";
    this.code = code;
  }
}

function assertSchemaVersion(schemaVersion: number) {
  if (schemaVersion !== DURABLE_EVENT_SCHEMA_VERSION) {
    throw new OutboxEventContractError("OUTBOX_SCHEMA_VERSION_UNSUPPORTED");
  }
}

type RelayedEventCreator = (
  payload: unknown,
  id: string,
) => ReturnType<(typeof durableEvents)[keyof typeof durableEvents]["create"]>;

const relayedEventCreators: Record<string, RelayedEventCreator | undefined> = {
  [MEDIA_UPLOAD_CONFIRMED_EVENT_NAME]: (payload, id) => {
    const parsed = mediaUploadConfirmedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.mediaUploadConfirmed.create(parsed.data, { id });
  },
  [OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME]: (payload, id) => {
    const parsed = analysisRunCancelledPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationAnalysisRunCancelled.create(parsed.data, {
      id,
    });
  },
  [OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = analysisRunRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationAnalysisRunRequested.create(parsed.data, {
      id,
    });
  },
  [OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = copyGenerationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationCopyGenerationRequested.create(parsed.data, {
      id,
    });
  },
  [OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed =
      copyVariantTranslationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationCopyVariantTranslationRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_GENERATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = operationGenerationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationGenerationRequested.create(parsed.data, {
      id,
    });
  },
  [OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = imageGenerationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationImageGenerationRequested.create(parsed.data, {
      id,
    });
  },
  [OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed =
      marketCatalogRefreshRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success)
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    return durableEvents.operationMarketCatalogRefreshRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_MARKET_CHART_RENDER_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = marketChartRenderRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success)
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    return durableEvents.operationMarketChartRenderRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = marketGenerationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success)
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    return durableEvents.operationMarketGenerationRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = marketVerificationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success)
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    return durableEvents.operationMarketVerificationRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed =
      presentationTranslationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationPresentationTranslationRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME]: (
    payload,
    id,
  ) => {
    const parsed =
      publicationReconciliationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationPublicationReconciliationRequested.create(
      parsed.data,
      { id },
    );
  },
  [OPERATION_PUBLICATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed = publicationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationPublicationRequested.create(parsed.data, {
      id,
    });
  },
  [OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed =
      operationScheduledEffectRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationScheduledEffectRequested.create(parsed.data, {
      id,
    });
  },
  [OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed =
      operationSourceImportRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.operationSourceImportRequested.create(parsed.data, {
      id,
    });
  },
  [STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME]: (payload, id) => {
    const parsed =
      storageReconciliationRequestedPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
    }
    return durableEvents.storageReconciliationRequested.create(parsed.data, {
      id,
    });
  },
};

export function createInngestEvent(outbox: OutboxEvent) {
  assertSchemaVersion(outbox.schemaVersion);
  const create = relayedEventCreators[outbox.eventType];
  if (!create) {
    throw new OutboxEventContractError("OUTBOX_EVENT_TYPE_UNSUPPORTED");
  }
  return create(outbox.payload, `outbox:${outbox.eventType}:${outbox.id}`);
}
