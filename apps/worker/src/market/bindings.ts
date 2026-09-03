import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import type { WorkerEnv } from "../runtime/env";
import type { MarketProviderBindings } from "./types";

export class MarketProviderBindingError extends Error {
  readonly code = "MARKET_PROVIDER_BINDING_MISSING";
  constructor(readonly missing: readonly string[]) {
    super(`missing market provider bindings: ${missing.join(", ")}`);
    this.name = "MarketProviderBindingError";
  }
}

export function resolveMarketProviderBindings(
  template: CustomerTemplate,
  env: WorkerEnv,
): MarketProviderBindings {
  const used = new Set(
    template.marketAnalysis.enabled
      ? template.marketAnalysis.instruments
          .filter((instrument) => instrument.enabled)
          .flatMap((instrument) =>
            instrument.providerMappings.map((mapping) => mapping.provider),
          )
      : [],
  );
  if (template.marketAnalysis.enabled)
    used.add(template.marketAnalysis.comparisonProvider);
  const missing: string[] = [];
  const requireProvider = (
    provider: "binance" | "coinmarketcap" | "coinmarketcap_public",
    enabled: boolean,
    enabledName: string,
    attribution: string | undefined,
    attributionName: string,
  ) => {
    if (!used.has(provider)) return;
    if (!enabled) missing.push(enabledName);
    if (!attribution) missing.push(attributionName);
  };
  requireProvider(
    "binance",
    env.MARKET_BINANCE_ENABLED,
    "MARKET_BINANCE_ENABLED",
    env.MARKET_BINANCE_ATTRIBUTION_IDENTITY,
    "MARKET_BINANCE_ATTRIBUTION_IDENTITY",
  );
  if (used.has("binance") && !env.MARKET_BINANCE_GEO_ALLOWED)
    missing.push("MARKET_BINANCE_GEO_ALLOWED");
  requireProvider(
    "coinmarketcap",
    env.MARKET_COINMARKETCAP_ENABLED,
    "MARKET_COINMARKETCAP_ENABLED",
    env.MARKET_COINMARKETCAP_ATTRIBUTION_IDENTITY,
    "MARKET_COINMARKETCAP_ATTRIBUTION_IDENTITY",
  );
  if (used.has("coinmarketcap") && !env.COINMARKETCAP_API_KEY)
    missing.push("COINMARKETCAP_API_KEY");
  requireProvider(
    "coinmarketcap_public",
    env.MARKET_COINMARKETCAP_PUBLIC_ENABLED,
    "MARKET_COINMARKETCAP_PUBLIC_ENABLED",
    env.MARKET_COINMARKETCAP_PUBLIC_ATTRIBUTION_IDENTITY,
    "MARKET_COINMARKETCAP_PUBLIC_ATTRIBUTION_IDENTITY",
  );
  const geckoUsed = used.has("coingecko") || used.has("coingecko_onchain");
  if (geckoUsed && !env.MARKET_COINGECKO_ENABLED)
    missing.push("MARKET_COINGECKO_ENABLED");
  if (geckoUsed && !env.MARKET_COINGECKO_ATTRIBUTION_IDENTITY)
    missing.push("MARKET_COINGECKO_ATTRIBUTION_IDENTITY");
  if (geckoUsed && !env.COINGECKO_API_KEY) missing.push("COINGECKO_API_KEY");
  if (missing.length > 0)
    throw new MarketProviderBindingError([...new Set(missing)]);
  return {
    binance: {
      enabled: env.MARKET_BINANCE_ENABLED,
      attributionIdentity: env.MARKET_BINANCE_ATTRIBUTION_IDENTITY ?? "unbound",
    },
    coinmarketcap: {
      enabled: env.MARKET_COINMARKETCAP_ENABLED,
      apiKey: env.COINMARKETCAP_API_KEY,
      attributionIdentity:
        env.MARKET_COINMARKETCAP_ATTRIBUTION_IDENTITY ?? "unbound",
    },
    coinmarketcap_public: {
      enabled: env.MARKET_COINMARKETCAP_PUBLIC_ENABLED,
      attributionIdentity:
        env.MARKET_COINMARKETCAP_PUBLIC_ATTRIBUTION_IDENTITY ?? "unbound",
    },
    coingecko: {
      enabled: env.MARKET_COINGECKO_ENABLED,
      apiKey: env.COINGECKO_API_KEY,
      attributionIdentity:
        env.MARKET_COINGECKO_ATTRIBUTION_IDENTITY ?? "unbound",
    },
    coingecko_onchain: {
      enabled: env.MARKET_COINGECKO_ENABLED,
      apiKey: env.COINGECKO_API_KEY,
      attributionIdentity:
        env.MARKET_COINGECKO_ATTRIBUTION_IDENTITY ?? "unbound",
    },
    binanceGeoAllowed: env.MARKET_BINANCE_GEO_ALLOWED,
  };
}
