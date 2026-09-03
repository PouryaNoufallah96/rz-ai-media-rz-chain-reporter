import assert from "node:assert/strict";
import type { MarketProviderMapping } from "@rz-chain-reporter/contracts";
import { createMarketAdapters, fetchMarketSeries } from "./fetcher";
import { classifyMarketSnapshot, ownsVerificationIntent } from "./outcome";
import type { MarketTransport, RequestedSeries } from "./types";
import { alignToCommonWindow, effectiveCommonWindow } from "./window";

const end = Date.parse("2026-09-01T12:00:00.000Z");
const observed = [end - 86_400_000, end] as const;
const requests: string[] = [];
const publicQueries: { interval: string; limit: string }[] = [];
const transport: MarketTransport = async (request) => {
  requests.push(request.url);
  const url = new URL(request.url);
  assert.equal(
    request.credentialedRedirects,
    url.hostname === "data-api.binance.vision" ? undefined : "reject",
  );
  let body: unknown;
  if (url.pathname.endsWith("/klines")) {
    assert.equal(url.searchParams.get("symbol"), "BTCUSDT");
    body = observed.map((timestamp, index) => [
      timestamp,
      "0",
      "0",
      "0",
      String(index + 10),
    ]);
  } else if (url.pathname.includes("quotes/historical")) {
    assert.equal(url.searchParams.get("id"), "1");
    body = {
      data: {
        quotes: observed.map((timestamp, index) => ({
          timestamp: new Date(timestamp).toISOString(),
          quote: { USD: { price: index + 20 } },
        })),
      },
    };
  } else if (url.pathname.includes("/public-api/v1/k-line/points")) {
    assert.equal(url.searchParams.get("platform"), "bsc");
    assert.equal(url.searchParams.get("address"), "0xfixture");
    assert.equal(url.searchParams.get("unit"), "usd");
    assert.equal(url.searchParams.get("pm"), "p");
    assert.equal(url.searchParams.get("from"), null);
    assert.equal(url.searchParams.get("to"), null);
    assert.equal(request.headers?.["X-CMC_PRO_API_KEY"], undefined);
    publicQueries.push({
      interval: url.searchParams.get("interval") ?? "",
      limit: url.searchParams.get("limit") ?? "",
    });
    body = {
      status: { error_code: 0 },
      data: observed.map((timestamp, index) => [index + 25, 0, timestamp]),
    };
  } else if (url.pathname.includes("market_chart/range")) {
    assert.match(url.pathname, /\/coins\/bitcoin\//u);
    body = {
      prices: observed.map((timestamp, index) => [timestamp, index + 30]),
    };
  } else if (url.pathname.includes("/ohlcv/")) {
    assert.equal(url.searchParams.has("include_empty_intervals"), false);
    body = {
      data: {
        attributes: {
          ohlcv_list: observed.map((timestamp, index) => [
            timestamp / 1_000,
            0,
            0,
            0,
            index + 40,
            0,
          ]),
        },
      },
    };
  } else if (url.pathname.endsWith("/exchangeInfo")) {
    body = {
      symbols: [
        {
          baseAsset: "BTC",
          quoteAsset: "USDT",
          status: "TRADING",
          symbol: "BTCUSDT",
        },
      ],
    };
  } else {
    throw new Error(`unexpected fixture request ${url.pathname}`);
  }
  return { status: 200, text: JSON.stringify(body), url: request.url };
};

const bindings = {
  binance: { enabled: true, attributionIdentity: "Binance" },
  coinmarketcap: {
    enabled: true,
    apiKey: "fixture",
    attributionIdentity: "CoinMarketCap",
  },
  coinmarketcap_public: {
    enabled: true,
    attributionIdentity: "CoinMarketCap Public Market Data",
  },
  coingecko: {
    enabled: true,
    apiKey: "fixture",
    attributionIdentity: "CoinGecko",
  },
  coingecko_onchain: {
    enabled: true,
    apiKey: "fixture",
    attributionIdentity: "CoinGecko Onchain",
  },
  binanceGeoAllowed: true,
};
const { adapters, catalogs } = createMarketAdapters(bindings, transport);
const mappings: MarketProviderMapping[] = [
  {
    kind: "binance_pair",
    provider: "binance",
    pair: "BTCUSDT",
    fallback: false,
  },
  {
    kind: "coinmarketcap_coin",
    provider: "coinmarketcap",
    coinId: 1,
    fallback: false,
  },
  {
    kind: "coinmarketcap_public_kline",
    provider: "coinmarketcap_public",
    platform: "bsc",
    address: "0xfixture",
    fallback: false,
  },
  {
    kind: "coingecko_coin",
    provider: "coingecko",
    coinId: "bitcoin",
    fallback: false,
  },
  {
    kind: "onchain_pool",
    provider: "coingecko_onchain",
    network: "eth",
    contract: "0xabc",
    pool: "0xpool",
    tokenSide: "base",
    fallback: false,
  },
];
const requested: RequestedSeries[] = mappings.map((mapping, index) => ({
  controlledInstrumentId: null,
  descriptorIdentity: `fixture:${mapping.provider}`,
  displayName: mapping.provider,
  providerMappings: [mapping],
  role: index === 0 ? "primary" : "comparison",
  symbol: `S${index}`,
}));
const outcomes = await Promise.all(
  requested.map((series) =>
    fetchMarketSeries(adapters, series, "24h", new Date(end)),
  ),
);
assert.ok(outcomes.every((outcome) => outcome.outcome === "succeeded"));
assert.equal(classifyMarketSnapshot(requested, outcomes), "verified");
assert.ok(effectiveCommonWindow(outcomes));
const firstSuccess = outcomes[0];
const secondSuccess = outcomes[1];
assert.ok(
  firstSuccess?.outcome === "succeeded" &&
    secondSuccess?.outcome === "succeeded",
);
const shifted = {
  ...secondSuccess,
  coverageStart: new Date(end),
  points: secondSuccess.points.slice(-1),
};
assert.equal(
  alignToCommonWindow([firstSuccess, shifted]).outcomes[0]?.outcome,
  "failed",
);
assert.equal((await catalogs.binance.fetchCatalog()).length, 1);

for (const period of ["24h", "7d", "30d", "90d", "1y"] as const) {
  await adapters.coinmarketcap_public.fetchSeries({
    mapping: {
      kind: "coinmarketcap_public_kline",
      provider: "coinmarketcap_public",
      platform: "bsc",
      address: "0xfixture",
      fallback: false,
    },
    period,
    requestedAt: new Date(end),
  });
}
assert.deepEqual(publicQueries.slice(-5), [
  { interval: "15min", limit: "100" },
  { interval: "1h", limit: "170" },
  { interval: "4h", limit: "182" },
  { interval: "12h", limit: "182" },
  { interval: "1d", limit: "367" },
]);

const fallbackMapping: MarketProviderMapping[] = [
  {
    kind: "coinmarketcap_public_kline",
    provider: "coinmarketcap_public",
    platform: "bsc",
    address: "0xfixture",
    fallback: false,
  },
  {
    kind: "onchain_pool",
    provider: "coingecko_onchain",
    network: "bsc",
    contract: "0xabc",
    pool: "0xpool",
    tokenSide: "base",
    fallback: true,
  },
];
const fallbackSeries: RequestedSeries = {
  controlledInstrumentId: null,
  descriptorIdentity: "fixture:public-fallback",
  displayName: "Public fallback",
  providerMappings: fallbackMapping,
  role: "primary",
  symbol: "PUBLIC",
};
for (const publicFailure of ["status", "malformed", "insufficient"] as const) {
  const fallbackTransport: MarketTransport = async (request) => {
    const url = new URL(request.url);
    if (url.hostname === "pro-api.coinmarketcap.com") {
      const body =
        publicFailure === "status"
          ? { status: { error_code: 1001 }, data: [] }
          : publicFailure === "malformed"
            ? { data: { unexpected: true } }
            : {
                status: { error_code: 0 },
                data: [[1, 0, end]],
              };
      return { status: 200, text: JSON.stringify(body), url: request.url };
    }
    return {
      status: 200,
      text: JSON.stringify({
        data: {
          attributes: {
            ohlcv_list: observed.map((timestamp, index) => [
              timestamp / 1_000,
              0,
              0,
              0,
              index + 40,
              0,
            ]),
          },
        },
      }),
      url: request.url,
    };
  };
  const fallbackAdapters = createMarketAdapters(bindings, fallbackTransport);
  const fallbackOutcome = await fetchMarketSeries(
    fallbackAdapters.adapters,
    fallbackSeries,
    "24h",
    new Date(end),
  );
  assert.equal(fallbackOutcome.outcome, "succeeded");
  if (fallbackOutcome.outcome === "succeeded") {
    assert.equal(fallbackOutcome.provider, "coingecko_onchain");
    assert.deepEqual(fallbackOutcome.attemptedMappings, fallbackMapping);
    assert.ok(fallbackOutcome.warnings.includes("fallback_mapping_used"));
  }
}

const firstMapping = mappings[0];
const firstOutcome = outcomes[0];
assert.ok(firstMapping && firstOutcome);
const failedPrimary = [
  {
    attemptedMappings: [firstMapping],
    failureCode: "MARKET_SERIES_UNAVAILABLE",
    outcome: "failed",
    retryClassification: "permanent",
    warnings: [],
  },
] as const;
assert.equal(
  classifyMarketSnapshot(requested.slice(0, 1), failedPrimary),
  "unverified",
);
assert.equal(
  classifyMarketSnapshot(requested.slice(0, 2), [
    firstOutcome,
    failedPrimary[0],
  ]),
  "partial",
);
assert.equal(
  ownsVerificationIntent(
    { verificationIntentId: "a", verificationIntentVersion: 2 },
    { verificationIntentId: "a", verificationIntentVersion: 2 },
  ),
  true,
);
assert.equal(
  ownsVerificationIntent(
    { verificationIntentId: "b", verificationIntentVersion: 2 },
    { verificationIntentId: "a", verificationIntentVersion: 2 },
  ),
  false,
);
assert.ok(requests.some((url) => url.includes("coinmarketcap.com")));
console.log(
  "market-fixtures providers=5 clipping=pass window=pass partial=pass replay=pass crash-boundary=pass no-symbol-inference=pass include-empty-intervals=absent catalog=pass status=pass",
);
