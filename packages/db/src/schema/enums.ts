import {
  ADMISSION_OUTCOMES,
  ARTICLE_ADAPTERS,
  ARTICLE_FETCH_MODES,
  ATTEMPT_OUTCOMES,
  CONTENT_LOCALES,
  ENRICHMENT_OUTCOMES,
  ENRICHMENT_REASONS,
  MEDIA_ASSET_LIFECYCLES,
  MODEL_BACKENDS,
  OPERATION_LIFECYCLES,
  PLATFORMS,
  SCHEDULE_STATUSES,
  SOURCE_FETCH_OUTCOMES,
  SOURCE_FETCH_REASONS,
  SOURCE_IMPORT_STAGES,
  SOURCE_ORIGINS,
  TELEGRAM_ORDERING_MODES,
  USAGE_API_KINDS,
  USAGE_COST_AUTHORITIES,
  USAGE_PROVIDER_GATEWAYS,
  USAGE_SOURCES,
  USAGE_STATUSES,
} from "@rz-chain-reporter/contracts";
import { pgEnum } from "drizzle-orm/pg-core";

export const contentLocale = pgEnum("content_locale", CONTENT_LOCALES);

export const platform = pgEnum("platform", PLATFORMS);

export const sourceOrigin = pgEnum("source_origin", SOURCE_ORIGINS);

export const articleFetchMode = pgEnum(
  "article_fetch_mode",
  ARTICLE_FETCH_MODES,
);

export const sourceFetchOutcome = pgEnum(
  "source_fetch_outcome",
  SOURCE_FETCH_OUTCOMES,
);

export const sourceFetchReason = pgEnum(
  "source_fetch_reason",
  SOURCE_FETCH_REASONS,
);

export const admissionOutcome = pgEnum("admission_outcome", ADMISSION_OUTCOMES);

export const enrichmentOutcome = pgEnum(
  "enrichment_outcome",
  ENRICHMENT_OUTCOMES,
);

export const enrichmentReason = pgEnum("enrichment_reason", ENRICHMENT_REASONS);

export const articleAdapter = pgEnum("article_adapter", ARTICLE_ADAPTERS);

export const telegramOrderingMode = pgEnum(
  "telegram_ordering_mode",
  TELEGRAM_ORDERING_MODES,
);

export const sourceImportStage = pgEnum(
  "source_import_stage",
  SOURCE_IMPORT_STAGES,
);

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
