import type {
  ErrorCode,
  MarketComparisonProvider,
  MarketPeriod,
  MarketProvider,
  MarketProviderMapping,
  MarketSeriesRole,
} from "@rz-chain-reporter/contracts";

import type { SafeHttpRequest } from "../fetch/safe-http";

export type MarketPoint = readonly [timestamp: number, price: number];
export type MarketProviderBinding = {
  apiKey?: string;
  attributionIdentity: string;
  enabled: boolean;
};
export type MarketProviderBindings = Record<
  MarketProvider,
  MarketProviderBinding
> & { binanceGeoAllowed: boolean };
export type MarketSeriesRequest = {
  mapping: MarketProviderMapping;
  period: MarketPeriod;
  requestedAt: Date;
};
export type MarketSeriesResponse = {
  attributionIdentity: string;
  points: readonly MarketPoint[];
  provider: MarketProvider;
  providerReference: string;
  warnings?: readonly string[];
};
export type MarketCatalogEntry = {
  baseAsset: string;
  canonicalIdentity: string;
  displayName: string;
  provider: MarketComparisonProvider;
  quoteAsset: string;
  symbol: string;
  tradingStatus: string;
};
export interface MarketProviderAdapter {
  readonly provider: MarketProvider;
  fetchSeries(request: MarketSeriesRequest): Promise<MarketSeriesResponse>;
}
export interface MarketCatalogAdapter {
  fetchCatalog(): Promise<readonly MarketCatalogEntry[]>;
}
export type MarketTransportRequest = SafeHttpRequest;
export type MarketTransportResponse = {
  status: number;
  text: string;
  url: string;
};
export type MarketTransport = (
  request: MarketTransportRequest,
) => Promise<MarketTransportResponse>;
export type MarketSeriesFailure = {
  attemptedMappings: readonly MarketProviderMapping[];
  failureCode: ErrorCode;
  outcome: "failed";
  retryAfterSeconds?: number | null;
  retryClassification: "permanent" | "retryable";
  warnings: readonly string[];
};
export type MarketSeriesSuccess = {
  attributionIdentity: string;
  attemptedMappings: readonly MarketProviderMapping[];
  changePercent: string;
  coverageEnd: Date;
  coverageStart: Date;
  endPrice: string;
  mapping: MarketProviderMapping;
  outcome: "succeeded";
  points: readonly (readonly [timestamp: string, price: string])[];
  provider: MarketProvider;
  providerReference: string;
  startPrice: string;
  warnings: readonly string[];
};
export type MarketSeriesOutcome = MarketSeriesFailure | MarketSeriesSuccess;
export type RequestedSeries = {
  controlledInstrumentId: string | null;
  descriptorIdentity: string;
  displayName: string;
  providerMappings: readonly MarketProviderMapping[];
  role: MarketSeriesRole;
  symbol: string;
};
export class MarketProviderError extends Error {
  readonly retryAfterSeconds: number | null;
  constructor(
    readonly failureCode: ErrorCode,
    readonly retryClassification: "permanent" | "retryable",
    options: {
      cause?: unknown;
      detail?: readonly string[];
      retryAfterSeconds?: number | null;
    } = {},
  ) {
    super(
      options.detail?.length
        ? `${failureCode} (${options.detail.join(", ")})`
        : failureCode,
      { cause: options.cause },
    );
    this.name = "MarketProviderError";
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
  }
}
