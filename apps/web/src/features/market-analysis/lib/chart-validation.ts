import {
  type MarketChartRenderInput,
  type MarketChartSpec,
  type MarketPeriod,
  marketChartSpecSchema,
} from "@rz-chain-reporter/contracts";

const DAY_MS = 86_400_000;
const PERIOD_DAYS: Record<MarketPeriod, number> = {
  "24h": 1,
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "1y": 365,
};
const TIMELINE_COVERAGE_RATIO = 0.9;

export function marketChartChecks(
  spec: MarketChartSpec,
  snapshot: MarketChartRenderInput["snapshot"],
  requestedPeriod: MarketPeriod,
) {
  const parsed = marketChartSpecSchema.safeParse(spec);
  const codes = new Set(
    parsed.success ? [] : parsed.error.issues.map((issue) => issue.message),
  );
  const covered =
    Date.parse(snapshot.effectiveWindowEnd) -
    Date.parse(snapshot.effectiveWindowStart);
  return {
    uniqueColors: !codes.has("market_chart_series_color_duplicate"),
    colorContrast: !codes.has("market_chart_series_color_contrast"),
    timeline:
      snapshot.period === requestedPeriod &&
      covered >=
        PERIOD_DAYS[requestedPeriod] * DAY_MS * TIMELINE_COVERAGE_RATIO,
  };
}

export type MarketChartChecks = ReturnType<typeof marketChartChecks>;
