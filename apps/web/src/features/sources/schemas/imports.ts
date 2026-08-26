import {
  admissionOutcomeSchema,
  articleAdapterSchema,
  dispatchStateSchema,
  errorCodeSchema,
  operationLifecycleSchema,
  sourceFetchOutcomeSchema,
  sourceFetchReasonSchema,
  sourceImportStageSchema,
  sourceOriginSchema,
  telegramOrderingModeSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

import {
  IMPORT_WINDOW_HOURS,
  MAX_TOP_N,
  MAX_TOPIC_LENGTH,
  MAX_TOPICS,
} from "../constants";

export const startSourceImportInputSchema = z.object({
  sourceIds: z.array(z.uuid()).min(1, { error: "NO_SOURCES" }).max(200),
  windowHours: z.literal(IMPORT_WINDOW_HOURS),
  orderingMode: telegramOrderingModeSchema,
  topN: z.int().min(1).max(MAX_TOP_N),
  topics: z
    .array(z.string().trim().min(1).max(MAX_TOPIC_LENGTH))
    .max(MAX_TOPICS),
  enrichmentEnabled: z.boolean(),
});

export const startSourceImportResultSchema = z.object({
  operationId: z.uuid(),
});

const sourceImportCountsSchema = z.object({
  acquired: z.int().nonnegative(),
  ordered: z.int().nonnegative(),
  enriched: z.int().nonnegative(),
  skipped: z.int().nonnegative(),
  failed: z.int().nonnegative(),
});

const admissionMixBucketSchema = z.object({
  admission: admissionOutcomeSchema,
  count: z.int().positive(),
});

const adapterMixBucketSchema = z.object({
  adapter: articleAdapterSchema,
  count: z.int().positive(),
  reused: z.int().nonnegative(),
});

const sourceImportSourceLineSchema = z.object({
  sourceId: z.uuid(),
  name: z.string(),
  origin: sourceOriginSchema,
  outcome: sourceFetchOutcomeSchema,
  reason: sourceFetchReasonSchema.nullable(),
  fetchedCount: z.int().nonnegative(),
  admittedCount: z.int().nonnegative(),
  settledAt: z.date().nullable(),
  enrichment: z
    .object({
      enriched: z.int().nonnegative(),
      skipped: z.int().nonnegative(),
      failed: z.int().nonnegative(),
      unknown: z.int().nonnegative(),
    })
    .nullable(),
  adapterMix: z.array(adapterMixBucketSchema),
});

export type SourceImportSourceLine = z.infer<
  typeof sourceImportSourceLineSchema
>;

const sourceImportCardSchema = z.object({
  id: z.uuid(),
  operationId: z.uuid(),
  lifecycle: operationLifecycleSchema,
  createdAt: z.date(),
  stage: sourceImportStageSchema,
  partial: z.boolean(),
  counts: sourceImportCountsSchema,
  admissionMix: z.array(admissionMixBucketSchema),
  adapterMix: z.array(adapterMixBucketSchema),
  unitsPlanned: z.int().nonnegative(),
  failureCode: errorCodeSchema.nullable(),
  windowHours: z.int().positive(),
  orderingMode: telegramOrderingModeSchema,
  topN: z.int().positive(),
  topics: z.array(z.string()),
  enrichmentEnabled: z.boolean(),
  templateFingerprint: z.string(),
  embeddingModel: z.string().nullable(),
  embeddingDimension: z.int().positive().nullable(),
  dispatch: z
    .object({ state: dispatchStateSchema, nextAttemptAt: z.date() })
    .nullable(),
  sources: z.array(sourceImportSourceLineSchema),
});

export type SourceImportCard = z.infer<typeof sourceImportCardSchema>;

const sourceImportDefaultsSchema = z.object({
  windowHours: z.literal(IMPORT_WINDOW_HOURS),
  orderingMode: telegramOrderingModeSchema,
  topN: z.int().min(1).max(MAX_TOP_N),
  enrichmentEnabled: z.boolean(),
});

export type SourceImportDefaults = z.infer<typeof sourceImportDefaultsSchema>;

const sourceImportsViewSchema = z.object({
  cards: z.array(sourceImportCardSchema),
  recentTopics: z.array(z.string()),
  defaults: sourceImportDefaultsSchema,
  readAt: z.date(),
});

export type SourceImportsView = z.infer<typeof sourceImportsViewSchema>;
