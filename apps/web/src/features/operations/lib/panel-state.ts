import {
  type ErrorCode,
  operationCommandKind,
  type PublicationFailureCode,
} from "@rz-chain-reporter/contracts";

import type { StateMarkState } from "@/components/common/state-mark";
import { partialImportStateOf } from "@/features/sources/lib/import-outcome";

import type { OperationSummary } from "../schemas/operation-summary";

export const OPERATION_ERROR_KEYS = {
  FORBIDDEN: "errors.forbidden",
  IDEMPOTENCY_KEY_REUSED: "errors.idempotencyKeyReused",
  INTERNAL_SERVER_ERROR: "errors.internalServerError",
  IMAGE_SOURCE_EXTRACT_REQUIRED: "errors.imageSourceExtractRequired",
  MEDIA_REJECTED: "errors.mediaRejected",
  MODEL_INVOCATION_FAILED: "errors.modelInvocationFailed",
  NOT_FOUND: "errors.notFound",
  OBJECT_STORE_UNBOUND: "errors.objectStoreUnbound",
  OPERATION_REPLAYED: "errors.operationReplayed",
  SAVED_CARD_ALREADY_ACTIVE: "errors.savedCardAlreadyActive",
  SOURCE_IMPORT_IN_PROGRESS: "errors.sourceImportInProgress",
  STRUCTURED_OUTPUT_INVALID: "errors.structuredOutputInvalid",
  TEMPLATE_DRIFT: "errors.templateDrift",
  TRANSIENT_CONFLICT: "errors.transientConflict",
  UNAUTHORIZED: "errors.unauthorized",
  VALIDATION_FAILED: "errors.validationFailed",
  VERSION_CONFLICT: "errors.versionConflict",
} as const satisfies Record<ErrorCode, string>;

const PUBLICATION_FAILURE_KEYS = {
  DELIVERY_DEFINITELY_FAILED: "errors.deliveryDefinitelyFailed",
  DELIVERY_UNKNOWN: "errors.deliveryUnknown",
  INSTAGRAM_AUTH_FAILED: "errors.providerAuthFailed",
  INSTAGRAM_CAPABILITY_UNAVAILABLE: "errors.providerCapabilityUnavailable",
  INSTAGRAM_CAPACITY_UNAVAILABLE: "errors.instagramCapacityUnavailable",
  INSTAGRAM_CONTAINER_EXPIRED: "errors.instagramContainerExpired",
  INSTAGRAM_CONTAINER_FAILED: "errors.instagramContainerFailed",
  INSTAGRAM_CONTAINER_PREPARATION_UNKNOWN: "errors.instagramProcessingUnknown",
  INSTAGRAM_CONTAINER_PROCESSING_DELAYED: "errors.instagramProcessingUnknown",
  INSTAGRAM_CONTAINER_STATUS_UNKNOWN: "errors.instagramProcessingUnknown",
  INSTAGRAM_DELIVERY_UNKNOWN: "errors.deliveryUnknown",
  INSTAGRAM_RATE_LIMITED: "errors.providerRateLimited",
  INSTAGRAM_REQUEST_INVALID: "errors.providerRequestInvalid",
  MEDIA_NOT_PUBLISHABLE: "errors.mediaNotPublishable",
  PROVIDER_AUTH_FAILED: "errors.providerAuthFailed",
  PROVIDER_CAPABILITY_UNAVAILABLE: "errors.providerCapabilityUnavailable",
  PROVIDER_RATE_DEFERRED: "errors.providerRateLimited",
  PUBLISH_PAYLOAD_TOO_LONG: "errors.publishPayloadTooLong",
  TELEGRAM_AUTH_FAILED: "errors.providerAuthFailed",
  TELEGRAM_CHANNEL_MIGRATED: "errors.telegramChannelMigrated",
  TELEGRAM_DELIVERY_UNKNOWN: "errors.deliveryUnknown",
  TELEGRAM_POSTING_FORBIDDEN: "errors.telegramPostingForbidden",
  TELEGRAM_RATE_LIMITED: "errors.providerRateLimited",
  TELEGRAM_REQUEST_INVALID: "errors.providerRequestInvalid",
  X_AUTH_FAILED: "errors.providerAuthFailed",
  X_CAPABILITY_UNAVAILABLE: "errors.providerCapabilityUnavailable",
  X_DELIVERY_UNKNOWN: "errors.deliveryUnknown",
  X_MEDIA_PREPARATION_UNKNOWN: "errors.xMediaPreparationUnknown",
  X_RATE_LIMITED: "errors.providerRateLimited",
  X_REQUEST_INVALID: "errors.providerRequestInvalid",
} as const satisfies Record<PublicationFailureCode, string>;

export const OPERATION_FAILURE_KEYS = {
  ...OPERATION_ERROR_KEYS,
  ...PUBLICATION_FAILURE_KEYS,
} as const satisfies Record<ErrorCode | PublicationFailureCode, string>;

export type PanelState = StateMarkState;

export type EdgeTone = "failed" | "partial" | "queued" | "running";

export function panelStateOf(operation: OperationSummary): PanelState {
  if (
    operation.lifecycle === "running" &&
    operationCommandKind(operation.commandType) === "scheduled-effect-probe" &&
    operation.effectiveAt > operation.updatedAt
  ) {
    return "waiting";
  }

  if (operation.lifecycle === "settling") {
    return "running";
  }

  if (operation.sourceImport?.partial && operation.lifecycle === "succeeded") {
    return partialImportStateOf(operation.sourceImport);
  }

  if (
    operation.latestAttemptOutcome === "failed_retryable" &&
    (operation.lifecycle === "queued" || operation.lifecycle === "running")
  ) {
    return "retrying";
  }

  return operation.lifecycle;
}

export function edgeToneOf(
  states: readonly PanelState[],
): EdgeTone | undefined {
  const hasWorking = states.some((state) =>
    ["running", "retrying", "unknown"].includes(state),
  );

  if (states.includes("failed") && hasWorking) {
    return "partial";
  }

  if (states.includes("failed")) {
    return "failed";
  }

  if (states.includes("partial")) {
    return "partial";
  }

  if (states.includes("running") || states.includes("retrying")) {
    return "running";
  }

  if (states.includes("queued")) {
    return "queued";
  }

  return undefined;
}
