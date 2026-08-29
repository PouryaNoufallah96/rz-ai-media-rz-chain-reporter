import {
  type ContentLocale,
  type DuplicateMethod,
  FILTER_DISPOSITIONS,
  type FilterDisposition,
  type FilteringReason,
  type ItemEligibility,
  SEMANTIC_PARTICIPATIONS,
  type SemanticParticipation,
  type SourceOrigin,
  type TelegramOrderingMode,
} from "@rz-chain-reporter/contracts";
import type { AnalysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
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

// The grid's sixth value is derived: `analysis_run_item.eligibility = 'duplicate'`
// has no filter_result row, so the stored tuple is never widened for it.
export const REPORT_DISPOSITIONS = [
  ...FILTER_DISPOSITIONS,
  "duplicate",
] as const;

type ReportDisposition = (typeof REPORT_DISPOSITIONS)[number];

export const reportSearchParsers = {
  brand: parseAsString,
  disposition: parseAsStringLiteral(REPORT_DISPOSITIONS),
  semantic: parseAsStringLiteral(SEMANTIC_PARTICIPATIONS),
  cursor: parseAsString,
};

export const loadReportSearchParams = createLoader(reportSearchParsers);

export type ReportSearchParams = Promise<SearchParams>;

export type ReportSearchPatch = Partial<
  Nullable<inferParserType<typeof reportSearchParsers>>
>;

const reportQuerySchema = z.object({
  brand: z.uuid().nullable().catch(null),
  disposition: z.enum(REPORT_DISPOSITIONS).nullable().catch(null),
  semantic: z.enum(SEMANTIC_PARTICIPATIONS).nullable().catch(null),
  cursor: keysetCursorParam,
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;

export function normalizeReportQuery(
  input: Awaited<ReturnType<typeof loadReportSearchParams>>,
): ReportQuery {
  return reportQuerySchema.parse(input);
}

// Stored dispositions select routed rows; `duplicate` selects only unbranded duplicates.
// Missing or invalid dispositions retain both branches.
export function reportBranchPlan(query: ReportQuery): {
  routeDisposition: FilterDisposition | null;
  includeRoutes: boolean;
  includeDuplicates: boolean;
} {
  if (query.disposition === "duplicate") {
    return {
      routeDisposition: null,
      includeRoutes: false,
      includeDuplicates: query.brand === null,
    };
  }

  return {
    routeDisposition: query.disposition,
    includeRoutes: true,
    includeDuplicates: query.disposition === null && query.brand === null,
  };
}

export const reportCursorSchema = z.object({
  direction: z.enum(["next", "previous"]),
  bucket: z.int().min(0).max(2),
  sortRank: z.int().nonnegative(),
  sourceItemId: z.uuid(),
  mediaBrandId: z.uuid(),
});

export type ReportCursor = z.infer<typeof reportCursorSchema>;

export type ReportRow = {
  sourceItemId: string;
  mediaBrandId: string | null;
  brandKey: string | null;
  brandName: string | null;
  eligibility: ItemEligibility;
  disposition: ReportDisposition;
  reason: FilteringReason | null;
  rankPosition: number | null;
  valueSignalCount: number | null;
  mediaFitScore: number | null;
  mediaFitThreshold: number | null;
  sourcePreferenceScore: number | null;
  diversityScore: number | null;
  semanticBrandScore: number | null;
  policyScore: number | null;
  rankScore: number | null;
  sourceAuthorityScore: number | null;
  freshnessScore: number | null;
  policyViralityScore: number | null;
  lexicalTopicScore: number | null;
  lexicalTopicIndex: number | null;
  semanticTopicScore: number | null;
  semanticTopicIndex: number | null;
  semanticParticipation: SemanticParticipation | null;
  duplicateMethod: DuplicateMethod | null;
  duplicateOfSourceItemId: string | null;
  duplicateOfTitle: string | null;
  duplicateOfOrigin: SourceOrigin | null;
  duplicateSimilarityBp: number | null;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  contentLocale: ContentLocale;
  sourceName: string;
  sourceOrigin: SourceOrigin;
  sourceEndpoint: string;
  sourceRank: number | null;
  orderingMode: TelegramOrderingMode | null;
  views: number | null;
  publishedAt: Date | null;
};

export type ReportPage = {
  rows: ReportRow[];
  nextCursor: string | null;
  previousCursor: string | null;
  offFirst: boolean;
};

export type ReportBrandOption = {
  id: string;
  key: string;
  name: string;
};

export type ReportThresholds = {
  lexicalTopicScore: number;
  policyScore: number;
  semanticDedup: number;
  shortlistCap: number;
  mediaFitByBrandKey: Record<string, number>;
};

export function reportLaneCap(
  row: Pick<ReportRow, "sourceOrigin">,
  thresholds: Pick<ReportThresholds, "shortlistCap">,
  telegramLaneCap: number,
) {
  return row.sourceOrigin === "telegram_public"
    ? telegramLaneCap
    : thresholds.shortlistCap;
}

export type LowScoreFailure = "lexical_topic" | "policy";

export function reportLowScoreFailures(
  row: Pick<ReportRow, "disposition" | "lexicalTopicScore" | "policyScore">,
  thresholds: Pick<ReportThresholds, "lexicalTopicScore" | "policyScore">,
  hasTopics: boolean,
): LowScoreFailure[] {
  if (row.disposition !== "low_score") return [];

  const failures: LowScoreFailure[] = [];
  if (row.policyScore !== null && row.policyScore < thresholds.policyScore) {
    failures.push("policy");
  }
  if (
    hasTopics &&
    row.lexicalTopicScore !== null &&
    row.lexicalTopicScore < thresholds.lexicalTopicScore
  ) {
    failures.push("lexical_topic");
  }

  return failures;
}

export type RunReport = {
  page: ReportPage;
  funnels: AnalysisRunProgress | null;
  brands: ReportBrandOption[];
  thresholds: ReportThresholds;
  query: ReportQuery;
  readAt: Date;
};
