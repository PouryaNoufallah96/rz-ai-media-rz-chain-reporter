import type { z } from "zod";
import { MarketProviderError, type MarketTransportResponse } from "../types";

export const JSON_MIME = ["application/json"] as const;
export const MARKET_RESPONSE_LIMIT = 2_000_000;
export const MARKET_TIMEOUT_MS = 15_000;
export function parseProviderJson<T>(
  response: MarketTransportResponse,
  schema: z.ZodType<T>,
) {
  if (response.status === 401 || response.status === 403) {
    throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
  }
  if (response.status === 429 || response.status >= 500) {
    throw new MarketProviderError("TRANSIENT_CONFLICT", "retryable");
  }
  if (response.status < 200 || response.status >= 300) {
    throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
  }
  let body: unknown;
  try {
    body = JSON.parse(response.text);
  } catch {
    throw new MarketProviderError("VALIDATION_FAILED", "permanent");
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) return parsed.data;
  throw new MarketProviderError("VALIDATION_FAILED", "permanent");
}
export function requiredApiKey(binding: { apiKey?: string; enabled: boolean }) {
  if (!binding.enabled || !binding.apiKey) {
    throw new MarketProviderError("MARKET_SERIES_UNAVAILABLE", "permanent");
  }
  return binding.apiKey;
}
