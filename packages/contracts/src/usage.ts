import { z } from "zod";

export const USAGE_API_KINDS = ["chat", "embedding", "image"] as const;

export type UsageApiKind = (typeof USAGE_API_KINDS)[number];

export const usageApiKindSchema = z.enum(USAGE_API_KINDS);

export const USAGE_PROVIDER_GATEWAYS = ["openrouter", "ollama"] as const;

export type UsageProviderGateway = (typeof USAGE_PROVIDER_GATEWAYS)[number];

export const usageProviderGatewaySchema = z.enum(USAGE_PROVIDER_GATEWAYS);

export const USAGE_STATUSES = [
  "pending",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type UsageStatus = (typeof USAGE_STATUSES)[number];

export const usageStatusSchema = z.enum(USAGE_STATUSES);

export const USAGE_COST_AUTHORITIES = [
  "billed_openrouter",
  "estimated_openrouter",
  "local",
  "unknown",
] as const;

export type UsageCostAuthority = (typeof USAGE_COST_AUTHORITIES)[number];

export const usageCostAuthoritySchema = z.enum(USAGE_COST_AUTHORITIES);

export const USAGE_SOURCES = ["inline", "generation_reconciled"] as const;

export type UsageSource = (typeof USAGE_SOURCES)[number];

export const usageSourceSchema = z.enum(USAGE_SOURCES);
