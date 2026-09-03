import { z } from "zod";
import {
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
  requiredApiKey,
} from "./shared";

const responseSchema = z.object({
  prices: z.array(z.tuple([z.number(), z.number().positive()])),
});
export function createCoinGeckoAdapter(
  transport: MarketTransport,
  binding: MarketProviderBinding,
): MarketProviderAdapter {
  return {
    provider: "coingecko",
    async fetchSeries(request) {
      const apiKey = requiredApiKey(binding);
      if (request.mapping.kind !== "coingecko_coin") {
        throw new MarketProviderError("VALIDATION_FAILED", "permanent");
      }
      const end = request.requestedAt.getTime();
      const url = new URL(
        `/api/v3/coins/${encodeURIComponent(request.mapping.coinId)}/market_chart/range`,
        "https://pro-api.coingecko.com",
      );
      url.searchParams.set("vs_currency", "usd");
      url.searchParams.set(
        "from",
        String(
          Math.floor(
            (end - periodMilliseconds(request.period) - 86_400_000) / 1_000,
          ),
        ),
      );
      url.searchParams.set("to", String(Math.floor(end / 1_000)));
      url.searchParams.set("precision", "full");
      const body = parseProviderJson(
        await transport({
          credentialedRedirects: "reject",
          headers: { "x-cg-pro-api-key": apiKey },
          maxDecodedBytes: MARKET_RESPONSE_LIMIT,
          mimeAllowlist: JSON_MIME,
          timeoutMs: MARKET_TIMEOUT_MS,
          url: url.href,
        }),
        responseSchema,
      );
      return {
        attributionIdentity: binding.attributionIdentity,
        points: body.prices,
        provider: "coingecko",
        providerReference: request.mapping.coinId,
      };
    },
  };
}
