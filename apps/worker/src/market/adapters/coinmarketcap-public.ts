import { z } from "zod";
import {
  type MarketProviderAdapter,
  type MarketProviderBinding,
  MarketProviderError,
  type MarketTransport,
} from "../types";
import {
  JSON_MIME,
  MARKET_RESPONSE_LIMIT,
  MARKET_TIMEOUT_MS,
  parseProviderJson,
} from "./shared";

const queries = {
  "24h": { interval: "15min", limit: 100 },
  "7d": { interval: "1h", limit: 170 },
  "30d": { interval: "4h", limit: 182 },
  "90d": { interval: "12h", limit: 182 },
  "1y": { interval: "1d", limit: 367 },
} as const;

const responseSchema = z.object({
  status: z
    .object({
      error_code: z.union([z.number(), z.string()]).nullish(),
    })
    .optional(),
  data: z.array(z.array(z.unknown()).min(3)),
});

export function createCoinMarketCapPublicAdapter(
  transport: MarketTransport,
  binding: MarketProviderBinding,
): MarketProviderAdapter {
  return {
    provider: "coinmarketcap_public",
    async fetchSeries(request) {
      if (!binding.enabled) {
        throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
      }
      if (request.mapping.kind !== "coinmarketcap_public_kline") {
        throw new MarketProviderError("VALIDATION_FAILED", "permanent");
      }

      const query = queries[request.period];
      const url = new URL(
        "/public-api/v1/k-line/points",
        "https://pro-api.coinmarketcap.com",
      );
      url.searchParams.set("platform", request.mapping.platform);
      url.searchParams.set("address", request.mapping.address);
      url.searchParams.set("interval", query.interval);
      url.searchParams.set("unit", "usd");
      url.searchParams.set("limit", String(query.limit));
      url.searchParams.set("pm", "p");

      const body = parseProviderJson(
        await transport({
          credentialedRedirects: "reject",
          headers: {
            Accept: "application/json",
            "User-Agent": "ChainReporter/1.0 market-analytics",
          },
          maxDecodedBytes: MARKET_RESPONSE_LIMIT,
          mimeAllowlist: JSON_MIME,
          timeoutMs: MARKET_TIMEOUT_MS,
          url: url.href,
        }),
        responseSchema,
      );

      const errorCode = body.status?.error_code;
      if (
        errorCode !== undefined &&
        errorCode !== null &&
        errorCode !== 0 &&
        errorCode !== "0"
      ) {
        throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
      }

      let droppedPoints = 0;
      const points = body.data
        .flatMap((point) => {
          const price = Number(point[0]);
          const rawTimestamp = Number(point[2]);
          const timestamp =
            rawTimestamp < 10_000_000_000 ? rawTimestamp * 1_000 : rawTimestamp;
          if (
            !Number.isInteger(timestamp) ||
            timestamp <= 0 ||
            timestamp > request.requestedAt.getTime() ||
            !Number.isFinite(price) ||
            price <= 0
          ) {
            droppedPoints += 1;
            return [];
          }
          return [[timestamp, price] as const];
        })
        .sort(([left], [right]) => left - right);

      if (points.length < 2) {
        throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
      }

      return {
        attributionIdentity: binding.attributionIdentity,
        points,
        provider: "coinmarketcap_public",
        providerReference: `${request.mapping.platform}:${request.mapping.address}`,
        warnings:
          droppedPoints > 0 ? ["malformed_provider_points_dropped"] : [],
      };
    },
  };
}
