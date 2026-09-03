import type { useTranslations } from "next-intl";

import type { MARKET_ANALYSIS_NAMESPACE } from "../constants";
import type { MarketAnalysisProjection } from "../schemas/reads";

type Translate = ReturnType<
  typeof useTranslations<typeof MARKET_ANALYSIS_NAMESPACE>
>;

export function descriptorOf(
  analysis: MarketAnalysisProjection,
  identity: string,
) {
  return analysis.normalizedRequest.series.find(
    (item) => item.descriptorIdentity === identity,
  );
}

export function warningRecords(scope: string, warnings: readonly string[]) {
  const occurrences = new Map<string, number>();
  return warnings.map((code) => {
    const occurrence = (occurrences.get(code) ?? 0) + 1;
    occurrences.set(code, occurrence);
    return { code, key: `${scope}:${code}:${occurrence}` };
  });
}

export function warningMessage(t: Translate, code: string) {
  switch (code) {
    case "coverage_late_start":
    case "coverage_early_end":
    case "sparse_coverage":
    case "insufficient_observations":
    case "common_window_clipped":
    case "malformed_provider_points_dropped":
    case "fallback_mapping_used":
    case "window_clipped":
    case "provider_rate_limited":
    case "provider_unavailable":
      return t(`market.warnings.${code}`);
    default:
      return t("market.warnings.generic");
  }
}

export function failureMessage(t: Translate, code: string | null) {
  switch (code) {
    case "MARKET_SERIES_UNAVAILABLE":
    case "MARKET_PROVIDER_UNAVAILABLE":
    case "VALIDATION_FAILED":
      return t(`market.failures.${code}`);
    default:
      return t("market.failures.generic");
  }
}
