import { z } from "zod";

import { type Platform, platformSchema } from "./platform";
import { type ContentLocale, telegramOrderingModeSchema } from "./source";

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

// Gateway bound; the template validator sizes image-profile prompts against it.
export const MODEL_PROMPT_MAX_LENGTH = 24_000;

// Serialised bound on the source projection the image selection prompt carries.
export const IMAGE_SELECTION_SOURCE_MAX_CHARS = 3_000;

// Covers the selection prompt's fixed instruction lines and their separators.
export const IMAGE_SELECTION_PROMPT_RESERVE = 512;

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

export type RunConfigurationSourceConstraints = {
  telegramSourceIds: readonly string[];
};

const transportNews = z.strictObject({
  kind: z.literal("news"),
  brands: z.array(z.string()),
  models: z.array(z.string()).min(1, { error: "NO_MODEL" }),
  platforms: z.array(platformSchema).min(1, { error: "NO_PLATFORM" }),
  sourceIds: z
    .array(z.uuid())
    .min(1, { error: "NO_SOURCES" })
    .max(200, { error: "TOO_MANY_SOURCES" }),
  windowHours: analysisRunWindowHoursSchema,
  enrichmentEnabled: z.boolean(),
  telegramOnly: z.boolean(),
  orderingMode: telegramOrderingModeSchema,
  topN: z.int().min(1, { error: "TOP_N_BELOW_MINIMUM" }),
  topics: z.array(z.string()),
});

const transportPromo = z.strictObject({
  kind: z.literal("promo"),
  models: z.array(z.string()).min(1, { error: "NO_MODEL" }),
  platforms: z.array(platformSchema).optional(),
  promo: z.strictObject({
    brands: z.array(z.string()),
    prompts: z.record(z.string(), z.string()),
  }),
});

export const runConfigurationTransportSchema = z.discriminatedUnion("kind", [
  transportNews,
  transportPromo,
]);

export type RunConfigurationTransport = z.input<
  typeof runConfigurationTransportSchema
>;

export function canonicalRunConfiguration(
  configuration: RunConfigurationTransport,
) {
  return canonicalJson(configuration);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value
      .map((entry) => (entry === undefined ? "null" : canonicalJson(entry)))
      .join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new TypeError("run configuration contains a non-JSON value");
  }
  return encoded;
}

export function runConfigurationSchema(
  bounds: RunConfigurationBounds,
  sourceConstraints?: RunConfigurationSourceConstraints,
) {
  const brandKey = z.enum(bounds.brandKeys);
  const modelKey = z.enum(bounds.modelKeys);
  const telegramSourceIds = new Set(sourceConstraints?.telegramSourceIds ?? []);

  const news = transportNews.extend({
    brands: z.array(brandKey).min(1, { error: "NO_BRAND" }),
    models: z.array(modelKey).min(1, { error: "NO_MODEL" }),
    platforms: z
      .array(z.enum(bounds.platforms))
      .min(1, { error: "NO_PLATFORM" }),
    topN: z
      .int()
      .min(1, { error: "TOP_N_BELOW_MINIMUM" })
      .max(bounds.selectionCap, { error: "TOP_N_EXCEEDS_CAP" }),
    topics: z
      .array(
        z
          .string()
          .trim()
          .min(1, { error: "TOPIC_REQUIRED" })
          .max(bounds.semanticMaxChars, { error: "TOPIC_TOO_LONG" }),
      )
      .max(bounds.semanticMaxTopics, { error: "TOO_MANY_TOPICS" }),
  });

  const promo = transportPromo.extend({
    models: z.array(modelKey).min(1, { error: "NO_MODEL" }),
    platforms: z
      .array(z.enum(bounds.platforms))
      .min(1, { error: "NO_PLATFORM" })
      .optional(),
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

      if (
        sourceConstraints &&
        configuration.kind === "news" &&
        configuration.telegramOnly &&
        !configuration.sourceIds.some((sourceId) =>
          telegramSourceIds.has(sourceId),
        )
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["sourceIds"],
          message: "TELEGRAM_SOURCE_REQUIRED",
        });
      }

      if (
        configuration.kind === "news" &&
        configuration.orderingMode === "keywords" &&
        configuration.topics.length === 0
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["topics"],
          message: "KEYWORD_TOPIC_REQUIRED",
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
    })
    .transform((configuration) =>
      configuration.kind === "promo"
        ? {
            ...configuration,
            platforms: configuration.platforms ?? [...bounds.platforms],
          }
        : configuration,
    );
}

export type RunConfiguration = z.infer<
  ReturnType<typeof runConfigurationSchema>
>;

export function effectiveNewsSourceIds(
  configuration: Extract<RunConfiguration, { kind: "news" }>,
  telegramSourceIds: readonly string[],
) {
  if (!configuration.telegramOnly) return [...configuration.sourceIds];

  const telegramSources = new Set(telegramSourceIds);
  return configuration.sourceIds.filter((sourceId) =>
    telegramSources.has(sourceId),
  );
}

export const PLATFORM_COPY_HARD_MAX: Record<Platform, number> = {
  instagram: 2_200,
  telegram: 4_096,
  x: 280,
};

// Telegram caps a photo caption far below a plain message.
export const TELEGRAM_MEDIA_COPY_HARD_MAX = 1_024;

export const INLINE_HASHTAG_TOKEN = /(?:^|\s)#[^\s#]+/gu;

export const TELEGRAM_READ_MORE_LABEL: Record<ContentLocale, string> = {
  en: "Read full story",
  fa: "مطالعه کامل خبر",
};

// The assembled copy must still leave room for the appended read-more line.
export const TELEGRAM_READ_MORE_RESERVE =
  2 + Math.max(...Object.values(TELEGRAM_READ_MORE_LABEL).map((l) => l.length));

export function assemblePublishPayload(input: {
  contentLocale: ContentLocale;
  draft: {
    body: string;
    hashtags: readonly string[];
    headline: string;
  } | null;
  hasMedia: boolean;
  platform: Platform;
  source: { attribution: string; canonicalUrl: string } | null;
}) {
  const method =
    input.platform === "telegram"
      ? input.hasMedia
        ? "sendPhoto"
        : "sendMessage"
      : input.platform === "instagram"
        ? "caption"
        : "post";
  const maximum =
    input.platform === "telegram" && input.hasMedia
      ? TELEGRAM_MEDIA_COPY_HARD_MAX
      : PLATFORM_COPY_HARD_MAX[input.platform];
  if (!input.draft) {
    return { status: "missing" as const, method, length: 0, maximum };
  }

  const body = normalizePublishText(input.draft.body);
  const headline = normalizePublishText(input.draft.headline);
  const hashtags = normalizePublishHashtags(input.draft.hashtags);
  let text = assembleCopy(input.platform, { body, hashtags, headline });
  let telegramLink: {
    length: number;
    offset: number;
    url: string;
  } | null = null;

  if (input.platform === "telegram" && input.source) {
    const linkText = TELEGRAM_READ_MORE_LABEL[input.contentLocale];
    text = `${text}\n\n${linkText}`;
    telegramLink = {
      length: linkText.length,
      offset: text.length - linkText.length,
      url: input.source.canonicalUrl,
    };
  }

  const length = platformCopyLength(input.platform, text);
  if (input.platform === "instagram" && !input.hasMedia) {
    return {
      status: "media_required" as const,
      method,
      length,
      maximum,
      text,
    };
  }
  return length <= maximum
    ? {
        status: "ready" as const,
        method,
        length,
        maximum,
        telegramLink,
        text,
      }
    : { status: "overflow" as const, method, length, maximum };
}

export function assembleCopy(
  platform: Platform,
  candidate: {
    headline: string;
    body: string;
    hashtags: readonly string[];
  },
) {
  const separator = platform === "x" ? "\n" : "\n\n";
  return `${candidate.headline}${separator}${candidate.body}\n\n${candidate.hashtags.join(" ")}`;
}

// Telegram and Instagram count UTF-16 code units; only X weights code points.
export function platformCopyLength(platform: Platform, value: string) {
  if (platform !== "x") return value.length;
  const urls = value.match(/https?:\/\/\S+/gu) ?? [];
  const withoutUrls = urls.reduce(
    (remaining, url) => remaining.replace(url, ""),
    value,
  );
  return (
    Array.from(withoutUrls).reduce(
      (length, character) => length + xCharacterWeight(character),
      0,
    ) +
    urls.length * 23
  );
}

function xCharacterWeight(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return codePoint <= 0x10ff ||
    (codePoint >= 0x2000 && codePoint <= 0x200d) ||
    (codePoint >= 0x2010 && codePoint <= 0x201f) ||
    (codePoint >= 0x2032 && codePoint <= 0x2037)
    ? 1
    : 2;
}

function normalizePublishText(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

function normalizePublishHashtags(values: readonly string[]) {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values) {
    const hashtag = value.trim().replace(/^#+/u, "").replace(/\s+/gu, "_");
    if (!hashtag) continue;
    const key = hashtag.toLocaleLowerCase("und");
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(`#${hashtag}`);
  }
  return normalized;
}
