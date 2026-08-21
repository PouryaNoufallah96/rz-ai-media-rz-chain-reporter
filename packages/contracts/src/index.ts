import { z } from "zod";

export const OPERATION_LIFECYCLES = [
  "queued",
  "running",
  "settling",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type OperationLifecycle = (typeof OPERATION_LIFECYCLES)[number];

export const operationLifecycleSchema = z.enum(OPERATION_LIFECYCLES);

export const ATTEMPT_OUTCOMES = [
  "succeeded",
  "failed_retryable",
  "failed_terminal",
  "ambiguous",
] as const;

export type AttemptOutcome = (typeof ATTEMPT_OUTCOMES)[number];

export const attemptOutcomeSchema = z.enum(ATTEMPT_OUTCOMES);

export const DISPATCH_STATES = [
  "undispatched",
  "delayed",
  "dispatched",
  "exhausted",
] as const;

export type DispatchState = (typeof DISPATCH_STATES)[number];

export const dispatchStateSchema = z.enum(DISPATCH_STATES);

export const INVOCATION_KEYS = ["primary", "retry-1", "fallback"] as const;

export type InvocationKey = (typeof INVOCATION_KEYS)[number];

export const invocationKeySchema = z.enum(INVOCATION_KEYS);

export const MODEL_BACKENDS = ["remote", "local"] as const;

export type ModelBackend = (typeof MODEL_BACKENDS)[number];

export const modelBackendSchema = z.enum(MODEL_BACKENDS);

export const USAGE_API_KINDS = ["chat", "embedding", "image"] as const;

export type UsageApiKind = (typeof USAGE_API_KINDS)[number];

export const usageApiKindSchema = z.enum(USAGE_API_KINDS);

export const USAGE_PROVIDER_GATEWAYS = ["openrouter", "ollama"] as const;

export type UsageProviderGateway = (typeof USAGE_PROVIDER_GATEWAYS)[number];

export const usageProviderGatewaySchema = z.enum(USAGE_PROVIDER_GATEWAYS);

export const USAGE_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const usageStatusSchema = z.enum(USAGE_STATUSES);

export const USAGE_COST_AUTHORITIES = [
  "billed_openrouter",
  "estimated_openrouter",
  "local",
  "unknown",
] as const;

export type UsageCostAuthority = (typeof USAGE_COST_AUTHORITIES)[number];

export const usageCostAuthoritySchema = z.enum(USAGE_COST_AUTHORITIES);

export const USAGE_SOURCES = ["inline", "generation_reconciled"] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

export const usageSourceSchema = z.enum(USAGE_SOURCES);

export const MEDIA_ASSET_LIFECYCLES = [
  "pending",
  "uploaded",
  "validating",
  "verified",
  "rejected",
  "expired",
] as const;

export type MediaAssetLifecycle = (typeof MEDIA_ASSET_LIFECYCLES)[number];

export const mediaAssetLifecycleSchema = z.enum(MEDIA_ASSET_LIFECYCLES);

export const SCHEDULE_STATUSES = [
  "scheduled",
  "cancelled",
  "completed",
] as const;

export type ScheduleStatus = (typeof SCHEDULE_STATUSES)[number];

export const scheduleStatusSchema = z.enum(SCHEDULE_STATUSES);

export const PLATFORMS = ["x", "telegram", "instagram"] as const;

export type Platform = (typeof PLATFORMS)[number];

export const platformSchema = z.enum(PLATFORMS);

export const SOURCE_ORIGINS = ["rss", "telegram_public"] as const;

export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];

export const sourceOriginSchema = z.enum(SOURCE_ORIGINS);

export const ERROR_CODES = [
  "OPERATION_REPLAYED",
  "IDEMPOTENCY_KEY_REUSED",
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "VERSION_CONFLICT",
  "SAVED_CARD_ALREADY_ACTIVE",
  "TRANSIENT_CONFLICT",
  "TEMPLATE_DRIFT",
  "MODEL_INVOCATION_FAILED",
  "STRUCTURED_OUTPUT_INVALID",
  "OBJECT_STORE_UNBOUND",
  "MEDIA_REJECTED",
  "INTERNAL_SERVER_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

export const DURABLE_EVENT_SCHEMA_VERSION = 1;

export const DURABLE_EVENT_NAMES = [
  "operation/generation.requested",
  "operation/scheduled-effect.requested",
  "media/upload.confirmed",
  "storage/reconciliation.requested",
] as const;

export const OPERATION_GENERATION_REQUESTED_EVENT_NAME = DURABLE_EVENT_NAMES[0];
export const OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME =
  DURABLE_EVENT_NAMES[1];
export const MEDIA_UPLOAD_CONFIRMED_EVENT_NAME = DURABLE_EVENT_NAMES[2];
export const STORAGE_RECONCILIATION_REQUESTED_EVENT_NAME =
  DURABLE_EVENT_NAMES[3];

export type DurableEventName = (typeof DURABLE_EVENT_NAMES)[number];

export const durableEventNameSchema = z.enum(DURABLE_EVENT_NAMES);

export const GENERATION_PROBE_COMMAND_PREFIX = "generation-probe:";
export const SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX = "scheduled-effect-probe:";

export const OPERATION_COMMAND_KINDS = [
  "generation-probe",
  "scheduled-effect-probe",
  "media-verification",
  "other",
] as const;

export type OperationCommandKind = (typeof OPERATION_COMMAND_KINDS)[number];

export function operationCommandKind(
  commandType: string,
): OperationCommandKind {
  if (commandType.startsWith(GENERATION_PROBE_COMMAND_PREFIX)) {
    return "generation-probe";
  }
  if (commandType.startsWith(SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX)) {
    return "scheduled-effect-probe";
  }
  if (commandType === MEDIA_UPLOAD_CONFIRMED_EVENT_NAME) {
    return "media-verification";
  }
  return "other";
}

export function operationCommandVariant(commandType: string, prefix: string) {
  return commandType.startsWith(prefix)
    ? commandType.slice(prefix.length)
    : null;
}

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

export const OPERATIONS_REALTIME_CHANNEL_PREFIX = "operations:";
export const OPERATIONS_REALTIME_TOPICS = ["status"] as const;
export const OPERATIONS_REALTIME_STATUS_TOPIC = OPERATIONS_REALTIME_TOPICS[0];

export type OperationsRealtimeTopic =
  (typeof OPERATIONS_REALTIME_TOPICS)[number];

export const operationsRealtimeTopicSchema = z.enum(OPERATIONS_REALTIME_TOPICS);

export function getOperationsRealtimeChannelName(workspaceId: string) {
  return `${OPERATIONS_REALTIME_CHANNEL_PREFIX}${workspaceId}` as const;
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

export const okSchema = z.object({ ok: z.literal(true) });

const MAX_PAGE = 10_000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 200;

const sortDirectionSchema = z.enum(["asc", "desc"], {
  error: "orderByInvalid",
});

export function createListInput<
  const TColumns extends readonly [string, ...string[]],
>(orderableColumns: TColumns) {
  return z.object({
    orderBy: z.tuple(
      [
        z.enum(orderableColumns, { error: "orderByInvalid" }),
        sortDirectionSchema,
      ],
      { error: "orderByInvalid" },
    ),
    page: z
      .int({ error: "pageInvalid" })
      .min(1, { error: "pageOutOfRange" })
      .max(MAX_PAGE, { error: "pageOutOfRange" }),
    perPage: z
      .int({ error: "perPageInvalid" })
      .min(1, { error: "perPageOutOfRange" })
      .max(MAX_PAGE_SIZE, { error: "perPageOutOfRange" }),
    search: z
      .string()
      .max(MAX_SEARCH_LENGTH, { error: "searchTooLong" })
      .nullable(),
  });
}

export function createListOutput<TItem extends z.ZodType>(item: TItem) {
  return z.object({
    items: z.array(item),
    page: z.int(),
    perPage: z.int(),
    total: z.int(),
  });
}

export function createOrderedListOutput<TItem extends z.ZodType>(item: TItem) {
  return createListOutput(item).extend({ orderedIds: z.array(z.uuid()) });
}

export const idSchema = z.object({ id: z.uuid({ error: "idInvalid" }) });

export type IdInput = z.infer<typeof idSchema>;

export const setActiveSchema = idSchema.extend({
  active: z.boolean({ error: "activeInvalid" }),
});

export type SetActiveInput = z.infer<typeof setActiveSchema>;

const MAX_REORDERED_IDS = 500;

export const reorderSchema = z.object({
  orderedIds: z
    .array(z.uuid({ error: "idInvalid" }), { error: "orderedIdsInvalid" })
    .min(1, { error: "orderedIdsEmpty" })
    .max(MAX_REORDERED_IDS, { error: "orderedIdsTooMany" }),
});

export type ReorderInput = z.infer<typeof reorderSchema>;
