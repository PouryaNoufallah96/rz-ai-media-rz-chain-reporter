CREATE TYPE "public"."market_analysis_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
CREATE TYPE "public"."market_generation_brief_source" AS ENUM('model', 'deterministic_fallback');--> statement-breakpoint
CREATE TYPE "public"."market_snapshot_series_outcome" AS ENUM('succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."market_snapshot_status" AS ENUM('verified', 'partial', 'unverified');--> statement-breakpoint
ALTER TYPE "public"."media_derivation_purpose" ADD VALUE 'market_analysis_footer_lockup';--> statement-breakpoint
CREATE TABLE "market_analysis" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"status" "market_analysis_status" DEFAULT 'in_progress' NOT NULL,
	"media_brand_id" uuid NOT NULL,
	"visual_owner_instrument_id" uuid NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"normalized_request" jsonb NOT NULL,
	"request_fingerprint" text NOT NULL,
	"current_snapshot_id" uuid,
	"current_chart_spec" jsonb,
	"current_chart_render_id" uuid,
	"current_chart_media_asset_id" uuid,
	"story_headline" text,
	"story_supporting_text" text,
	"design_family_key" text,
	"design_variant_key" text,
	"output_format" text,
	"operator_direction" text,
	"image_option_key" text,
	"current_generation_id" uuid,
	"current_final_media_asset_id" uuid,
	"chart_approval_fingerprint" text,
	"chart_approved_at" timestamp with time zone,
	"chart_approved_by" text,
	"story_approval_fingerprint" text,
	"story_approved_at" timestamp with time zone,
	"story_approved_by" text,
	"design_approval_fingerprint" text,
	"design_approved_at" timestamp with time zone,
	"design_approved_by" text,
	"final_approval_fingerprint" text,
	"final_approved_at" timestamp with time zone,
	"final_approved_by" text,
	"verification_intent_id" uuid,
	"verification_intent_version" integer DEFAULT 0 NOT NULL,
	"template_fingerprint" text NOT NULL,
	"catalog_fingerprint" text,
	"instrument_profile_fingerprint" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_analysis_operation_id" UNIQUE("operation_id"),
	CONSTRAINT "ck_market_analysis_version_positive" CHECK ("market_analysis"."version" > 0),
	CONSTRAINT "ck_market_analysis_verification_intent_version_nonnegative" CHECK ("market_analysis"."verification_intent_version" >= 0),
	CONSTRAINT "ck_market_analysis_chart_approval_triplet" CHECK ((num_nonnulls("market_analysis"."chart_approval_fingerprint", "market_analysis"."chart_approved_at", "market_analysis"."chart_approved_by") = 0 or num_nonnulls("market_analysis"."chart_approval_fingerprint", "market_analysis"."chart_approved_at", "market_analysis"."chart_approved_by") = 3)),
	CONSTRAINT "ck_market_analysis_story_approval_triplet" CHECK ((num_nonnulls("market_analysis"."story_approval_fingerprint", "market_analysis"."story_approved_at", "market_analysis"."story_approved_by") = 0 or num_nonnulls("market_analysis"."story_approval_fingerprint", "market_analysis"."story_approved_at", "market_analysis"."story_approved_by") = 3)),
	CONSTRAINT "ck_market_analysis_design_approval_triplet" CHECK ((num_nonnulls("market_analysis"."design_approval_fingerprint", "market_analysis"."design_approved_at", "market_analysis"."design_approved_by") = 0 or num_nonnulls("market_analysis"."design_approval_fingerprint", "market_analysis"."design_approved_at", "market_analysis"."design_approved_by") = 3)),
	CONSTRAINT "ck_market_analysis_final_approval_triplet" CHECK ((num_nonnulls("market_analysis"."final_approval_fingerprint", "market_analysis"."final_approved_at", "market_analysis"."final_approved_by") = 0 or num_nonnulls("market_analysis"."final_approval_fingerprint", "market_analysis"."final_approved_at", "market_analysis"."final_approved_by") = 3)),
	CONSTRAINT "ck_market_analysis_completion_consistency" CHECK (("market_analysis"."status" = 'in_progress' and "market_analysis"."completed_at" is null and "market_analysis"."completed_by" is null) or ("market_analysis"."status" = 'completed' and "market_analysis"."completed_at" is not null and "market_analysis"."completed_by" is not null and "market_analysis"."final_approval_fingerprint" is not null and "market_analysis"."current_final_media_asset_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "market_analysis_handoff" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"market_analysis_id" uuid NOT NULL,
	"approved_final_fingerprint" text NOT NULL,
	"market_snapshot_id" uuid NOT NULL,
	"media_brand_id" uuid NOT NULL,
	"visual_owner_instrument_id" uuid NOT NULL,
	"design_family_key" text NOT NULL,
	"design_variant_key" text NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"story_headline" text NOT NULL,
	"story_supporting_text" text NOT NULL,
	"verified_facts" jsonb NOT NULL,
	"template_fingerprint" text NOT NULL,
	"catalog_fingerprint" text NOT NULL,
	"instrument_profile_fingerprint" text NOT NULL,
	"brand_policy_fingerprint" text NOT NULL,
	"reference_sample_checksum" text NOT NULL,
	"footer_lockup_checksum" text NOT NULL,
	"image_option_key" text NOT NULL,
	"market_chart_render_id" uuid NOT NULL,
	"chart_media_asset_id" uuid NOT NULL,
	"chart_media_checksum" text NOT NULL,
	"final_media_asset_id" uuid NOT NULL,
	"final_media_checksum" text NOT NULL,
	"chart_approval_fingerprint" text NOT NULL,
	"story_approval_fingerprint" text NOT NULL,
	"design_approval_fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_analysis_handoff_workspace_analysis_final" UNIQUE("workspace_id","market_analysis_id","approved_final_fingerprint")
);
--> statement-breakpoint
CREATE TABLE "market_chart_default" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"market_instrument_id" uuid NOT NULL,
	"normalized_chart_spec" jsonb NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_chart_default_workspace_actor_instrument" UNIQUE("workspace_id","actor_id","market_instrument_id"),
	CONSTRAINT "ck_market_chart_default_version_positive" CHECK ("market_chart_default"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE "market_chart_render" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"market_analysis_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"expected_chart_fingerprint" text NOT NULL,
	"render_contract_version" text NOT NULL,
	"media_asset_id" uuid,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_chart_render_operation_id" UNIQUE("operation_id"),
	CONSTRAINT "uq_market_chart_render_workspace_analysis_id" UNIQUE("workspace_id","market_analysis_id","id"),
	CONSTRAINT "ck_market_chart_render_verification_pair" CHECK (num_nonnulls("market_chart_render"."media_asset_id", "market_chart_render"."verified_at") in (0, 2))
);
--> statement-breakpoint
CREATE TABLE "market_comparison_catalog" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"canonical_identity" text NOT NULL,
	"symbol" text NOT NULL,
	"display_name" text NOT NULL,
	"base_asset" text NOT NULL,
	"quote_asset" text NOT NULL,
	"trading_status" text NOT NULL,
	"provider_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_comparison_catalog_workspace_batch_identity" UNIQUE("workspace_id","batch_id","canonical_identity"),
	CONSTRAINT "ck_market_comparison_catalog_identity_nonempty" CHECK (btrim("market_comparison_catalog"."canonical_identity") <> '')
);
--> statement-breakpoint
CREATE TABLE "market_comparison_catalog_state" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"current_batch_id" uuid,
	"refresh_operation_id" uuid,
	"refresh_claimed_by" text,
	"refresh_claimed_at" timestamp with time zone,
	"refresh_lease_expires_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_comparison_catalog_state_workspace_id" UNIQUE("workspace_id"),
	CONSTRAINT "ck_market_comparison_catalog_state_version_positive" CHECK ("market_comparison_catalog_state"."version" > 0),
	CONSTRAINT "ck_market_comparison_catalog_state_claim_complete" CHECK (num_nonnulls("market_comparison_catalog_state"."refresh_claimed_by", "market_comparison_catalog_state"."refresh_claimed_at", "market_comparison_catalog_state"."refresh_lease_expires_at") in (0, 3))
);
--> statement-breakpoint
CREATE TABLE "market_generation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"market_analysis_id" uuid NOT NULL,
	"intent_id" uuid NOT NULL,
	"intent_version" integer NOT NULL,
	"expected_design_fingerprint" text NOT NULL,
	"image_option_key" text NOT NULL,
	"brief_source" text,
	"accepted_brief" jsonb,
	"brief_schema_version" text,
	"brief_policy_version" text,
	"fallback_code" text,
	"policy_rejections" jsonb,
	"reference_sample_key" text NOT NULL,
	"reference_sample_checksum" text NOT NULL,
	"chart_media_asset_id" uuid NOT NULL,
	"chart_media_checksum" text NOT NULL,
	"output_width" integer NOT NULL,
	"output_height" integer NOT NULL,
	"prompt_policy_version" text,
	"prompt_digest" text,
	"provider_original_media_asset_id" uuid,
	"final_media_asset_id" uuid,
	"finalization_retry_epoch" integer DEFAULT 0 NOT NULL,
	"latest_finalization_retry_receipt" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_generation_operation_id" UNIQUE("operation_id"),
	CONSTRAINT "uq_market_generation_workspace_analysis_id" UNIQUE("workspace_id","market_analysis_id","id"),
	CONSTRAINT "ck_market_generation_intent_version_positive" CHECK ("market_generation"."intent_version" > 0),
	CONSTRAINT "ck_market_generation_dimensions_positive" CHECK ("market_generation"."output_width" > 0 and "market_generation"."output_height" > 0),
	CONSTRAINT "ck_market_generation_retry_epoch_nonnegative" CHECK ("market_generation"."finalization_retry_epoch" >= 0),
	CONSTRAINT "ck_market_generation_brief_complete" CHECK ("market_generation"."accepted_brief" is null or ("market_generation"."brief_source" is not null and "market_generation"."brief_schema_version" is not null and "market_generation"."brief_policy_version" is not null))
);
--> statement-breakpoint
CREATE TABLE "market_instrument" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"provider_mappings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "uq_market_instrument_workspace_id_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "ck_market_instrument_key_nonempty" CHECK (btrim("market_instrument"."key") <> ''),
	CONSTRAINT "ck_market_instrument_name_nonempty" CHECK (btrim("market_instrument"."name") <> ''),
	CONSTRAINT "ck_market_instrument_symbol_nonempty" CHECK (btrim("market_instrument"."symbol") <> '')
);
--> statement-breakpoint
CREATE TABLE "market_snapshot" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"market_analysis_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"verification_intent_id" uuid NOT NULL,
	"verification_intent_version" integer NOT NULL,
	"normalized_request" jsonb NOT NULL,
	"request_fingerprint" text NOT NULL,
	"template_fingerprint" text NOT NULL,
	"period" text NOT NULL,
	"scale" text NOT NULL,
	"effective_window_start" timestamp with time zone,
	"effective_window_end" timestamp with time zone,
	"fetch_completed_at" timestamp with time zone NOT NULL,
	"status" "market_snapshot_status" NOT NULL,
	"warnings" jsonb NOT NULL,
	"aggregate_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_snapshot_operation_id" UNIQUE("operation_id"),
	CONSTRAINT "uq_market_snapshot_workspace_analysis_id" UNIQUE("workspace_id","market_analysis_id","id"),
	CONSTRAINT "ck_market_snapshot_intent_version_positive" CHECK ("market_snapshot"."verification_intent_version" > 0),
	CONSTRAINT "ck_market_snapshot_effective_window_order" CHECK ("market_snapshot"."effective_window_start" is null or "market_snapshot"."effective_window_end" is null or "market_snapshot"."effective_window_start" <= "market_snapshot"."effective_window_end"),
	CONSTRAINT "ck_market_snapshot_warnings_bounded" CHECK (jsonb_typeof("market_snapshot"."warnings") = 'array' and jsonb_array_length("market_snapshot"."warnings") <= 32)
);
--> statement-breakpoint
CREATE TABLE "market_snapshot_series" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"market_snapshot_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"descriptor_identity" text NOT NULL,
	"role" text NOT NULL,
	"controlled_instrument_id" uuid,
	"provider" text,
	"mapping" jsonb,
	"provider_reference" text,
	"attribution_identity" text,
	"points" jsonb,
	"coverage_start" timestamp with time zone,
	"coverage_end" timestamp with time zone,
	"start_price" numeric,
	"end_price" numeric,
	"change_percent" numeric,
	"outcome" "market_snapshot_series_outcome" NOT NULL,
	"failure_code" text,
	"attempted_mappings" jsonb,
	"retry_classification" text,
	"warnings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_market_snapshot_series_workspace_snapshot_position" UNIQUE("workspace_id","market_snapshot_id","position"),
	CONSTRAINT "uq_market_snapshot_series_workspace_snapshot_descriptor" UNIQUE("workspace_id","market_snapshot_id","descriptor_identity"),
	CONSTRAINT "ck_market_snapshot_series_position_positive" CHECK ("market_snapshot_series"."position" > 0),
	CONSTRAINT "ck_market_snapshot_series_outcome_shape" CHECK (("market_snapshot_series"."outcome" = 'succeeded' and "market_snapshot_series"."provider" is not null and "market_snapshot_series"."mapping" is not null and "market_snapshot_series"."points" is not null and "market_snapshot_series"."failure_code" is null) or ("market_snapshot_series"."outcome" = 'failed' and "market_snapshot_series"."points" is null and "market_snapshot_series"."failure_code" is not null)),
	CONSTRAINT "ck_market_snapshot_series_attempts_bounded" CHECK ("market_snapshot_series"."attempted_mappings" is null or (jsonb_typeof("market_snapshot_series"."attempted_mappings") = 'array' and jsonb_array_length("market_snapshot_series"."attempted_mappings") <= 4)),
	CONSTRAINT "ck_market_snapshot_series_warnings_bounded" CHECK (jsonb_typeof("market_snapshot_series"."warnings") = 'array' and jsonb_array_length("market_snapshot_series"."warnings") <= 32)
);
--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_visual_owner_instrument_id" FOREIGN KEY ("visual_owner_instrument_id") REFERENCES "public"."market_instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_chart_media_asset_id" FOREIGN KEY ("current_chart_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_final_media_asset_id" FOREIGN KEY ("current_final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_chart_approved_by" FOREIGN KEY ("chart_approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_story_approved_by" FOREIGN KEY ("story_approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_design_approved_by" FOREIGN KEY ("design_approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_final_approved_by" FOREIGN KEY ("final_approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_completed_by" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_market_analysis_id" FOREIGN KEY ("market_analysis_id") REFERENCES "public"."market_analysis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_visual_owner_instrument_id" FOREIGN KEY ("visual_owner_instrument_id") REFERENCES "public"."market_instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_market_chart_render_id" FOREIGN KEY ("market_chart_render_id") REFERENCES "public"."market_chart_render"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_chart_media_asset_id" FOREIGN KEY ("chart_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_final_media_asset_id" FOREIGN KEY ("final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_default" ADD CONSTRAINT "fk_market_chart_default_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_default" ADD CONSTRAINT "fk_market_chart_default_actor_id" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_default" ADD CONSTRAINT "fk_market_chart_default_market_instrument_id" FOREIGN KEY ("market_instrument_id") REFERENCES "public"."market_instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_render" ADD CONSTRAINT "fk_market_chart_render_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_render" ADD CONSTRAINT "fk_market_chart_render_market_analysis_id" FOREIGN KEY ("market_analysis_id") REFERENCES "public"."market_analysis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_render" ADD CONSTRAINT "fk_market_chart_render_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_chart_render" ADD CONSTRAINT "fk_market_chart_render_media_asset_id" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_comparison_catalog" ADD CONSTRAINT "fk_market_comparison_catalog_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_comparison_catalog_state" ADD CONSTRAINT "fk_market_comparison_catalog_state_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_comparison_catalog_state" ADD CONSTRAINT "fk_market_comparison_catalog_state_refresh_operation_id" FOREIGN KEY ("refresh_operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "fk_market_generation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "fk_market_generation_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "fk_market_generation_market_analysis_id" FOREIGN KEY ("market_analysis_id") REFERENCES "public"."market_analysis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "fk_market_generation_chart_media_asset_id" FOREIGN KEY ("chart_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "fk_market_generation_provider_original_media_asset_id" FOREIGN KEY ("provider_original_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "fk_market_generation_final_media_asset_id" FOREIGN KEY ("final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_instrument" ADD CONSTRAINT "fk_market_instrument_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshot" ADD CONSTRAINT "fk_market_snapshot_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshot" ADD CONSTRAINT "fk_market_snapshot_market_analysis_id" FOREIGN KEY ("market_analysis_id") REFERENCES "public"."market_analysis"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshot" ADD CONSTRAINT "fk_market_snapshot_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshot_series" ADD CONSTRAINT "fk_market_snapshot_series_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshot_series" ADD CONSTRAINT "fk_market_snapshot_series_market_snapshot_id" FOREIGN KEY ("market_snapshot_id") REFERENCES "public"."market_snapshot"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_snapshot_series" ADD CONSTRAINT "fk_market_snapshot_series_controlled_instrument_id" FOREIGN KEY ("controlled_instrument_id") REFERENCES "public"."market_instrument"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_market_analysis_workspace_updated_id" ON "market_analysis" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "ix_market_comparison_catalog_workspace_batch" ON "market_comparison_catalog" USING btree ("workspace_id","batch_id");--> statement-breakpoint
CREATE INDEX "ix_market_snapshot_workspace_analysis_created" ON "market_snapshot" USING btree ("workspace_id","market_analysis_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_outbox_event_market_generation_live_wake" ON "outbox_event" USING btree ("workspace_id","operation_id","event_type") WHERE "outbox_event"."dispatched_at" is null and "outbox_event"."exhausted_at" is null and "outbox_event"."event_type" = 'operation/market-generation.requested';