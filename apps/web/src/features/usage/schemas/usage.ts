import {
  invocationKeySchema,
  MODEL_BACKENDS,
  modelBackendSchema,
  USAGE_STATUSES,
  usageCostAuthoritySchema,
  usageStatusSchema,
} from "@rz-chain-reporter/contracts";
import {
  createLoader,
  type inferParserType,
  type Nullable,
  parseAsString,
  parseAsStringLiteral,
  type SearchParams,
} from "nuqs/server";
import { z } from "zod";

import { keysetCursorParam } from "@/features/shared/lib/keyset-cursor";

import { USAGE_PERIODS, USAGE_PROVIDERS } from "../constants";

const optionalFilterSchema = z.string().trim().min(1).max(200).nullable();

export const usageSearchParsers = {
  period: parseAsStringLiteral(USAGE_PERIODS).withDefault("7d"),
  model: parseAsString,
  backend: parseAsStringLiteral(MODEL_BACKENDS),
  provider: parseAsStringLiteral(USAGE_PROVIDERS),
  task: parseAsString,
  status: parseAsStringLiteral(USAGE_STATUSES),
  cursor: parseAsString,
};

export const loadUsageSearchParams = createLoader(usageSearchParsers);
export type UsageSearchParams = Promise<SearchParams>;

export type UsageSearchPatch = Partial<
  Nullable<inferParserType<typeof usageSearchParsers>>
>;

export const usageQuerySchema = z.object({
  period: z.enum(USAGE_PERIODS),
  model: optionalFilterSchema,
  backend: modelBackendSchema.nullable(),
  provider: z.enum(USAGE_PROVIDERS).nullable(),
  task: optionalFilterSchema,
  status: usageStatusSchema.nullable(),
  cursor: keysetCursorParam,
});

export type UsageQuery = z.infer<typeof usageQuerySchema>;

export function normalizeUsageQuery(
  input: Awaited<ReturnType<typeof loadUsageSearchParams>>,
): UsageQuery {
  return usageQuerySchema.parse({
    ...input,
    model: normalizeTextFilter(input.model),
    task: normalizeTextFilter(input.task),
  });
}

function normalizeTextFilter(value: string | null) {
  if (value === null) return null;
  const normalized = value.trim().replace(/\s+/gu, " ").slice(0, 200);
  return normalized === "" ? null : normalized;
}

export const usageRowSchema = z.object({
  id: z.uuid(),
  occurredAt: z.date(),
  taskKey: z.string(),
  invocationKey: invocationKeySchema,
  backend: modelBackendSchema,
  provider: z.enum(USAGE_PROVIDERS),
  requestedModel: z.string(),
  resolvedModel: z.string().nullable(),
  promptTokens: z.number().int().nonnegative().nullable(),
  completionTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
  cost: z.string().nullable(),
  costAuthority: usageCostAuthoritySchema,
  status: usageStatusSchema,
});

export type UsageRow = z.infer<typeof usageRowSchema>;

export const usagePageSchema = z.object({
  rows: z.array(usageRowSchema),
  olderCursor: z.string().nullable(),
  newerCursor: z.string().nullable(),
  offLatest: z.boolean(),
});

export type UsagePage = z.infer<typeof usagePageSchema>;

export const usageSummarySchema = z.object({
  recordedInvocations: z.number().int().nonnegative(),
  invocations: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  recordedCost: z.string(),
  pendingCount: z.number().int().nonnegative(),
  unknownCount: z.number().int().nonnegative(),
  models: z.array(
    z.object({
      model: z.string(),
      backend: modelBackendSchema,
      invocations: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
      recordedCost: z.string(),
    }),
  ),
});

export type UsageSummary = z.infer<typeof usageSummarySchema>;
