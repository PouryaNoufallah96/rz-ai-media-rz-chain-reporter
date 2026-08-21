import {
  DURABLE_EVENT_SCHEMA_VERSION,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  mediaUploadConfirmedPayloadSchema,
  OPERATION_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME,
  operationGenerationRequestedPayloadSchema,
  operationScheduledEffectRequestedPayloadSchema,
  STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME,
  storageReconciliationRequestedPayloadSchema,
} from "@rz-chain-reporter/contracts";
import { eventType } from "inngest";

const eventVersion = String(DURABLE_EVENT_SCHEMA_VERSION);

export const durableEvents = {
  mediaUploadConfirmed: eventType(MEDIA_UPLOAD_CONFIRMED_EVENT_NAME, {
    schema: mediaUploadConfirmedPayloadSchema,
    version: eventVersion,
  }),
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

export function createInngestEvent(outbox: OutboxEvent) {
  assertSchemaVersion(outbox.schemaVersion);
  const eventId = `outbox:${outbox.eventType}:${outbox.id}`;

  switch (outbox.eventType) {
    case OPERATION_GENERATION_REQUESTED_EVENT_NAME: {
      const payload = operationGenerationRequestedPayloadSchema.safeParse(
        outbox.payload,
      );
      if (!payload.success) {
        throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
      }
      return durableEvents.operationGenerationRequested.create(payload.data, {
        id: eventId,
      });
    }
    case OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME: {
      const payload = operationScheduledEffectRequestedPayloadSchema.safeParse(
        outbox.payload,
      );
      if (!payload.success) {
        throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
      }
      return durableEvents.operationScheduledEffectRequested.create(
        payload.data,
        {
          id: eventId,
        },
      );
    }
    case MEDIA_UPLOAD_CONFIRMED_EVENT_NAME: {
      const payload = mediaUploadConfirmedPayloadSchema.safeParse(
        outbox.payload,
      );
      if (!payload.success) {
        throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
      }
      return durableEvents.mediaUploadConfirmed.create(payload.data, {
        id: eventId,
      });
    }
    case STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME: {
      const payload = storageReconciliationRequestedPayloadSchema.safeParse(
        outbox.payload,
      );
      if (!payload.success) {
        throw new OutboxEventContractError("OUTBOX_PAYLOAD_INVALID");
      }
      return durableEvents.storageReconciliationRequested.create(payload.data, {
        id: eventId,
      });
    }
    default:
      throw new OutboxEventContractError("OUTBOX_EVENT_TYPE_UNSUPPORTED");
  }
}
