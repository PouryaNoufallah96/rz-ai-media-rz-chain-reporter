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

export const MARKET_ANALYSIS_STATUSES = ["in_progress", "completed"] as const;
export const MARKET_ANALYSIS_VIEWS = ["history"] as const;
export const MARKET_ANALYSIS_STEPS = [
  "market",
  "chart",
  "story",
  "design",
  "generate",
  "publish",
] as const;

export const marketAnalysisSearchParsers = {
  status: parseAsStringLiteral(MARKET_ANALYSIS_STATUSES),
  brand: parseAsString,
  q: parseAsString,
  cursor: parseAsString,
};

export const analysisStepSearchParsers = {
  step: parseAsStringLiteral(MARKET_ANALYSIS_STEPS),
};

export const marketAnalysisViewSearchParsers = {
  view: parseAsStringLiteral(MARKET_ANALYSIS_VIEWS),
};

export const analysisReportSearchParsers = {
  draft: parseAsString,
};

export const loadMarketAnalysisSearchParams = createLoader(
  marketAnalysisSearchParsers,
);
export const loadMarketAnalysisViewSearchParams = createLoader(
  marketAnalysisViewSearchParsers,
);
export const loadAnalysisReportSearchParams = createLoader(
  analysisReportSearchParsers,
);

export type MarketAnalysisSearchParams = Promise<SearchParams>;
export type MarketAnalysisSearchPatch = Partial<
  Nullable<inferParserType<typeof marketAnalysisSearchParsers>>
>;

const marketAnalysisHistoryQuerySchema = z.strictObject({
  status: z.enum(MARKET_ANALYSIS_STATUSES).nullable().catch(null),
  brand: z.uuid().nullable().catch(null),
  q: z.string().trim().min(1).max(120).nullable().catch(null),
  cursor: keysetCursorParam,
});

export type MarketAnalysisHistoryQuery = z.infer<
  typeof marketAnalysisHistoryQuerySchema
>;

export function normalizeMarketAnalysisHistoryQuery(
  input: Awaited<ReturnType<typeof loadMarketAnalysisSearchParams>>,
): MarketAnalysisHistoryQuery {
  const q = input.q?.trim().replace(/\s+/gu, " ").slice(0, 120) || null;
  return marketAnalysisHistoryQuerySchema.parse({ ...input, q });
}

const analysisReportQuerySchema = z.strictObject({
  draft: z.uuid().nullable().catch(null),
});

export type AnalysisReportQuery = z.infer<typeof analysisReportQuerySchema>;

export function normalizeAnalysisReportQuery(
  input: Awaited<ReturnType<typeof loadAnalysisReportSearchParams>>,
): AnalysisReportQuery {
  return analysisReportQuerySchema.parse(input);
}
