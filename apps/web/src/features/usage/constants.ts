import { USAGE_PROVIDER_GATEWAYS } from "@rz-chain-reporter/contracts";

export const USAGE_NAMESPACE = "usage" as const;

export const USAGE_PERIODS = ["24h", "7d", "30d", "all"] as const;
export const USAGE_PROVIDERS = [...USAGE_PROVIDER_GATEWAYS, "unknown"] as const;
export const USAGE_PAGE_SIZE = 20;
