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
  data: z.object({
    quotes: z.array(
      z.object({
        quote: z.object({ USD: z.object({ price: z.number().positive() }) }),
        timestamp: z.iso.datetime(),
      }),
    ),
  }),
});
export function createCoinMarketCapAdapter(
  transport: MarketTransport,
  binding: MarketProviderBinding,
): MarketProviderAdapter {
  return {
    provider: "coinmarketcap",
    async fetchSeries(request) {
      const apiKey = requiredApiKey(binding);
      if (request.mapping.kind !== "coinmarketcap_coin") {
        throw new MarketProviderError("VALIDATION_FAILED", "permanent");
      }
      const end = request.requestedAt.getTime();
      const url = new URL(
        "/v2/cryptocurrency/quotes/historical",
        "https://pro-api.coinmarketcap.com",
      );
      url.searchParams.set("id", String(request.mapping.coinId));
      url.searchParams.set(
        "time_start",
        new Date(
          end - periodMilliseconds(request.period) - 86_400_000,
        ).toISOString(),
      );
      url.searchParams.set("time_end", request.requestedAt.toISOString());
      url.searchParams.set(
        "interval",
        request.period === "24h" || request.period === "7d" ? "1h" : "1d",
      );
      url.searchParams.set("convert", "USD");
      const body = parseProviderJson(
        await transport({
          credentialedRedirects: "reject",
          headers: { "X-CMC_PRO_API_KEY": apiKey },
          maxDecodedBytes: MARKET_RESPONSE_LIMIT,
          mimeAllowlist: JSON_MIME,
          timeoutMs: MARKET_TIMEOUT_MS,
          url: url.href,
        }),
        responseSchema,
      );
      return {
        attributionIdentity: binding.attributionIdentity,
        points: body.data.quotes.map(
          (quote) =>
            [Date.parse(quote.timestamp), quote.quote.USD.price] as const,
        ),
        provider: "coinmarketcap",
        providerReference: String(request.mapping.coinId),
      };
    },
  };
}
