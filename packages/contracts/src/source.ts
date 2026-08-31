import { z } from "zod";

export const CONTENT_LOCALES = ["en", "fa"] as const;

export type ContentLocale = (typeof CONTENT_LOCALES)[number];

export const contentLocaleSchema = z.enum(CONTENT_LOCALES);

export const effectiveTopicsSchema = z.strictObject({
  contentLocale: contentLocaleSchema,
  values: z.array(z.string()),
  usedOriginalFallback: z.boolean(),
});

export type EffectiveTopics = z.infer<typeof effectiveTopicsSchema>;

export const SOURCE_FETCH_OUTCOMES = [
  "pending",
  "succeeded",
  "not_modified",
  "partial",
  "skipped",
  "rejected",
  "blocked",
  "timed_out",
  "failed_retryable",
  "failed_terminal",
] as const;

export type SourceFetchOutcome = (typeof SOURCE_FETCH_OUTCOMES)[number];

export const sourceFetchOutcomeSchema = z.enum(SOURCE_FETCH_OUTCOMES);

export const SOURCE_FETCH_REASONS = [
  "empty_feed",
  "disabled_at_run_time",
  "parse_failure",
  "markup_drift",
  "missing_external_identity",
  "no_web_preview",
  "ssrf_blocked",
  "redirect_blocked",
  "unsupported_mime",
  "too_large",
  "deadline",
  "retry_after",
] as const;

export type SourceFetchReason = (typeof SOURCE_FETCH_REASONS)[number];

export const sourceFetchReasonSchema = z.enum(SOURCE_FETCH_REASONS);

export const ADMISSION_OUTCOMES = [
  "admitted",
  "skipped_language",
  "skipped_undated",
  "out_of_window",
  "over_cap",
] as const;

export type AdmissionOutcome = (typeof ADMISSION_OUTCOMES)[number];

export const admissionOutcomeSchema = z.enum(ADMISSION_OUTCOMES);

export const ENRICHMENT_OUTCOMES = [
  "pending",
  "succeeded",
  "skipped",
  "failed",
  "unknown",
] as const;

export type EnrichmentOutcome = (typeof ENRICHMENT_OUTCOMES)[number];

export const enrichmentOutcomeSchema = z.enum(ENRICHMENT_OUTCOMES);

export const ENRICHMENT_REASONS = [
  "off_origin",
  "deadline",
  "js_required",
  "anti_bot_challenge",
  "extraction_insufficient",
  "unsupported_mime",
  "too_large",
  "ssrf_blocked",
  "redirect_blocked",
  "fetch_failed",
  "brief_invalid",
] as const;

export type EnrichmentReason = (typeof ENRICHMENT_REASONS)[number];

export const enrichmentReasonSchema = z.enum(ENRICHMENT_REASONS);

export const sourceItemBriefSchema = z.object({ summary: z.string() });

export const ARTICLE_ADAPTERS = ["feed", "direct", "firecrawl"] as const;

export type ArticleAdapter = (typeof ARTICLE_ADAPTERS)[number];

export const articleAdapterSchema = z.enum(ARTICLE_ADAPTERS);

export const ARTICLE_FETCH_MODES = [
  "direct",
  "direct_then_firecrawl",
  "firecrawl",
] as const;

export type ArticleFetchMode = (typeof ARTICLE_FETCH_MODES)[number];

export const articleFetchModeSchema = z.enum(ARTICLE_FETCH_MODES);

export const TELEGRAM_ORDERING_MODES = [
  "views",
  "latest",
  "views_per_source",
  "latest_per_source",
  "keywords",
] as const;

export type TelegramOrderingMode = (typeof TELEGRAM_ORDERING_MODES)[number];

export const telegramOrderingModeSchema = z.enum(TELEGRAM_ORDERING_MODES);

export const SOURCE_IMPORT_STAGES = [
  "acquiring",
  "enriching",
  "settled",
] as const;

export type SourceImportStage = (typeof SOURCE_IMPORT_STAGES)[number];

export const sourceImportStageSchema = z.enum(SOURCE_IMPORT_STAGES);
