import { z } from "zod";

import type { Platform } from "./platform";
import { telegramOrderingModeSchema } from "./source";

export const ANALYSIS_RUN_KINDS = ["news", "promo"] as const;

export type AnalysisRunKind = (typeof ANALYSIS_RUN_KINDS)[number];

export const ITEM_ELIGIBILITIES = [
  "candidate",
  "out_of_window",
  "undated",
  "duplicate",
] as const;

export type ItemEligibility = (typeof ITEM_ELIGIBILITIES)[number];

export const itemEligibilitySchema = z.enum(ITEM_ELIGIBILITIES);

export const FILTER_DISPOSITIONS = [
  "shortlisted",
  "telegram_lane",
  "no_media_fit",
  "low_score",
  "cap_exceeded",
] as const;

export type FilterDisposition = (typeof FILTER_DISPOSITIONS)[number];

export const filterDispositionSchema = z.enum(FILTER_DISPOSITIONS);

export const FILTERING_REASONS = [
  "missing_required_value_signal",
  "below_media_fit_threshold",
] as const;

export type FilteringReason = (typeof FILTERING_REASONS)[number];

export const filteringReasonSchema = z.enum(FILTERING_REASONS);

export const DUPLICATE_METHODS = [
  "canonical_url",
  "title",
  "semantic",
] as const;

export type DuplicateMethod = (typeof DUPLICATE_METHODS)[number];

export const duplicateMethodSchema = z.enum(DUPLICATE_METHODS);

export const SEMANTIC_STAGE_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "degraded",
  "skipped",
] as const;

export type SemanticStageStatus = (typeof SEMANTIC_STAGE_STATUSES)[number];

export const SEMANTIC_DEGRADED_REASONS = [
  "call_failed",
  "dimension_mismatch",
  "non_finite_value",
  "ambiguous_outcome",
  "bounds_exceeded",
] as const;

export type SemanticDegradedReason = (typeof SEMANTIC_DEGRADED_REASONS)[number];

export const SEMANTIC_PARTICIPATIONS = ["included", "outside_bound"] as const;

export type SemanticParticipation = (typeof SEMANTIC_PARTICIPATIONS)[number];

export const MODEL_UNIT_STATUSES = [
  "pending",
  "running",
  "succeeded",
  "failed",
  "cancelled",
] as const;

export type ModelUnitStatus = (typeof MODEL_UNIT_STATUSES)[number];

export const modelUnitStatusSchema = z.enum(MODEL_UNIT_STATUSES);

export const SOURCE_IMPORT_BINDINGS = [
  "started",
  "reused_in_flight",
  "reused_settled",
] as const;

export type SourceImportBinding = (typeof SOURCE_IMPORT_BINDINGS)[number];

export const ANALYSIS_RUN_WINDOW_HOURS = [6, 12, 24, 48] as const;

export type AnalysisRunWindowHours = (typeof ANALYSIS_RUN_WINDOW_HOURS)[number];

export const analysisRunWindowHoursSchema = z.literal(
  ANALYSIS_RUN_WINDOW_HOURS,
);

// Gateway capacity bound; the v3 template validator cannot import the worker.
export const MAX_EMBEDDING_VALUES = 400;

export type RunConfigurationBounds = {
  brandKeys: readonly string[];
  modelKeys: readonly string[];
  platforms: readonly Platform[];
  selectionCap: number;
  shortlistCap: number;
  promoPromptMaxChars: number;
  semanticMaxChars: number;
  semanticMaxTopics: number;
  fanOutMaxUnits: number;
};

export function runConfigurationSchema(bounds: RunConfigurationBounds) {
  const brandKey = z.enum(bounds.brandKeys);
  const modelKey = z.enum(bounds.modelKeys);

  const news = z.strictObject({
    kind: z.literal("news"),
    brands: z.array(brandKey).min(1),
    models: z.array(modelKey).min(1),
    platforms: z.array(z.enum(bounds.platforms)).min(1),
    sourceIds: z.array(z.uuid()).min(1).max(200),
    windowHours: analysisRunWindowHoursSchema,
    enrichmentEnabled: z.boolean(),
    telegramOnly: z.boolean(),
    orderingMode: telegramOrderingModeSchema,
    topN: z
      .int()
      .min(1)
      .max(bounds.selectionCap, { error: "TOP_N_EXCEEDS_CAP" }),
    topics: z
      .array(
        z
          .string()
          .trim()
          .min(1)
          .max(bounds.semanticMaxChars, { error: "TOPIC_TOO_LONG" }),
      )
      .max(bounds.semanticMaxTopics, { error: "TOO_MANY_TOPICS" }),
  });

  const promo = z.strictObject({
    kind: z.literal("promo"),
    models: z.array(modelKey).min(1),
    promo: z.strictObject({
      brands: z.array(brandKey).min(1, { error: "NO_PROMO_BRAND" }),
      prompts: z.partialRecord(
        brandKey,
        z
          .string()
          .trim()
          .min(1, { error: "PROMO_PROMPT_REQUIRED" })
          .max(bounds.promoPromptMaxChars, { error: "PROMO_PROMPT_TOO_LONG" }),
      ),
    }),
  });

  return z
    .discriminatedUnion("kind", [news, promo])
    .superRefine((configuration, ctx) => {
      const brandCount =
        configuration.kind === "news"
          ? configuration.brands.length
          : configuration.promo.brands.length;

      if (configuration.models.length * brandCount > bounds.fanOutMaxUnits) {
        ctx.addIssue({
          code: "custom",
          path: [],
          message: "FAN_OUT_EXCEEDS_MAX_UNITS",
        });
      }

      if (configuration.kind === "promo") {
        for (const brand of configuration.promo.brands) {
          if (configuration.promo.prompts[brand] === undefined) {
            ctx.addIssue({
              code: "custom",
              path: ["promo", "prompts", brand],
              message: "PROMO_PROMPT_REQUIRED",
            });
          }
        }
      }
    });
}

export type RunConfiguration = z.infer<
  ReturnType<typeof runConfigurationSchema>
>;
