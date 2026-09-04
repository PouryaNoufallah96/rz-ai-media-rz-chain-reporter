import type { MarketPeriod } from "@rz-chain-reporter/contracts";
import type {
  MarketPoint,
  MarketSeriesFailure,
  MarketSeriesOutcome,
  MarketSeriesSuccess,
} from "./types";

const PERIOD_MS: Record<MarketPeriod, number> = {
  "24h": 86_400_000,
  "7d": 604_800_000,
  "30d": 2_592_000_000,
  "90d": 7_776_000_000,
  "1y": 31_536_000_000,
};
export const periodMilliseconds = (period: MarketPeriod) => PERIOD_MS[period];
function normalizeObservedPoints(points: readonly MarketPoint[]) {
  const byTimestamp = new Map<number, number>();
  for (const [timestamp, price] of points) {
    if (
      Number.isFinite(timestamp) &&
      Number.isFinite(price) &&
      timestamp > 0 &&
      price > 0
    ) {
      byTimestamp.set(Math.trunc(timestamp), price);
    }
  }
  return [...byTimestamp.entries()].sort((left, right) => left[0] - right[0]);
}
export function clipToWindow(
  points: readonly MarketPoint[],
  start: number,
  end: number,
) {
  return normalizeObservedPoints(points).filter(
    ([timestamp]) => timestamp >= start && timestamp <= end,
  );
}
export function coverageWarnings(
  points: readonly MarketPoint[],
  start: number,
  end: number,
) {
  const normalized = normalizeObservedPoints(points);
  const first = normalized[0];
  const last = normalized.at(-1);
  if (!first || !last || normalized.length < 2) return [];

  const gaps = normalized
    .slice(1)
    .flatMap(([timestamp], index) => {
      const previous = normalized[index];
      return previous ? [timestamp - previous[0]] : [];
    })
    .filter((gap) => gap > 0)
    .sort((left, right) => left - right);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? end - start;
  const tolerance = Math.max(medianGap * 2, 60_000);
  return [
    ...(first[0] > start + tolerance ? ["coverage_late_start"] : []),
    ...(last[0] < end - tolerance ? ["coverage_early_end"] : []),
    ...(gaps.some((gap) => gap > medianGap * 3) ? ["sparse_coverage"] : []),
  ];
}
export function summarizeObservedSeries(
  points: readonly MarketPoint[],
  input: Omit<
    MarketSeriesSuccess,
    | "changePercent"
    | "coverageEnd"
    | "coverageStart"
    | "endPrice"
    | "outcome"
    | "points"
    | "startPrice"
  >,
): MarketSeriesSuccess | MarketSeriesFailure {
  const normalized = normalizeObservedPoints(points);
  const first = normalized[0];
  const last = normalized.at(-1);
  if (!first || !last || normalized.length < 2) {
    return {
      attemptedMappings: input.attemptedMappings,
      failureCode: "MARKET_SERIES_UNAVAILABLE",
      outcome: "failed",
      retryClassification: "permanent",
      warnings: ["insufficient_observations"],
    };
  }
  return {
    ...input,
    changePercent: (((last[1] - first[1]) / first[1]) * 100).toString(),
    coverageEnd: new Date(last[0]),
    coverageStart: new Date(first[0]),
    endPrice: last[1].toString(),
    outcome: "succeeded",
    points: normalized.map(([timestamp, price]) => [
      new Date(timestamp).toISOString(),
      price.toString(),
    ]),
    startPrice: first[1].toString(),
  };
}
export function effectiveCommonWindow(
  outcomes: readonly MarketSeriesOutcome[],
) {
  const succeeded = outcomes.filter(
    (outcome): outcome is MarketSeriesSuccess =>
      outcome.outcome === "succeeded",
  );
  if (succeeded.length === 0) return null;
  return {
    end: new Date(
      Math.min(...succeeded.map((outcome) => outcome.coverageEnd.getTime())),
    ),
    start: new Date(
      Math.max(...succeeded.map((outcome) => outcome.coverageStart.getTime())),
    ),
  };
}

export function alignToCommonWindow(outcomes: readonly MarketSeriesOutcome[]) {
  const window = effectiveCommonWindow(outcomes);
  if (!window || window.start > window.end) {
    return { outcomes: [...outcomes], window };
  }
  const aligned = outcomes.map((outcome) => {
    if (outcome.outcome === "failed") return outcome;
    const points = outcome.points
      .map(
        ([timestamp, price]) => [Date.parse(timestamp), Number(price)] as const,
      )
      .filter(
        ([timestamp]) =>
          timestamp >= window.start.getTime() &&
          timestamp <= window.end.getTime(),
      );
    return summarizeObservedSeries(points, {
      attemptedMappings: outcome.attemptedMappings,
      attributionIdentity: outcome.attributionIdentity,
      mapping: outcome.mapping,
      provider: outcome.provider,
      providerReference: outcome.providerReference,
      warnings: [
        ...outcome.warnings,
        ...(points.length < outcome.points.length
          ? ["common_window_clipped"]
          : []),
      ],
    });
  });
  return { outcomes: aligned, window };
}
