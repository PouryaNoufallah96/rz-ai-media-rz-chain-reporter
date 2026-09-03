import { z } from "zod";

export const MARKET_PROVIDERS = [
  "coinmarketcap",
  "coinmarketcap_public",
  "binance",
  "coingecko",
  "coingecko_onchain",
] as const;

export type MarketProvider = (typeof MARKET_PROVIDERS)[number];

export const marketProviderSchema = z.enum(MARKET_PROVIDERS);

export const MARKET_COMPARISON_PROVIDERS = ["binance"] as const;

export type MarketComparisonProvider =
  (typeof MARKET_COMPARISON_PROVIDERS)[number];

export const marketComparisonProviderSchema = z.enum(
  MARKET_COMPARISON_PROVIDERS,
);

export const MARKET_PERIODS = ["24h", "7d", "30d", "90d", "1y"] as const;

export type MarketPeriod = (typeof MARKET_PERIODS)[number];

export const marketPeriodSchema = z.enum(MARKET_PERIODS);

export const MARKET_SCALES = ["relative", "absolute"] as const;

export type MarketScale = (typeof MARKET_SCALES)[number];

export const marketScaleSchema = z.enum(MARKET_SCALES);

export const MARKET_OUTPUT_FORMATS = [
  "portrait",
  "square",
  "story",
  "landscape",
] as const;

export type MarketOutputFormat = (typeof MARKET_OUTPUT_FORMATS)[number];

export const marketOutputFormatSchema = z.enum(MARKET_OUTPUT_FORMATS);

const mappingBase = {
  fallback: z.boolean(),
};

const onchainBase = {
  ...mappingBase,
  provider: z.literal("coingecko_onchain" satisfies MarketProvider),
  network: z.string().trim().min(1).max(80),
  contract: z.string().trim().min(1).max(160),
};

export const marketProviderMappingSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...mappingBase,
    kind: z.literal("coinmarketcap_coin"),
    provider: z.literal("coinmarketcap" satisfies MarketProvider),
    coinId: z.int().positive(),
  }),
  z.strictObject({
    ...mappingBase,
    kind: z.literal("coinmarketcap_public_kline"),
    provider: z.literal("coinmarketcap_public" satisfies MarketProvider),
    platform: z.string().trim().min(1).max(80),
    address: z.string().trim().min(1).max(160),
  }),
  z.strictObject({
    ...mappingBase,
    kind: z.literal("binance_pair"),
    provider: z.literal("binance" satisfies MarketProvider),
    pair: z.string().regex(/^[A-Z0-9]{5,30}$/u),
  }),
  z.strictObject({
    ...mappingBase,
    kind: z.literal("coingecko_coin"),
    provider: z.literal("coingecko" satisfies MarketProvider),
    coinId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u),
  }),
  z.strictObject({
    ...onchainBase,
    kind: z.literal("onchain_token"),
  }),
  z.strictObject({
    ...onchainBase,
    kind: z.literal("onchain_pool"),
    pool: z.string().trim().min(1).max(160),
    tokenSide: z.enum(["base", "quote"]),
  }),
]);

export type MarketProviderMapping = z.infer<typeof marketProviderMappingSchema>;

export const MARKET_ANALYSIS_STATUSES = ["in_progress", "completed"] as const;
export const marketAnalysisStatusSchema = z.enum(MARKET_ANALYSIS_STATUSES);
export type MarketAnalysisStatus = z.infer<typeof marketAnalysisStatusSchema>;

export const MARKET_SERIES_ROLES = ["primary", "comparison"] as const;
export const marketSeriesRoleSchema = z.enum(MARKET_SERIES_ROLES);
export type MarketSeriesRole = z.infer<typeof marketSeriesRoleSchema>;

export const MARKET_SNAPSHOT_STATUSES = [
  "verified",
  "partial",
  "unverified",
] as const;
export const marketSnapshotStatusSchema = z.enum(MARKET_SNAPSHOT_STATUSES);
export type MarketSnapshotStatus = z.infer<typeof marketSnapshotStatusSchema>;

export const MARKET_SNAPSHOT_SERIES_OUTCOMES = ["succeeded", "failed"] as const;
export const marketSnapshotSeriesOutcomeSchema = z.enum(
  MARKET_SNAPSHOT_SERIES_OUTCOMES,
);

export const MARKET_GENERATION_BRIEF_SOURCES = [
  "model",
  "deterministic_fallback",
] as const;
export const marketGenerationBriefSourceSchema = z.enum(
  MARKET_GENERATION_BRIEF_SOURCES,
);

const boundedMarketText = z.string().trim().min(1).max(160);

export const normalizedMarketSeriesSchema = z.strictObject({
  descriptorIdentity: boundedMarketText,
  role: marketSeriesRoleSchema,
  displayName: boundedMarketText,
  symbol: boundedMarketText,
  controlledInstrumentId: z.uuid().nullable(),
  providerMappings: z.array(marketProviderMappingSchema).min(1).max(4),
});

export const normalizedMarketRequestSchema = z
  .strictObject({
    period: marketPeriodSchema,
    scale: marketScaleSchema,
    series: z.array(normalizedMarketSeriesSchema).min(1).max(6),
  })
  .superRefine((request, context) => {
    if (!request.series.some((series) => series.role === "primary")) {
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "MARKET_PRIMARY_SERIES_REQUIRED",
      });
    }
    const identities = new Set<string>();
    for (const [index, series] of request.series.entries()) {
      if (identities.has(series.descriptorIdentity)) {
        context.addIssue({
          code: "custom",
          path: ["series", index, "descriptorIdentity"],
          message: "MARKET_SERIES_DUPLICATE",
        });
      }
      identities.add(series.descriptorIdentity);
    }
  });

export type NormalizedMarketRequest = z.infer<
  typeof normalizedMarketRequestSchema
>;

export const marketExecutionScopeTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("analysis_run"), analysisRunId: z.uuid() }),
  z.strictObject({
    kind: z.literal("market_analysis"),
    marketAnalysisId: z.uuid(),
  }),
]);

export type MarketExecutionScopeTarget = z.infer<
  typeof marketExecutionScopeTargetSchema
>;

type ConfiguredMarketProvider = MarketProviderMapping["provider"];

type AssertMarketProviderCoverage =
  ConfiguredMarketProvider extends MarketProvider
    ? MarketProvider extends ConfiguredMarketProvider
      ? true
      : never
    : never;

const assertMarketProviderCoverage: AssertMarketProviderCoverage = true;
void assertMarketProviderCoverage;
