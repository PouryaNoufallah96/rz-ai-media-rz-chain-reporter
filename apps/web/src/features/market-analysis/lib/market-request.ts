import type { NormalizedMarketRequest } from "@rz-chain-reporter/contracts";

import type { StateMarkState } from "@/components/common/state-mark";

import type {
  MarketAnalysisCoreProjection,
  MarketAnalysisOptionsProjection,
  MarketComparisonProjection,
} from "../schemas/reads";

const BINANCE_QUOTE_ASSET = "USDT";

export function configuredInstruments(
  options: MarketAnalysisOptionsProjection,
) {
  const configuredKeys = new Set(
    options.brandInstruments.map((mapping) => mapping.instrumentKey),
  );
  return options.instruments.filter((instrument) =>
    configuredKeys.has(instrument.key),
  );
}

export function mergeComparisons(
  seeded: readonly MarketComparisonProjection[],
  extra: readonly MarketComparisonProjection[],
) {
  const byIdentity = new Map<string, MarketComparisonProjection>();
  for (const entry of seeded) byIdentity.set(entry.canonicalIdentity, entry);
  for (const entry of extra) byIdentity.set(entry.canonicalIdentity, entry);
  return [...byIdentity.values()];
}

export function comparisonsFromRequest(request: NormalizedMarketRequest) {
  return request.series.flatMap((series) =>
    series.role === "comparison"
      ? [
          {
            baseAsset: series.symbol.endsWith(BINANCE_QUOTE_ASSET)
              ? series.symbol.slice(0, -BINANCE_QUOTE_ASSET.length)
              : series.symbol,
            canonicalIdentity: series.descriptorIdentity,
            displayName: series.displayName,
            quoteAsset: BINANCE_QUOTE_ASSET,
            symbol: series.symbol,
          },
        ]
      : [],
  );
}

type MarketSetupStatus =
  | "idle"
  | "fetching"
  | "verified"
  | "partial"
  | "failed";

export const MARKET_SETUP_STATUS_MARKS: Record<
  MarketSetupStatus,
  StateMarkState
> = {
  idle: "queued",
  fetching: "running",
  verified: "succeeded",
  partial: "partial",
  failed: "failed",
};

export function marketSetupStatus(
  analysis: Pick<
    MarketAnalysisCoreProjection,
    "currentSnapshot" | "verification"
  >,
  pending = false,
): MarketSetupStatus {
  const lifecycle = analysis.verification?.lifecycle;
  if (
    pending ||
    lifecycle === "queued" ||
    lifecycle === "running" ||
    lifecycle === "settling"
  ) {
    return "fetching";
  }
  const status = analysis.currentSnapshot?.status;
  if (status === "verified") return "verified";
  if (status === "partial") return "partial";
  if (
    lifecycle === "failed" ||
    lifecycle === "cancelled" ||
    lifecycle === "unknown"
  ) {
    return "failed";
  }
  return "idle";
}
