import type {
  ContentLocale,
  MARKET_GENERATION_BRIEF_SOURCES,
  MARKET_SNAPSHOT_SERIES_OUTCOMES,
  MarketAnalysisStatus,
  MarketChartRenderInput,
  MarketChartSpec,
  MarketOutputFormat,
  MarketPeriod,
  MarketScale,
  MarketSeriesRole,
  MarketSnapshotStatus,
  ModelOption,
  NormalizedMarketRequest,
  OperationLifecycle,
  Platform,
} from "@rz-chain-reporter/contracts";
import {
  contentLocaleSchema,
  marketChartSpecSchema,
  marketOutputFormatSchema,
  marketPeriodSchema,
  marketScaleSchema,
  platformSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";
import type { PlatformDraftExactCard } from "@/features/editorial/schemas/drafts";

import type { MARKET_ANALYSIS_STEPS } from "./search";

export const MARKET_COMPARISON_SEARCH_LIMIT = 8;
const MARKET_COMPARISON_SEARCH_QUERY_MAX_LENGTH = 80;

export function normalizeMarketComparisonSearchQuery(query: string) {
  return query.trim().replace(/\s+/gu, " ");
}

const marketComparisonProjectionSchema = z.strictObject({
  canonicalIdentity: z.string(),
  symbol: z.string(),
  displayName: z.string(),
  baseAsset: z.string(),
  quoteAsset: z.string(),
});

export type MarketComparisonProjection = z.infer<
  typeof marketComparisonProjectionSchema
>;

export const marketComparisonSearchInputSchema = z.strictObject({
  q: z
    .string({ error: "MARKET_COMPARISON_QUERY_INVALID" })
    .transform(normalizeMarketComparisonSearchQuery)
    .pipe(
      z
        .string()
        .min(1, { error: "MARKET_COMPARISON_QUERY_REQUIRED" })
        .max(MARKET_COMPARISON_SEARCH_QUERY_MAX_LENGTH, {
          error: "MARKET_COMPARISON_QUERY_TOO_LONG",
        }),
    ),
  limit: z
    .number({ error: "MARKET_COMPARISON_LIMIT_INVALID" })
    .int({ error: "MARKET_COMPARISON_LIMIT_INVALID" })
    .min(1, { error: "MARKET_COMPARISON_LIMIT_INVALID" })
    .max(MARKET_COMPARISON_SEARCH_LIMIT, {
      error: "MARKET_COMPARISON_LIMIT_INVALID",
    })
    .default(MARKET_COMPARISON_SEARCH_LIMIT),
});

export type MarketComparisonSearchInput = z.infer<
  typeof marketComparisonSearchInputSchema
>;

export const marketComparisonSearchResultSchema = z.strictObject({
  entries: z
    .array(marketComparisonProjectionSchema)
    .max(MARKET_COMPARISON_SEARCH_LIMIT),
});

export type MarketComparisonSearchResult = z.infer<
  typeof marketComparisonSearchResultSchema
>;

const assistantMarketOptionSchema = z.strictObject({
  key: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(200),
});

export const assistantMarketLoadProjectionSchema = z.strictObject({
  options: z.strictObject({
    instruments: z.array(
      z.strictObject({
        id: z.uuid(),
        key: z.string().trim().min(1).max(128),
        name: z.string().trim().min(1).max(200),
        symbol: z.string().trim().min(1).max(80),
      }),
    ),
    enabledPeriods: z.array(marketPeriodSchema),
    enabledScales: z.array(marketScaleSchema),
    defaultPeriod: marketPeriodSchema,
    defaultScale: marketScaleSchema,
    outputFormat: marketOutputFormatSchema,
    defaultComparisonIdentity: z.string().nullable(),
    compositions: z.array(
      z.strictObject({
        key: z.string().trim().min(1).max(80),
        displayName: z.string().trim().min(1).max(200),
        variants: z.array(
          z.strictObject({
            key: z.string().trim().min(1).max(80),
            displayName: z.string().trim().min(1).max(200),
            formats: z.array(marketOutputFormatSchema),
            minSeries: z.int().positive(),
            maxSeries: z.int().positive(),
            allowedScales: z.array(marketScaleSchema),
          }),
        ),
      }),
    ),
    defaultImageOptionKey: z.string(),
    imageOptions: z.array(assistantMarketOptionSchema),
    defaultCopyModelOptionKey: z.string(),
    copyModels: z.array(assistantMarketOptionSchema),
    catalog: z.array(marketComparisonProjectionSchema),
  }),
  analysis: z
    .strictObject({
      id: z.uuid(),
      status: z.enum(["in_progress", "completed"]),
      version: z.int().positive(),
      mediaBrandName: z.string(),
      visualOwnerInstrumentId: z.uuid(),
      visualOwnerName: z.string(),
      visualOwnerSymbol: z.string(),
      contentLocale: contentLocaleSchema,
      primaryInstrumentIds: z.array(z.uuid()).min(1).max(3),
      comparisonCatalogIdentities: z.array(z.string()).max(3),
      period: marketPeriodSchema,
      scale: marketScaleSchema,
      outputFormat: marketOutputFormatSchema,
      requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
      snapshot: z
        .strictObject({
          status: z.enum(["verified", "partial", "unverified"]),
          warnings: z.array(z.string()),
          series: z.array(
            z.strictObject({
              descriptorIdentity: z.string(),
              role: z.enum(["primary", "comparison"]),
              outcome: z.enum(["succeeded", "failed"]),
              changePercent: z.string().nullable(),
              failureCode: z.string().nullable(),
            }),
          ),
        })
        .nullable(),
      chartSpec: marketChartSpecSchema.nullable(),
      chartDefaultVersion: z.int().positive().nullable(),
      chartApprovalFingerprint: z.string().nullable(),
      chartMediaAssetId: z.uuid().nullable(),
      storyHeadline: z.string().nullable(),
      storySupportingText: z.string().nullable(),
      storyApprovalFingerprint: z.string().nullable(),
      storySuggestions: z.array(
        z.strictObject({
          kind: z.enum(["marketComparison", "performanceLead"]),
          headline: z.string(),
          supportingText: z.string(),
        }),
      ),
      designFamilyKey: z.string().nullable(),
      designVariantKey: z.string().nullable(),
      designApprovalFingerprint: z.string().nullable(),
      imageOptionKey: z.string().nullable(),
      operatorDirection: z.string().nullable(),
      finalMediaAssetId: z.uuid().nullable(),
      finalApprovalFingerprint: z.string().nullable(),
      generation: z
        .strictObject({
          operationId: z.uuid(),
          phase: z.enum([
            "briefing",
            "cancelled",
            "failed",
            "finalizing",
            "generating",
            "queued",
            "ready",
            "superseded",
            "unknown",
          ]),
          canRetryFinalization: z.boolean(),
          finalizationRetryEpoch: z.int().nonnegative(),
        })
        .nullable(),
      eligiblePlatforms: z.array(platformSchema),
      drafts: z.array(
        z.strictObject({
          id: z.uuid(),
          platform: platformSchema,
          candidateCount: z.int().nonnegative(),
          generationLifecycle: z.string().nullable(),
        }),
      ),
    })
    .nullable(),
});

export type AssistantMarketLoadProjection = z.infer<
  typeof assistantMarketLoadProjectionSchema
>;

export type MarketAnalysisOptionsProjection = {
  instruments: readonly {
    id: string;
    key: string;
    name: string;
    symbol: string;
    icon: { url: string; width: number; height: number };
  }[];
  brandInstruments: readonly { brandKey: string; instrumentKey: string }[];
  enabledPeriods: readonly MarketPeriod[];
  enabledScales: readonly MarketScale[];
  defaultPeriod: MarketPeriod;
  defaultScale: MarketScale;
  compositions: readonly {
    key: string;
    displayName: string;
    variants: readonly {
      key: string;
      displayName: string;
      formats: readonly MarketOutputFormat[];
      minSeries: number;
      maxSeries: number;
      allowedScales: readonly MarketScale[];
      preferredScale: MarketScale;
      sample: {
        url: string;
        width: number;
        height: number;
      };
    }[];
  }[];
  defaultImageOptionKey: string;
  defaultComparisonSymbol: string;
  featuredComparisonSymbols: readonly string[];
  outputFormat: MarketOutputFormat;
  imageOptions: readonly ModelOption[];
  copyModels: readonly ModelOption[];
  defaultCopyModelOptionKey: string;
};

export type MarketAnalysisCatalogProjection = {
  entries: readonly MarketComparisonProjection[];
  lastSuccessAt: Date | null;
};

export type MarketSnapshotProjection = {
  id: string;
  status: MarketSnapshotStatus;
  period: MarketPeriod;
  scale: MarketScale;
  warnings: readonly string[];
  series: readonly MarketSeriesProjection[];
};

export type MarketAnalysisCoreProjection = {
  id: string;
  status: MarketAnalysisStatus;
  version: number;
  mediaBrandId: string;
  mediaBrandKey: string;
  mediaBrandName: string;
  visualOwnerInstrumentId: string;
  visualOwnerKey: string;
  visualOwnerName: string;
  visualOwnerSymbol: string;
  contentLocale: ContentLocale;
  normalizedRequest: NormalizedMarketRequest;
  requestFingerprint: string;
  currentSnapshot: MarketSnapshotProjection | null;
  chartRenderInput: MarketChartRenderInput | null;
  verification: null | {
    operationId: string;
    lifecycle: OperationLifecycle;
    resultSnapshot: MarketSnapshotProjection | null;
  };
  chartRender: null | {
    operationId: string;
    lifecycle: OperationLifecycle;
  };
  chartDefaultVersion: number | null;
  currentChartSpec: MarketChartSpec | null;
  currentChartRenderId: string | null;
  currentChartMediaAssetId: string | null;
  storyHeadline: string | null;
  storySupportingText: string | null;
  designFamilyKey: string | null;
  designVariantKey: string | null;
  outputFormat: MarketOutputFormat | null;
  operatorDirection: string | null;
  imageOptionKey: string | null;
  currentFinalMediaAssetId: string | null;
  generation: null | {
    briefSource: (typeof MARKET_GENERATION_BRIEF_SOURCES)[number] | null;
    canRetryFinalization: boolean;
    fallbackCode:
      | "MODEL_INVOCATION_FAILED"
      | "STRUCTURED_OUTPUT_INVALID"
      | null;
    finalMediaAssetId: string | null;
    finalizationRetryEpoch: number;
    operationId: string;
    phase:
      | "briefing"
      | "cancelled"
      | "failed"
      | "finalizing"
      | "generating"
      | "queued"
      | "ready"
      | "superseded"
      | "unknown";
    providerOriginalMediaAssetId: string | null;
  };
  approvals: {
    chart: ApprovalProjection;
    story: ApprovalProjection;
    design: ApprovalProjection;
    final: ApprovalProjection;
  };
  completedAt: Date | null;
  storySuggestions: readonly MarketStorySuggestion[];
  eligiblePlatforms: readonly Platform[];
  linkedDrafts: readonly { draftId: string; platform: Platform }[];
};

export type MarketAnalysisProjection = MarketAnalysisCoreProjection & {
  platformDrafts: readonly PlatformDraftExactCard[];
};

export type MarketStorySuggestion = {
  kind: "marketComparison" | "performanceLead";
  headline: string;
  supportingText: string;
};

export type MarketSeriesProjection = {
  descriptorIdentity: string;
  role: MarketSeriesRole;
  outcome: (typeof MARKET_SNAPSHOT_SERIES_OUTCOMES)[number];
  startPrice: string | null;
  endPrice: string | null;
  changePercent: string | null;
  failureCode: string | null;
  warnings: readonly string[];
};

type ApprovalProjection = {
  fingerprint: string | null;
  approvedAt: Date | null;
  approvedBy: string | null;
};

export type MarketAnalysisHistoryBaseRow = {
  id: string;
  status: MarketAnalysisStatus;
  version: number;
  symbols: string;
  visualOwnerName: string;
  contentLocale: ContentLocale;
  updatedAt: Date;
  completedAt: Date | null;
  period: MarketPeriod;
  scale: MarketScale;
  stage: (typeof MARKET_ANALYSIS_STEPS)[number];
  currentFinalMediaAssetId: string | null;
  currentOperationIds: readonly string[];
};

export type MarketAnalysisHistoryPage = {
  rows: MarketAnalysisHistoryBaseRow[];
  olderCursor: string | null;
  newerCursor: string | null;
  offLatest: boolean;
};

export type MarketAnalysisDynamicOverlay = {
  analysisId: string;
  operations: readonly {
    id: string;
    lifecycle: OperationLifecycle;
    version: number;
  }[];
  media: readonly {
    id: string;
    lifecycle: string;
    checksum: string | null;
    available: boolean;
    integrity: MarketMediaIntegrity;
  }[];
};

export type MarketMediaIntegrity =
  | "available"
  | "temporarily_unavailable"
  | "integrity_mismatch"
  | "bytes_removed"
  | "reconciliation_required";

export type MarketAnalysisReportCore = {
  id: string;
  createdAt: Date;
  completedAt: Date;
  completedBy: string;
  contentLocale: ContentLocale;
  mediaBrand: { id: string; key: string; name: string };
  visualOwner: { id: string; key: string; name: string; symbol: string };
  normalizedRequest: NormalizedMarketRequest;
  requestFingerprint: string;
  snapshot: {
    id: string;
    status: MarketSnapshotStatus;
    period: MarketPeriod;
    scale: MarketScale;
    effectiveWindowStart: Date | null;
    effectiveWindowEnd: Date | null;
    fetchCompletedAt: Date;
    warnings: readonly string[];
    series: readonly (MarketSeriesProjection & {
      provider: string | null;
      providerReference: string | null;
      attributionIdentity: string | null;
      coverageStart: Date | null;
      coverageEnd: Date | null;
    })[];
  };
  chart: {
    spec: MarketChartSpec;
    fingerprint: string;
    approvedAt: Date;
    approvedBy: string;
    renderContractVersion: string;
    media: ReportMedia;
    attribution: readonly string[];
  };
  story: {
    headline: string;
    supportingText: string;
    fingerprint: string;
    approvedAt: Date;
    approvedBy: string;
  };
  design: {
    familyKey: string;
    familyLabel: string | null;
    variantKey: string;
    variantLabel: string | null;
    outputFormat: MarketOutputFormat;
    imageOptionKey: string;
    referenceSampleKey: string;
    referenceSampleChecksum: string;
    referenceSampleLabel: string | null;
    footerLockupKey: string;
    footerLockupChecksum: string;
    fingerprint: string;
    approvedAt: Date;
    approvedBy: string;
  };
  final: {
    fingerprint: string;
    approvedAt: Date;
    approvedBy: string;
    media: ReportMedia;
    operationId: string;
    briefSource: (typeof MARKET_GENERATION_BRIEF_SOURCES)[number] | null;
    fallbackCode: string | null;
  };
  fingerprints: {
    template: string;
    catalog: string | null;
    instrumentProfile: string;
  };
};

export type ReportMedia = {
  id: string;
  checksum: string;
  mimeType: string;
  width: number;
  height: number;
};

export type MarketAnalysisReportLive = {
  media: readonly {
    id: string;
    role: "chart" | "final";
    integrity: MarketMediaIntegrity;
  }[];
  handoffs: readonly {
    id: string;
    classification: "final_completed_chain" | "earlier_approved_chain";
    createdAt: Date;
    drafts: readonly {
      id: string;
      platform: Platform;
      revisionNumber: number | null;
      saved: boolean;
      destinationReady: boolean;
      scheduleLifecycle: string | null;
      publicationLifecycle: string | null;
      deliveryUnknown: boolean;
      updatedAt: Date;
    }[];
  }[];
};
