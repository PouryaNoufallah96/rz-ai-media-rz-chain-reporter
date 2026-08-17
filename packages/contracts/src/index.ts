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
  "INTERNAL_SERVER_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export const errorCodeSchema = z.enum(ERROR_CODES);

export const okSchema = z.object({ ok: z.literal(true) });

const MAX_PAGE = 10_000;
const MAX_PAGE_SIZE = 100;
const MAX_SEARCH_LENGTH = 200;

const sortDirectionSchema = z.enum(["asc", "desc"], {
  error: "orderByInvalid",
});

// Page and page-size policy belongs to the surface that owns the URL. The wire
// only bounds what a client may ask for, so nothing here carries a default.
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

// The reorder pass renumbers under a per-workspace lock, so the submitted set
// is bounded at the contract rather than inside it.
const MAX_REORDERED_IDS = 500;

export const reorderSchema = z.object({
  orderedIds: z
    .array(z.uuid({ error: "idInvalid" }), { error: "orderedIdsInvalid" })
    .min(1, { error: "orderedIdsEmpty" })
    .max(MAX_REORDERED_IDS, { error: "orderedIdsTooMany" }),
});

export type ReorderInput = z.infer<typeof reorderSchema>;
