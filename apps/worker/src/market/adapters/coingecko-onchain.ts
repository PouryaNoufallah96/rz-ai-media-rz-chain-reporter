import type { MarketProviderMapping } from "@rz-chain-reporter/contracts";
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
  requiredApiKey,
} from "./shared";

const BASE_URL = "https://pro-api.coingecko.com";
const poolSchema = z.object({
  data: z.array(
    z.object({
      attributes: z.object({
        address: z.string().min(1),
        reserve_in_usd: z.string().nullable().optional(),
      }),
      relationships: z.object({
        base_token: z.object({ data: z.object({ id: z.string().min(1) }) }),
        quote_token: z.object({ data: z.object({ id: z.string().min(1) }) }),
      }),
    }),
  ),
});
const ohlcvSchema = z.object({
  data: z.object({
    attributes: z.object({
      ohlcv_list: z.array(
        z.tuple([
          z.number(),
          z.number(),
          z.number(),
          z.number(),
          z.number().positive(),
          z.number(),
        ]),
      ),
    }),
  }),
});
function selectOnchainPool(
  body: z.infer<typeof poolSchema>,
  mapping: Extract<MarketProviderMapping, { kind: "onchain_token" }>,
) {
  const suffix = `_${mapping.contract.toLowerCase()}`;
  const selected = body.data
    .filter((pool) =>
      [
        pool.relationships.base_token.data.id,
        pool.relationships.quote_token.data.id,
      ].some((id) => id.toLowerCase().endsWith(suffix)),
    )
    .sort((left, right) => {
      const reserve =
        Number(right.attributes.reserve_in_usd ?? 0) -
        Number(left.attributes.reserve_in_usd ?? 0);
      return (
        reserve ||
        left.attributes.address.localeCompare(right.attributes.address)
      );
    })[0];
  if (!selected) {
    throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
  }
  return {
    pool: selected.attributes.address,
    tokenSide: selected.relationships.base_token.data.id
      .toLowerCase()
      .endsWith(suffix)
      ? ("base" as const)
      : ("quote" as const),
  };
}
export function createCoinGeckoOnchainAdapter(
  transport: MarketTransport,
  binding: MarketProviderBinding,
): MarketProviderAdapter {
  const send = (url: URL) =>
    transport({
      credentialedRedirects: "reject",
      headers: { "x-cg-pro-api-key": requiredApiKey(binding) },
      maxDecodedBytes: MARKET_RESPONSE_LIMIT,
      mimeAllowlist: JSON_MIME,
      timeoutMs: MARKET_TIMEOUT_MS,
      url: url.href,
    });
  return {
    provider: "coingecko_onchain",
    async fetchSeries(request) {
      const mapping = request.mapping;
      if (mapping.provider !== "coingecko_onchain") {
        throw new MarketProviderError("VALIDATION_FAILED", "permanent");
      }
      const resolved =
        mapping.kind === "onchain_pool"
          ? { pool: mapping.pool, tokenSide: mapping.tokenSide }
          : selectOnchainPool(
              parseProviderJson(
                await send(
                  new URL(
                    `/api/v3/onchain/networks/${encodeURIComponent(mapping.network)}/tokens/${encodeURIComponent(mapping.contract)}/pools`,
                    BASE_URL,
                  ),
                ),
                poolSchema,
              ),
              mapping,
            );
      const timeframe =
        request.period === "24h" || request.period === "7d" ? "hour" : "day";
      const url = new URL(
        `/api/v3/onchain/networks/${encodeURIComponent(mapping.network)}/pools/${encodeURIComponent(resolved.pool)}/ohlcv/${timeframe}`,
        BASE_URL,
      );
      url.searchParams.set("aggregate", "1");
      url.searchParams.set(
        "before_timestamp",
        String(Math.floor(request.requestedAt.getTime() / 1_000) + 1),
      );
      url.searchParams.set("limit", "1000");
      url.searchParams.set("currency", "usd");
      url.searchParams.set("token", resolved.tokenSide);
      const body = parseProviderJson(await send(url), ohlcvSchema);
      return {
        attributionIdentity: binding.attributionIdentity,
        points: body.data.attributes.ohlcv_list.map(
          (entry) => [entry[0] * 1_000, entry[4]] as const,
        ),
        provider: "coingecko_onchain",
        providerReference: `${mapping.network}:${resolved.pool}:${resolved.tokenSide}`,
      };
    },
  };
}
