import {
  ADMISSION_OUTCOMES,
  ANALYSIS_RUN_KINDS,
  ARTICLE_ADAPTERS,
  ARTICLE_FETCH_MODES,
  ATTEMPT_OUTCOMES,
  CONTENT_LOCALES,
  DRAFT_REVISION_COMMAND_KINDS,
  DUPLICATE_METHODS,
  ENRICHMENT_OUTCOMES,
  ENRICHMENT_REASONS,
  FILTER_DISPOSITIONS,
  FILTERING_REASONS,
  IMAGE_SOURCE_PROJECTION_KINDS,
  ITEM_ELIGIBILITIES,
  MEDIA_ASSET_LIFECYCLES,
  MEDIA_DERIVATION_PURPOSES,
  MODEL_BACKENDS,
  MODEL_UNIT_STATUSES,
  OPERATION_LIFECYCLES,
  PLATFORMS,
  SCHEDULE_STATUSES,
  SEMANTIC_DEGRADED_REASONS,
  SEMANTIC_PARTICIPATIONS,
  SEMANTIC_STAGE_STATUSES,
  SOURCE_FETCH_OUTCOMES,
  SOURCE_FETCH_REASONS,
  SOURCE_IMPORT_BINDINGS,
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

export const analysisRunKind = pgEnum("analysis_run_kind", ANALYSIS_RUN_KINDS);

export const sourceImportBinding = pgEnum(
  "source_import_binding",
  SOURCE_IMPORT_BINDINGS,
);

export const itemEligibility = pgEnum("item_eligibility", ITEM_ELIGIBILITIES);

export const duplicateMethod = pgEnum("duplicate_method", DUPLICATE_METHODS);

export const semanticParticipation = pgEnum(
  "semantic_participation",
  SEMANTIC_PARTICIPATIONS,
);

export const semanticStageStatus = pgEnum(
  "semantic_stage_status",
  SEMANTIC_STAGE_STATUSES,
);

export const semanticDegradedReason = pgEnum(
  "semantic_degraded_reason",
  SEMANTIC_DEGRADED_REASONS,
);

export const filterDisposition = pgEnum(
  "filter_disposition",
  FILTER_DISPOSITIONS,
);

export const filteringReason = pgEnum("filtering_reason", FILTERING_REASONS);

export const modelUnitStatus = pgEnum("model_unit_status", MODEL_UNIT_STATUSES);

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

export const draftRevisionCommandKind = pgEnum(
  "draft_revision_command_kind",
  DRAFT_REVISION_COMMAND_KINDS,
);

export const imageSourceProjectionKind = pgEnum(
  "image_source_projection_kind",
  IMAGE_SOURCE_PROJECTION_KINDS,
);

export const mediaDerivationPurpose = pgEnum(
  "media_derivation_purpose",
  MEDIA_DERIVATION_PURPOSES,
);
