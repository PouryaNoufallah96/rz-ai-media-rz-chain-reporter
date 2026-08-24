-- Phase 6 Editorial Run: the three dormant Phase 3 tables (analysis_run,
-- filter_result, editorial_selection) are reshaped by forward ALTER, never
-- dropped and recreated, and three new tables carry the per-item, per-unit and
-- promo output. Every derived count stays derived: analysisRunProgress owns the
-- funnels, the unit tallies and the partial predicate, and no aggregate column
-- is added.
-- The three assertions below are the safety gate for the destructive parts of
-- this migration. All three tables are empty in every environment: no
-- application code imports them, packages/db/src/seed/dev.ts targets
-- source_item, platform_draft and draft_revision only, and the dev database
-- reports 0/0/0. The whole migration runs in one transaction, so a raised
-- exception rolls back every statement in this file.
-- filter_disposition is replaced, not extended. Its four Phase 3 values
-- (rejected, scored, clustered, routed) have no D17 counterpart, and DROP TYPE
-- is blocked by filter_result.disposition's dependency regardless of row count,
-- so the order column -> text, DROP TYPE, CREATE TYPE, column -> new enum is
-- load-bearing. analysis_run_kind keeps its literals and needs no DDL.
-- editorial_selection loses analysis_run_id and media_brand_id because both are
-- reachable through analysis_model_unit; keeping them would create a second
-- owner that can drift, and their restrict FKs to analysis_run would block the
-- run -> unit -> selection cascade this migration introduces.
-- Constraint-name rule: a name longer than 63 bytes is truncated to its first
-- 54 characters plus "_" plus the first 8 hex of sha256(full name)
-- (printf '%s' "<full>" | shasum -a 256 | cut -c1-8), reproducing the
-- 0013 precedent exactly. Both forms:
--   uq_analysis_run_item_workspace_id_analysis_run_id_source_item_id (64)
--     -> uq_analysis_run_item_workspace_id_analysis_run_id_sour_cf4fb965 (63)
--   uq_filter_result_workspace_id_analysis_run_id_source_item_id_media_brand_id (75)
--     -> uq_filter_result_workspace_id_analysis_run_id_source_i_5a1c2e10 (63)
--   ix_filter_result_workspace_id_analysis_run_id_media_brand_id_rank_position (74)
--     -> ix_filter_result_workspace_id_analysis_run_id_media_br_46f52f27 (63)
--   uq_analysis_model_unit_workspace_id_analysis_run_id_media_brand_id_model_option_key (83)
--     -> uq_analysis_model_unit_workspace_id_analysis_run_id_me_3c3979e2 (63)
--   uq_editorial_selection_workspace_id_analysis_model_unit_id_source_item_id (73)
--     -> uq_editorial_selection_workspace_id_analysis_model_uni_8cd4ece6 (63)
-- uq_editorial_selection_workspace_id_analysis_model_unit_id_rank is exactly 63
-- bytes and ix_filter_result_workspace_id_analysis_run_id_rank_position_id is
-- 62; both are stored unchanged.
-- Forward recovery. The three new tables are inert under Phase 5 code. Drop them
-- in reverse FK order, after the editorial_selection block below has removed
-- fk_editorial_selection_analysis_model_unit_id:
--   DROP TABLE promo_idea;
--   DROP TABLE analysis_run_item;
--   DROP TABLE analysis_model_unit;
--   DROP TYPE item_eligibility, duplicate_method, semantic_participation,
--     semantic_stage_status, semantic_degraded_reason, model_unit_status,
--     source_import_binding, filtering_reason;
-- analysis_run:
--   ALTER TABLE analysis_run DROP CONSTRAINT uq_analysis_run_operation_id;
--   ALTER TABLE analysis_run ALTER COLUMN operation_id DROP NOT NULL;
--   ALTER TABLE analysis_run DROP COLUMN source_import_id, DROP COLUMN source_import_binding,
--     DROP COLUMN configuration, DROP COLUMN template_fingerprint, DROP COLUMN scoring_version,
--     DROP COLUMN semantic_status, DROP COLUMN semantic_reason, DROP COLUMN semantic_attempt_id,
--     DROP COLUMN semantic_dimension, DROP COLUMN semantic_normalization_version,
--     DROP COLUMN semantic_projection_version, DROP COLUMN semantic_topic_count,
--     DROP COLUMN semantic_anchor_count, DROP COLUMN cancel_requested_at, DROP COLUMN cancelled_at;
--   DROP INDEX ix_analysis_run_workspace_id_started_at_id;
-- filter_result:
--   ALTER TABLE filter_result DROP CONSTRAINT uq_filter_result_workspace_id_analysis_run_id_source_i_5a1c2e10;
--   ALTER TABLE filter_result ADD CONSTRAINT uq_filter_result_workspace_id_analysis_run_id_source_item_id UNIQUE (workspace_id, analysis_run_id, source_item_id);
--   ALTER TABLE filter_result DROP CONSTRAINT fk_filter_result_media_brand_id;
--   ALTER TABLE filter_result DROP COLUMN media_brand_id, DROP COLUMN value_signal_count,
--     DROP COLUMN media_fit_score, DROP COLUMN source_preference_score, DROP COLUMN diversity_score,
--     DROP COLUMN semantic_brand_score, DROP COLUMN policy_score, DROP COLUMN rank_score,
--     DROP COLUMN rank_position;
--   ALTER TABLE filter_result ALTER COLUMN reason SET DATA TYPE text;
--   DROP INDEX ix_filter_result_workspace_id_analysis_run_id_rank_position_id;
--   DROP INDEX ix_filter_result_workspace_id_analysis_run_id_media_br_46f52f27;
-- filter_disposition, both CREATE TYPE statements, applied with the same detach
-- sequence in reverse:
--   CREATE TYPE "public"."filter_disposition" AS ENUM('rejected', 'scored', 'clustered', 'routed');
--   CREATE TYPE "public"."filter_disposition" AS ENUM('shortlisted', 'telegram_lane', 'no_media_fit', 'low_score', 'cap_exceeded');
-- editorial_selection:
--   ALTER TABLE editorial_selection DROP CONSTRAINT uq_editorial_selection_workspace_id_analysis_model_unit_id_rank;
--   ALTER TABLE editorial_selection DROP CONSTRAINT uq_editorial_selection_workspace_id_analysis_model_uni_8cd4ece6;
--   ALTER TABLE editorial_selection DROP CONSTRAINT fk_editorial_selection_analysis_model_unit_id;
--   ALTER TABLE editorial_selection DROP COLUMN analysis_model_unit_id, DROP COLUMN suggested_platform,
--     DROP COLUMN selection_suitability_score, DROP COLUMN selection_impact_score,
--     DROP COLUMN selection_virality_score, DROP COLUMN selection_confidence_score;
--   ALTER TABLE editorial_selection ADD COLUMN analysis_run_id uuid NOT NULL, ADD COLUMN editorial_model text NOT NULL,
--     ADD COLUMN media_brand_id uuid NOT NULL, ADD COLUMN scores jsonb;
--   ALTER TABLE editorial_selection ADD CONSTRAINT fk_editorial_selection_analysis_run_id FOREIGN KEY (analysis_run_id) REFERENCES "public"."analysis_run"("id") ON DELETE restrict;
--   ALTER TABLE editorial_selection ADD CONSTRAINT fk_editorial_selection_media_brand_id FOREIGN KEY (media_brand_id) REFERENCES "public"."media_brand"("id") ON DELETE restrict;
--   ALTER TABLE editorial_selection ADD CONSTRAINT uq_editorial_selection_workspace_id_analysis_run_id_ed_838762e6 UNIQUE (workspace_id, analysis_run_id, editorial_model, media_brand_id, rank);
DO $$
BEGIN
	IF (SELECT count(*) FROM "analysis_run") <> 0 THEN
		RAISE EXCEPTION 'analysis_run is not empty; 0014 refuses to reshape populated data';
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF (SELECT count(*) FROM "filter_result") <> 0 THEN
		RAISE EXCEPTION 'filter_result is not empty; 0014 refuses to reshape populated data';
	END IF;
END
$$;--> statement-breakpoint
DO $$
BEGIN
	IF (SELECT count(*) FROM "editorial_selection") <> 0 THEN
		RAISE EXCEPTION 'editorial_selection is not empty; 0014 refuses to reshape populated data';
	END IF;
END
$$;--> statement-breakpoint
CREATE TYPE "public"."duplicate_method" AS ENUM('canonical_url', 'title', 'semantic');--> statement-breakpoint
CREATE TYPE "public"."filtering_reason" AS ENUM('missing_required_value_signal', 'below_media_fit_threshold');--> statement-breakpoint
CREATE TYPE "public"."item_eligibility" AS ENUM('candidate', 'out_of_window', 'undated', 'duplicate');--> statement-breakpoint
CREATE TYPE "public"."model_unit_status" AS ENUM('pending', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."semantic_degraded_reason" AS ENUM('call_failed', 'dimension_mismatch', 'non_finite_value', 'ambiguous_outcome', 'bounds_exceeded');--> statement-breakpoint
CREATE TYPE "public"."semantic_participation" AS ENUM('included', 'outside_bound');--> statement-breakpoint
CREATE TYPE "public"."semantic_stage_status" AS ENUM('pending', 'running', 'succeeded', 'degraded', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."source_import_binding" AS ENUM('started', 'reused_in_flight', 'reused_settled');--> statement-breakpoint
CREATE TABLE "analysis_model_unit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"media_brand_id" uuid NOT NULL,
	"model_option_key" text NOT NULL,
	"task_key" text NOT NULL,
	"status" "model_unit_status" NOT NULL,
	"operation_attempt_id" uuid,
	"failure_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analysis_model_unit_workspace_id_analysis_run_id_me_3c3979e2" UNIQUE("workspace_id","analysis_run_id","media_brand_id","model_option_key")
);
--> statement-breakpoint
CREATE TABLE "analysis_run_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"source_item_revision_id" uuid NOT NULL,
	"eligibility" "item_eligibility" NOT NULL,
	"duplicate_method" "duplicate_method",
	"duplicate_of_source_item_id" uuid,
	"duplicate_similarity_bp" smallint,
	"source_authority_score" smallint,
	"freshness_score" smallint,
	"policy_virality_score" smallint,
	"lexical_topic_score" smallint,
	"lexical_topic_index" smallint,
	"semantic_topic_score" smallint,
	"semantic_topic_index" smallint,
	"semantic_participation" "semantic_participation",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_analysis_run_item_workspace_id_analysis_run_id_sour_cf4fb965" UNIQUE("workspace_id","analysis_run_id","source_item_id")
);
--> statement-breakpoint
CREATE TABLE "promo_idea" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"analysis_model_unit_id" uuid NOT NULL,
	"rank" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"angle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_promo_idea_workspace_id_analysis_model_unit_id_rank" UNIQUE("workspace_id","analysis_model_unit_id","rank")
);
--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP CONSTRAINT "uq_editorial_selection_workspace_id_analysis_run_id_ed_838762e6";--> statement-breakpoint
ALTER TABLE "filter_result" DROP CONSTRAINT "uq_filter_result_workspace_id_analysis_run_id_source_item_id";--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP CONSTRAINT "fk_editorial_selection_analysis_run_id";
--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP CONSTRAINT "fk_editorial_selection_media_brand_id";
--> statement-breakpoint
ALTER TABLE "filter_result" ALTER COLUMN "disposition" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."filter_disposition";--> statement-breakpoint
CREATE TYPE "public"."filter_disposition" AS ENUM('shortlisted', 'telegram_lane', 'no_media_fit', 'low_score', 'cap_exceeded');--> statement-breakpoint
ALTER TABLE "filter_result" ALTER COLUMN "disposition" SET DATA TYPE "public"."filter_disposition" USING "disposition"::"public"."filter_disposition";--> statement-breakpoint
ALTER TABLE "analysis_run" ALTER COLUMN "operation_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_result" ALTER COLUMN "reason" SET DATA TYPE "public"."filtering_reason" USING "reason"::"public"."filtering_reason";--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "source_import_id" uuid;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "source_import_binding" "source_import_binding";--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "configuration" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "template_fingerprint" text NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "scoring_version" text;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_status" "semantic_stage_status" NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_reason" "semantic_degraded_reason";--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_attempt_id" uuid;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_dimension" integer;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_normalization_version" text;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_projection_version" text;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_topic_count" integer;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "semantic_anchor_count" integer;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "cancel_requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "analysis_model_unit_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "suggested_platform" "platform" NOT NULL;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "selection_suitability_score" smallint;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "selection_impact_score" smallint;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "selection_virality_score" smallint;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "selection_confidence_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "media_brand_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "value_signal_count" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "media_fit_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "source_preference_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "diversity_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "semantic_brand_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "policy_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "rank_score" smallint;--> statement-breakpoint
ALTER TABLE "filter_result" ADD COLUMN "rank_position" integer;--> statement-breakpoint
ALTER TABLE "analysis_model_unit" ADD CONSTRAINT "fk_analysis_model_unit_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_unit" ADD CONSTRAINT "fk_analysis_model_unit_analysis_run_id" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_unit" ADD CONSTRAINT "fk_analysis_model_unit_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_model_unit" ADD CONSTRAINT "fk_analysis_model_unit_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run_item" ADD CONSTRAINT "fk_analysis_run_item_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run_item" ADD CONSTRAINT "fk_analysis_run_item_analysis_run_id" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run_item" ADD CONSTRAINT "fk_analysis_run_item_source_item_id" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run_item" ADD CONSTRAINT "fk_analysis_run_item_source_item_revision_id" FOREIGN KEY ("source_item_revision_id") REFERENCES "public"."source_item_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run_item" ADD CONSTRAINT "fk_analysis_run_item_duplicate_of_source_item_id" FOREIGN KEY ("duplicate_of_source_item_id") REFERENCES "public"."source_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_idea" ADD CONSTRAINT "fk_promo_idea_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_idea" ADD CONSTRAINT "fk_promo_idea_analysis_model_unit_id" FOREIGN KEY ("analysis_model_unit_id") REFERENCES "public"."analysis_model_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "fk_analysis_run_source_import_id" FOREIGN KEY ("source_import_id") REFERENCES "public"."source_import"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "fk_analysis_run_semantic_attempt_id" FOREIGN KEY ("semantic_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "fk_editorial_selection_analysis_model_unit_id" FOREIGN KEY ("analysis_model_unit_id") REFERENCES "public"."analysis_model_unit"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_result" ADD CONSTRAINT "fk_filter_result_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_analysis_run_workspace_id_started_at_id" ON "analysis_run" USING btree ("workspace_id","started_at","id");--> statement-breakpoint
CREATE INDEX "ix_filter_result_workspace_id_analysis_run_id_rank_position_id" ON "filter_result" USING btree ("workspace_id","analysis_run_id","rank_position","source_item_id");--> statement-breakpoint
CREATE INDEX "ix_filter_result_workspace_id_analysis_run_id_media_br_46f52f27" ON "filter_result" USING btree ("workspace_id","analysis_run_id","media_brand_id","rank_position");--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP COLUMN "analysis_run_id";--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP COLUMN "editorial_model";--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP COLUMN "media_brand_id";--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP COLUMN "scores";--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "uq_analysis_run_operation_id" UNIQUE("operation_id");--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "uq_editorial_selection_workspace_id_analysis_model_unit_id_rank" UNIQUE("workspace_id","analysis_model_unit_id","rank");--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "uq_editorial_selection_workspace_id_analysis_model_uni_8cd4ece6" UNIQUE("workspace_id","analysis_model_unit_id","source_item_id");--> statement-breakpoint
ALTER TABLE "filter_result" ADD CONSTRAINT "uq_filter_result_workspace_id_analysis_run_id_source_i_5a1c2e10" UNIQUE("workspace_id","analysis_run_id","source_item_id","media_brand_id");