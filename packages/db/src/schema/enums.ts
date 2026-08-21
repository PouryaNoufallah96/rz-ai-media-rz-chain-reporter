import {
  ATTEMPT_OUTCOMES,
  MEDIA_ASSET_LIFECYCLES,
  MODEL_BACKENDS,
  OPERATION_LIFECYCLES,
  PLATFORMS,
  SCHEDULE_STATUSES,
  SOURCE_ORIGINS,
  USAGE_API_KINDS,
  USAGE_COST_AUTHORITIES,
  USAGE_PROVIDER_GATEWAYS,
  USAGE_SOURCES,
  USAGE_STATUSES,
} from "@rz-chain-reporter/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const contentLocale = pgEnum("content_locale", ["en", "fa"]);

export const platform = pgEnum("platform", PLATFORMS);

export const sourceOrigin = pgEnum("source_origin", SOURCE_ORIGINS);

export const analysisRunKind = pgEnum("analysis_run_kind", ["news", "promo"]);

export const filterDisposition = pgEnum("filter_disposition", [
  "rejected",
  "scored",
  "clustered",
  "routed",
]);

export const mediaAssetLifecycle = pgEnum(
  "media_asset_lifecycle",
  MEDIA_ASSET_LIFECYCLES,
);

export const operationLifecycle = pgEnum(
  "operation_lifecycle",
  OPERATION_LIFECYCLES,
);

export const attemptOutcome = pgEnum("attempt_outcome", ATTEMPT_OUTCOMES);

export const modelBackend = pgEnum("model_backend", MODEL_BACKENDS);

export const usageApiKind = pgEnum("usage_api_kind", USAGE_API_KINDS);

export const usageProviderGateway = pgEnum(
  "usage_provider_gateway",
  USAGE_PROVIDER_GATEWAYS,
);

export const usageStatus = pgEnum("usage_status", USAGE_STATUSES);

export const usageCostAuthority = pgEnum(
  "usage_cost_authority",
  USAGE_COST_AUTHORITIES,
);

export const usageSource = pgEnum("usage_source", USAGE_SOURCES);

export const scheduleStatus = pgEnum("schedule_status", SCHEDULE_STATUSES);
