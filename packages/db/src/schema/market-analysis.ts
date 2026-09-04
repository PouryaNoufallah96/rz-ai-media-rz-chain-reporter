import type {
  ErrorCode,
  MarketProviderMapping,
  MarketVerifiedFacts,
  NormalizedMarketRequest,
} from "@rz-chain-reporter/contracts";
import { type SQLWrapper, sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import {
  contentLocale,
  marketAnalysisStatus,
  marketGenerationBriefSource,
  marketOutputFormat,
  marketProvider,
} from "./enums";
import {
  softDelete,
  timestamps,
  uuidPrimaryKey,
  workspaceScope,
} from "./helpers";
import { marketSnapshot } from "./market-snapshot";
import { mediaAsset } from "./media-asset";
import { mediaBrand } from "./media-brand";
import { operation } from "./operation";
import { workspace } from "./workspace";

const approvalTripletCheck = (
  fingerprint: SQLWrapper,
  approvedAt: SQLWrapper,
  approvedBy: SQLWrapper,
) =>
  sql`(num_nonnulls(${fingerprint}, ${approvedAt}, ${approvedBy}) = 0 or num_nonnulls(${fingerprint}, ${approvedAt}, ${approvedBy}) = 3)`;

export const marketInstrument = pgTable(
  "market_instrument",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    key: text("key").notNull(),
    name: text("name").notNull(),
    symbol: text("symbol").notNull(),
    enabled: boolean("enabled").default(true).notNull(),
    providerMappings: jsonb("provider_mappings")
      .$type<readonly MarketProviderMapping[]>()
      .notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    foreignKey({
      name: "fk_market_instrument_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    unique("uq_market_instrument_workspace_id_key").on(t.workspaceId, t.key),
    check("ck_market_instrument_key_nonempty", sql`btrim(${t.key}) <> ''`),
    check("ck_market_instrument_name_nonempty", sql`btrim(${t.name}) <> ''`),
    check(
      "ck_market_instrument_symbol_nonempty",
      sql`btrim(${t.symbol}) <> ''`,
    ),
  ],
);

export const marketComparisonCatalogState = pgTable(
  "market_comparison_catalog_state",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    currentBatchId: uuid("current_batch_id"),
    refreshOperationId: uuid("refresh_operation_id"),
    refreshClaimedBy: text("refresh_claimed_by"),
    refreshClaimedAt: timestamp("refresh_claimed_at", { withTimezone: true }),
    refreshLeaseExpiresAt: timestamp("refresh_lease_expires_at", {
      withTimezone: true,
    }),
    lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
    lastFailureAt: timestamp("last_failure_at", { withTimezone: true }),
    lastFailureCode: text("last_failure_code").$type<ErrorCode>(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_comparison_catalog_state_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_comparison_catalog_state_refresh_operation_id",
      columns: [t.refreshOperationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    unique("uq_market_comparison_catalog_state_workspace_id").on(t.workspaceId),
    check(
      "ck_market_comparison_catalog_state_version_positive",
      sql`${t.version} > 0`,
    ),
    check(
      "ck_market_comparison_catalog_state_claim_complete",
      sql`num_nonnulls(${t.refreshClaimedBy}, ${t.refreshClaimedAt}, ${t.refreshLeaseExpiresAt}) in (0, 3)`,
    ),
  ],
);

export const marketComparisonCatalog = pgTable(
  "market_comparison_catalog",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    batchId: uuid("batch_id").notNull(),
    provider: marketProvider("provider").notNull(),
    canonicalIdentity: text("canonical_identity").notNull(),
    symbol: text("symbol").notNull(),
    displayName: text("display_name").notNull(),
    baseAsset: text("base_asset").notNull(),
    quoteAsset: text("quote_asset").notNull(),
    tradingStatus: text("trading_status").notNull(),
    providerMetadata: jsonb("provider_metadata"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_comparison_catalog_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    unique("uq_market_comparison_catalog_workspace_batch_identity").on(
      t.workspaceId,
      t.batchId,
      t.canonicalIdentity,
    ),
    index("ix_market_comparison_catalog_workspace_batch").on(
      t.workspaceId,
      t.batchId,
    ),
    check(
      "ck_market_comparison_catalog_identity_nonempty",
      sql`btrim(${t.canonicalIdentity}) <> ''`,
    ),
  ],
);

export const marketAnalysis = pgTable(
  "market_analysis",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    operationId: uuid("operation_id").notNull(),
    status: marketAnalysisStatus("status").default("in_progress").notNull(),
    mediaBrandId: uuid("media_brand_id").notNull(),
    visualOwnerInstrumentId: uuid("visual_owner_instrument_id").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    normalizedRequest: jsonb("normalized_request")
      .$type<NormalizedMarketRequest>()
      .notNull(),
    requestFingerprint: text("request_fingerprint").notNull(),
    currentSnapshotId: uuid("current_snapshot_id"),
    currentChartSpec: jsonb("current_chart_spec"),
    currentChartRenderId: uuid("current_chart_render_id"),
    currentChartMediaAssetId: uuid("current_chart_media_asset_id"),
    storyHeadline: text("story_headline"),
    storySupportingText: text("story_supporting_text"),
    designFamilyKey: text("design_family_key"),
    designVariantKey: text("design_variant_key"),
    outputFormat: marketOutputFormat("output_format"),
    operatorDirection: text("operator_direction"),
    imageOptionKey: text("image_option_key"),
    currentGenerationId: uuid("current_generation_id"),
    currentFinalMediaAssetId: uuid("current_final_media_asset_id"),
    chartApprovalFingerprint: text("chart_approval_fingerprint"),
    chartApprovedAt: timestamp("chart_approved_at", { withTimezone: true }),
    chartApprovedBy: text("chart_approved_by"),
    storyApprovalFingerprint: text("story_approval_fingerprint"),
    storyApprovedAt: timestamp("story_approved_at", { withTimezone: true }),
    storyApprovedBy: text("story_approved_by"),
    designApprovalFingerprint: text("design_approval_fingerprint"),
    designApprovedAt: timestamp("design_approved_at", { withTimezone: true }),
    designApprovedBy: text("design_approved_by"),
    finalApprovalFingerprint: text("final_approval_fingerprint"),
    finalApprovedAt: timestamp("final_approved_at", { withTimezone: true }),
    finalApprovedBy: text("final_approved_by"),
    verificationIntentId: uuid("verification_intent_id"),
    verificationIntentVersion: integer("verification_intent_version")
      .default(0)
      .notNull(),
    templateFingerprint: text("template_fingerprint").notNull(),
    catalogFingerprint: text("catalog_fingerprint"),
    instrumentProfileFingerprint: text(
      "instrument_profile_fingerprint",
    ).notNull(),
    version: integer("version").default(1).notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    completedBy: text("completed_by"),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_market_analysis_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_visual_owner_instrument_id",
      columns: [t.visualOwnerInstrumentId],
      foreignColumns: [marketInstrument.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_current_snapshot_id",
      columns: [t.currentSnapshotId],
      foreignColumns: [marketSnapshot.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_current_chart_render_id",
      columns: [t.currentChartRenderId],
      foreignColumns: [marketChartRender.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_current_chart_media_asset_id",
      columns: [t.currentChartMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_current_generation_id",
      columns: [t.currentGenerationId],
      foreignColumns: [marketGeneration.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_current_final_media_asset_id",
      columns: [t.currentFinalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_chart_approved_by",
      columns: [t.chartApprovedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_story_approved_by",
      columns: [t.storyApprovedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_design_approved_by",
      columns: [t.designApprovedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_final_approved_by",
      columns: [t.finalApprovedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_completed_by",
      columns: [t.completedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    unique("uq_market_analysis_operation_id").on(t.operationId),
    index("ix_market_analysis_workspace_updated_id").on(
      t.workspaceId,
      t.updatedAt,
      t.id,
    ),
    check("ck_market_analysis_version_positive", sql`${t.version} > 0`),
    check(
      "ck_market_analysis_verification_intent_version_nonnegative",
      sql`${t.verificationIntentVersion} >= 0`,
    ),
    check(
      "ck_market_analysis_chart_approval_triplet",
      approvalTripletCheck(
        t.chartApprovalFingerprint,
        t.chartApprovedAt,
        t.chartApprovedBy,
      ),
    ),
    check(
      "ck_market_analysis_story_approval_triplet",
      approvalTripletCheck(
        t.storyApprovalFingerprint,
        t.storyApprovedAt,
        t.storyApprovedBy,
      ),
    ),
    check(
      "ck_market_analysis_design_approval_triplet",
      approvalTripletCheck(
        t.designApprovalFingerprint,
        t.designApprovedAt,
        t.designApprovedBy,
      ),
    ),
    check(
      "ck_market_analysis_final_approval_triplet",
      approvalTripletCheck(
        t.finalApprovalFingerprint,
        t.finalApprovedAt,
        t.finalApprovedBy,
      ),
    ),
    check(
      "ck_market_analysis_completion_consistency",
      sql`(${t.status} = 'in_progress' and ${t.completedAt} is null and ${t.completedBy} is null) or (${t.status} = 'completed' and ${t.completedAt} is not null and ${t.completedBy} is not null and ${t.finalApprovalFingerprint} is not null and ${t.currentFinalMediaAssetId} is not null)`,
    ),
  ],
);

export const marketChartRender = pgTable(
  "market_chart_render",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    marketAnalysisId: uuid("market_analysis_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    expectedChartFingerprint: text("expected_chart_fingerprint").notNull(),
    renderContractVersion: text("render_contract_version").notNull(),
    mediaAssetId: uuid("media_asset_id"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_market_chart_render_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_chart_render_market_analysis_id",
      columns: [t.marketAnalysisId],
      foreignColumns: [marketAnalysis.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_chart_render_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_chart_render_media_asset_id",
      columns: [t.mediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    unique("uq_market_chart_render_operation_id").on(t.operationId),
    unique("uq_market_chart_render_workspace_analysis_id").on(
      t.workspaceId,
      t.marketAnalysisId,
      t.id,
    ),
    check(
      "ck_market_chart_render_verification_pair",
      sql`num_nonnulls(${t.mediaAssetId}, ${t.verifiedAt}) in (0, 2)`,
    ),
  ],
);

export const marketChartDefault = pgTable(
  "market_chart_default",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    actorId: text("actor_id").notNull(),
    marketInstrumentId: uuid("market_instrument_id").notNull(),
    normalizedChartSpec: jsonb("normalized_chart_spec").notNull(),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_chart_default_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_chart_default_actor_id",
      columns: [t.actorId],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_chart_default_market_instrument_id",
      columns: [t.marketInstrumentId],
      foreignColumns: [marketInstrument.id],
    }).onDelete("restrict"),
    unique("uq_market_chart_default_workspace_actor_instrument").on(
      t.workspaceId,
      t.actorId,
      t.marketInstrumentId,
    ),
    check("ck_market_chart_default_version_positive", sql`${t.version} > 0`),
  ],
);

export const marketGeneration = pgTable(
  "market_generation",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    operationId: uuid("operation_id").notNull(),
    marketAnalysisId: uuid("market_analysis_id").notNull(),
    intentId: uuid("intent_id").notNull(),
    intentVersion: integer("intent_version").notNull(),
    expectedDesignFingerprint: text("expected_design_fingerprint").notNull(),
    imageOptionKey: text("image_option_key").notNull(),
    operatorDirection: text("operator_direction"),
    briefSource: marketGenerationBriefSource("brief_source"),
    acceptedBrief: jsonb("accepted_brief"),
    briefSchemaVersion: text("brief_schema_version"),
    briefPolicyVersion: text("brief_policy_version"),
    fallbackCode: text("fallback_code").$type<ErrorCode>(),
    policyRejections: jsonb("policy_rejections"),
    referenceSampleKey: text("reference_sample_key").notNull(),
    referenceSampleChecksum: text("reference_sample_checksum").notNull(),
    footerLockupKey: text("footer_lockup_key").notNull(),
    footerLockupChecksum: text("footer_lockup_checksum").notNull(),
    chartMediaAssetId: uuid("chart_media_asset_id").notNull(),
    chartMediaChecksum: text("chart_media_checksum").notNull(),
    outputWidth: integer("output_width").notNull(),
    outputHeight: integer("output_height").notNull(),
    promptPolicyVersion: text("prompt_policy_version"),
    promptDigest: text("prompt_digest"),
    providerOriginalMediaAssetId: uuid("provider_original_media_asset_id"),
    finalMediaAssetId: uuid("final_media_asset_id"),
    finalizationRetryEpoch: integer("finalization_retry_epoch")
      .default(0)
      .notNull(),
    latestFinalizationRetryReceipt: text("latest_finalization_retry_receipt"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_generation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_generation_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_generation_market_analysis_id",
      columns: [t.marketAnalysisId],
      foreignColumns: [marketAnalysis.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_generation_chart_media_asset_id",
      columns: [t.chartMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_generation_provider_original_media_asset_id",
      columns: [t.providerOriginalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_generation_final_media_asset_id",
      columns: [t.finalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    unique("uq_market_generation_operation_id").on(t.operationId),
    unique("uq_market_generation_workspace_analysis_id").on(
      t.workspaceId,
      t.marketAnalysisId,
      t.id,
    ),
    check(
      "ck_market_generation_intent_version_positive",
      sql`${t.intentVersion} > 0`,
    ),
    check(
      "ck_market_generation_dimensions_positive",
      sql`${t.outputWidth} > 0 and ${t.outputHeight} > 0`,
    ),
    check(
      "ck_market_generation_retry_epoch_nonnegative",
      sql`${t.finalizationRetryEpoch} >= 0`,
    ),
    check(
      "ck_market_generation_brief_complete",
      sql`${t.acceptedBrief} is null or (${t.briefSource} is not null and ${t.briefSchemaVersion} is not null and ${t.briefPolicyVersion} is not null)`,
    ),
    check(
      "ck_market_generation_policy_rejections_bounded",
      sql`${t.policyRejections} is null or (jsonb_typeof(${t.policyRejections}) = 'array' and jsonb_array_length(${t.policyRejections}) <= 12)`,
    ),
    check(
      "ck_market_generation_retry_receipt_consistency",
      sql`(${t.finalizationRetryEpoch} = 0 and ${t.latestFinalizationRetryReceipt} is null) or (${t.finalizationRetryEpoch} > 0 and ${t.latestFinalizationRetryReceipt} is not null)`,
    ),
  ],
);

export const marketAnalysisHandoff = pgTable(
  "market_analysis_handoff",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    marketAnalysisId: uuid("market_analysis_id").notNull(),
    approvedFinalFingerprint: text("approved_final_fingerprint").notNull(),
    marketSnapshotId: uuid("market_snapshot_id").notNull(),
    mediaBrandId: uuid("media_brand_id").notNull(),
    visualOwnerInstrumentId: uuid("visual_owner_instrument_id").notNull(),
    designFamilyKey: text("design_family_key").notNull(),
    designVariantKey: text("design_variant_key").notNull(),
    contentLocale: contentLocale("content_locale").notNull(),
    storyHeadline: text("story_headline").notNull(),
    storySupportingText: text("story_supporting_text").notNull(),
    verifiedFacts: jsonb("verified_facts")
      .$type<MarketVerifiedFacts>()
      .notNull(),
    templateFingerprint: text("template_fingerprint").notNull(),
    catalogFingerprint: text("catalog_fingerprint").notNull(),
    instrumentProfileFingerprint: text(
      "instrument_profile_fingerprint",
    ).notNull(),
    brandPolicyFingerprint: text("brand_policy_fingerprint").notNull(),
    referenceSampleChecksum: text("reference_sample_checksum").notNull(),
    footerLockupChecksum: text("footer_lockup_checksum").notNull(),
    imageOptionKey: text("image_option_key").notNull(),
    marketChartRenderId: uuid("market_chart_render_id").notNull(),
    chartMediaAssetId: uuid("chart_media_asset_id").notNull(),
    chartMediaChecksum: text("chart_media_checksum").notNull(),
    finalMediaAssetId: uuid("final_media_asset_id").notNull(),
    finalMediaChecksum: text("final_media_checksum").notNull(),
    chartApprovalFingerprint: text("chart_approval_fingerprint").notNull(),
    storyApprovalFingerprint: text("story_approval_fingerprint").notNull(),
    designApprovalFingerprint: text("design_approval_fingerprint").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_market_analysis_handoff_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_market_analysis_id",
      columns: [t.marketAnalysisId],
      foreignColumns: [marketAnalysis.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_market_snapshot_id",
      columns: [t.marketSnapshotId],
      foreignColumns: [marketSnapshot.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_visual_owner_instrument_id",
      columns: [t.visualOwnerInstrumentId],
      foreignColumns: [marketInstrument.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_market_chart_render_id",
      columns: [t.marketChartRenderId],
      foreignColumns: [marketChartRender.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_chart_media_asset_id",
      columns: [t.chartMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_market_analysis_handoff_final_media_asset_id",
      columns: [t.finalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    unique("uq_market_analysis_handoff_workspace_analysis_final").on(
      t.workspaceId,
      t.marketAnalysisId,
      t.approvedFinalFingerprint,
    ),
  ],
);
