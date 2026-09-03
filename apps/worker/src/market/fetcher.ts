import type {
  ErrorCode,
  MarketComparisonProvider,
  MarketProvider,
  MarketProviderMapping,
} from "@rz-chain-reporter/contracts";
import type { SafeHttpFailure } from "../fetch/safe-http";
import { SafeHttpError, safeFetch } from "../fetch/safe-http";
import { createBinanceAdapter } from "./adapters/binance";
import { createCoinGeckoAdapter } from "./adapters/coingecko";
import { createCoinGeckoOnchainAdapter } from "./adapters/coingecko-onchain";
import { createCoinMarketCapAdapter } from "./adapters/coinmarketcap";
import { createCoinMarketCapPublicAdapter } from "./adapters/coinmarketcap-public";
import {
  type MarketCatalogAdapter,
  type MarketProviderAdapter,
  type MarketProviderBindings,
  MarketProviderError,
  type MarketSeriesOutcome,
  type MarketTransport,
  type RequestedSeries,
} from "./types";
import {
  clipToWindow,
  coverageWarnings,
  periodMilliseconds,
  summarizeObservedSeries,
} from "./window";

const defaultTransport: MarketTransport = async (request) => safeFetch(request);
const TRANSPORT_FAILURES: Record<
  SafeHttpFailure,
  {
    failureCode: ErrorCode;
    retryClassification: "permanent" | "retryable";
    warning: string;
  }
> = {
  deadline: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "retryable",
    warning: "provider_unavailable",
  },
  fetch_failed: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "retryable",
    warning: "provider_unavailable",
  },
  redirect_blocked: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "permanent",
    warning: "provider_unavailable",
  },
  retry_after: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "retryable",
    warning: "provider_rate_limited",
  },
  ssrf_blocked: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "permanent",
    warning: "provider_unavailable",
  },
  too_large: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "permanent",
    warning: "provider_unavailable",
  },
  unsupported_mime: {
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    retryClassification: "permanent",
    warning: "provider_unavailable",
  },
};
export function classifyFetchFailure(error: unknown): {
  error: MarketProviderError;
  warnings: readonly string[];
} {
  if (error instanceof MarketProviderError) return { error, warnings: [] };
  if (error instanceof SafeHttpError) {
    const transport = TRANSPORT_FAILURES[error.reason];
    return {
      error: new MarketProviderError(
        transport.failureCode,
        transport.retryClassification,
        { cause: error, retryAfterSeconds: error.retryAfterSeconds },
      ),
      warnings: [transport.warning],
    };
  }
  return {
    error: new MarketProviderError("TRANSIENT_CONFLICT", "retryable", {
      cause: error,
    }),
    warnings: [],
  };
}
export function createMarketAdapters(
  bindings: MarketProviderBindings,
  transport: MarketTransport = defaultTransport,
) {
  const binance = createBinanceAdapter(
    transport,
    bindings.binance,
    bindings.binanceGeoAllowed,
  );
  const adapters: Record<MarketProvider, MarketProviderAdapter> = {
    binance,
    coingecko: createCoinGeckoAdapter(transport, bindings.coingecko),
    coingecko_onchain: createCoinGeckoOnchainAdapter(
      transport,
      bindings.coingecko_onchain,
    ),
    coinmarketcap: createCoinMarketCapAdapter(
      transport,
      bindings.coinmarketcap,
    ),
    coinmarketcap_public: createCoinMarketCapPublicAdapter(
      transport,
      bindings.coinmarketcap_public,
    ),
  };
  const catalogs: Record<MarketComparisonProvider, MarketCatalogAdapter> = {
    binance,
  };
  return { adapters, catalogs };
}
export async function fetchMarketSeries(
  adapters: Record<MarketProvider, MarketProviderAdapter>,
  series: RequestedSeries,
  period: Parameters<MarketProviderAdapter["fetchSeries"]>[0]["period"],
  requestedAt: Date,
): Promise<MarketSeriesOutcome> {
  const attemptedMappings: MarketProviderMapping[] = [];
  type ClassifiedFailure = ReturnType<typeof classifyFetchFailure>;
  let lastFailure: ClassifiedFailure | null = null;
  let retryableFailure: ClassifiedFailure | null = null;
  for (const [position, mapping] of series.providerMappings.entries()) {
    if (position > 0 && !mapping.fallback) continue;
    attemptedMappings.push(mapping);
    try {
      const response = await adapters[mapping.provider].fetchSeries({
        mapping,
        period,
        requestedAt,
      });
      const windowStart = requestedAt.getTime() - periodMilliseconds(period);
      const windowEnd = requestedAt.getTime();
      const clipped = clipToWindow(response.points, windowStart, windowEnd);
      const summarized = summarizeObservedSeries(clipped, {
        attemptedMappings,
        attributionIdentity: response.attributionIdentity,
        mapping,
        provider: response.provider,
        providerReference: response.providerReference,
        warnings: [
          ...(response.warnings ?? []),
          ...(position > 0 ? ["fallback_mapping_used"] : []),
          ...(clipped.length < response.points.length
            ? ["window_clipped"]
            : []),
          ...coverageWarnings(clipped, windowStart, windowEnd),
        ],
      });
      if (summarized.outcome === "succeeded") return summarized;
      lastFailure = {
        error: new MarketProviderError(
          summarized.failureCode,
          summarized.retryClassification,
        ),
        warnings: summarized.warnings,
      };
    } catch (error) {
      lastFailure = classifyFetchFailure(error);
      if (lastFailure.error.retryClassification === "retryable") {
        retryableFailure = lastFailure;
      }
    }
  }
  const failure = retryableFailure ?? lastFailure;
  return {
    attemptedMappings,
    failureCode: failure?.error.failureCode ?? "MARKET_SERIES_UNAVAILABLE",
    outcome: "failed",
    retryAfterSeconds: failure?.error.retryAfterSeconds ?? null,
    retryClassification: failure?.error.retryClassification ?? "permanent",
    warnings: failure?.warnings ?? [],
  };
}
