import { z } from "zod";
import {
  type MarketCatalogAdapter,
  type MarketProviderAdapter,
  type MarketProviderBinding,
  MarketProviderError,
  type MarketTransport,
} from "../types";
import { periodMilliseconds } from "../window";
import {
  JSON_MIME,
  MARKET_RESPONSE_LIMIT,
  MARKET_TIMEOUT_MS,
  parseProviderJson,
} from "./shared";

const BASE_URL = "https://data-api.binance.vision";
const CATALOG_RESPONSE_LIMIT = 4_000_000;
const klineSchema = z.array(
  z
    .tuple([z.number(), z.string(), z.string(), z.string(), z.string()])
    .rest(z.unknown()),
);
const exchangeInfoSchema = z.object({
  symbols: z.array(
    z.object({
      baseAsset: z.string().min(1),
      quoteAsset: z.string().min(1),
      status: z.string().min(1),
      symbol: z.string().min(1),
    }),
  ),
});
export function createBinanceAdapter(
  transport: MarketTransport,
  binding: MarketProviderBinding,
  geoAllowed: boolean,
): MarketProviderAdapter & MarketCatalogAdapter {
  const assertAvailable = () => {
    if (!binding.enabled || !geoAllowed) {
      throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
    }
  };
  return {
    provider: "binance",
    async fetchCatalog() {
      assertAvailable();
      const url = new URL("/api/v3/exchangeInfo", BASE_URL);
      url.searchParams.set("showPermissionSets", "false");
      url.searchParams.set("symbolStatus", "TRADING");
      const body = parseProviderJson(
        await transport({
          maxDecodedBytes: CATALOG_RESPONSE_LIMIT,
          mimeAllowlist: JSON_MIME,
          timeoutMs: MARKET_TIMEOUT_MS,
          url: url.href,
        }),
        exchangeInfoSchema,
      );
      return body.symbols
        .filter(
          (entry) => entry.status === "TRADING" && entry.quoteAsset === "USDT",
        )
        .map((entry) => ({
          baseAsset: entry.baseAsset,
          canonicalIdentity: `binance:${entry.symbol}`,
          displayName: `${entry.baseAsset}/${entry.quoteAsset}`,
          provider: "binance" as const,
          providerMetadata: { quoteAsset: entry.quoteAsset },
          quoteAsset: entry.quoteAsset,
          symbol: entry.symbol,
          tradingStatus: entry.status,
        }));
    },
    async fetchSeries(request) {
      assertAvailable();
      if (request.mapping.kind !== "binance_pair") {
        throw new MarketProviderError("VALIDATION_FAILED", "permanent");
      }
      const end = request.requestedAt.getTime();
      const url = new URL("/api/v3/klines", BASE_URL);
      url.searchParams.set("symbol", request.mapping.pair);
      url.searchParams.set(
        "interval",
        request.period === "24h" || request.period === "7d" ? "1h" : "1d",
      );
      url.searchParams.set(
        "startTime",
        String(end - periodMilliseconds(request.period) - 86_400_000),
      );
      url.searchParams.set("endTime", String(end));
      url.searchParams.set("limit", "1000");
      const body = parseProviderJson(
        await transport({
          maxDecodedBytes: MARKET_RESPONSE_LIMIT,
          mimeAllowlist: JSON_MIME,
          timeoutMs: MARKET_TIMEOUT_MS,
          url: url.href,
        }),
        klineSchema,
      );
      return {
        attributionIdentity: binding.attributionIdentity,
        points: body.map((entry) => [entry[0], Number(entry[4])] as const),
        provider: "binance",
        providerReference: request.mapping.pair,
      };
    },
  };
}
