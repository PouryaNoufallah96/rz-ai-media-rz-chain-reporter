CREATE TYPE "public"."market_output_format" AS ENUM('portrait', 'square', 'story', 'landscape');--> statement-breakpoint
CREATE TYPE "public"."market_period" AS ENUM('24h', '7d', '30d', '90d', '1y');--> statement-breakpoint
CREATE TYPE "public"."market_provider" AS ENUM('coinmarketcap', 'binance', 'coingecko', 'coingecko_onchain');--> statement-breakpoint
CREATE TYPE "public"."market_scale" AS ENUM('relative', 'absolute');--> statement-breakpoint
CREATE TYPE "public"."market_series_role" AS ENUM('primary', 'comparison');--> statement-breakpoint
ALTER TABLE "market_analysis" ALTER COLUMN "output_format" SET DATA TYPE "public"."market_output_format" USING "output_format"::"public"."market_output_format";--> statement-breakpoint
ALTER TABLE "market_comparison_catalog" ALTER COLUMN "provider" SET DATA TYPE "public"."market_provider" USING "provider"::"public"."market_provider";--> statement-breakpoint
ALTER TABLE "market_generation" ALTER COLUMN "brief_source" SET DATA TYPE "public"."market_generation_brief_source" USING "brief_source"::"public"."market_generation_brief_source";--> statement-breakpoint
ALTER TABLE "market_instrument" ALTER COLUMN "provider_mappings" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "market_snapshot" ALTER COLUMN "period" SET DATA TYPE "public"."market_period" USING "period"::"public"."market_period";--> statement-breakpoint
ALTER TABLE "market_snapshot" ALTER COLUMN "scale" SET DATA TYPE "public"."market_scale" USING "scale"::"public"."market_scale";--> statement-breakpoint
ALTER TABLE "market_snapshot_series" ALTER COLUMN "role" SET DATA TYPE "public"."market_series_role" USING "role"::"public"."market_series_role";--> statement-breakpoint
ALTER TABLE "market_snapshot_series" ALTER COLUMN "provider" SET DATA TYPE "public"."market_provider" USING "provider"::"public"."market_provider";--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "ck_market_generation_policy_rejections_bounded" CHECK ("market_generation"."policy_rejections" is null or (jsonb_typeof("market_generation"."policy_rejections") = 'array' and jsonb_array_length("market_generation"."policy_rejections") <= 12));--> statement-breakpoint
ALTER TABLE "market_generation" ADD CONSTRAINT "ck_market_generation_retry_receipt_consistency" CHECK (("market_generation"."finalization_retry_epoch" = 0 and "market_generation"."latest_finalization_retry_receipt" is null) or ("market_generation"."finalization_retry_epoch" > 0 and "market_generation"."latest_finalization_retry_receipt" is not null));--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_snapshot_id" FOREIGN KEY ("current_snapshot_id") REFERENCES "public"."market_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_chart_render_id" FOREIGN KEY ("current_chart_render_id") REFERENCES "public"."market_chart_render"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis" ADD CONSTRAINT "fk_market_analysis_current_generation_id" FOREIGN KEY ("current_generation_id") REFERENCES "public"."market_generation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_analysis_handoff" ADD CONSTRAINT "fk_market_analysis_handoff_market_snapshot_id" FOREIGN KEY ("market_snapshot_id") REFERENCES "public"."market_snapshot"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "reject_immutable_market_row"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = TG_ARGV[0],
    MESSAGE = TG_ARGV[0];
END;
$$;--> statement-breakpoint
CREATE TRIGGER "market_snapshot_immutable"
BEFORE UPDATE OR DELETE ON "market_snapshot"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_market_row"('ck_market_snapshot_immutable');--> statement-breakpoint
CREATE TRIGGER "market_snapshot_series_immutable"
BEFORE UPDATE OR DELETE ON "market_snapshot_series"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_market_row"('ck_market_snapshot_series_immutable');--> statement-breakpoint
CREATE TRIGGER "market_analysis_handoff_immutable"
BEFORE UPDATE OR DELETE ON "market_analysis_handoff"
FOR EACH ROW EXECUTE FUNCTION "reject_immutable_market_row"('ck_market_analysis_handoff_immutable');--> statement-breakpoint
CREATE FUNCTION "enforce_market_chart_render_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  asset_valid boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."media_asset_id" IS NOT NULL OR NEW."verified_at" IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'ck_market_chart_render_initially_unverified',
        MESSAGE = 'market_chart_render_initially_unverified';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."market_analysis_id" IS DISTINCT FROM OLD."market_analysis_id"
    OR NEW."operation_id" IS DISTINCT FROM OLD."operation_id"
    OR NEW."expected_chart_fingerprint" IS DISTINCT FROM OLD."expected_chart_fingerprint"
    OR NEW."render_contract_version" IS DISTINCT FROM OLD."render_contract_version"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_market_chart_render_identity_immutable',
      MESSAGE = 'market_chart_render_identity_immutable';
  END IF;

  IF OLD."media_asset_id" IS NOT NULL
    OR NEW."media_asset_id" IS NULL
    OR NEW."verified_at" IS NULL
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_market_chart_render_media_fence',
      MESSAGE = 'market_chart_render_media_fence';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM "media_asset" m
    WHERE m."workspace_id" = NEW."workspace_id"
      AND m."id" = NEW."media_asset_id"
      AND m."kind" = 'market_chart_render'
      AND m."lifecycle" = 'verified'
      AND m."object_removed_at" IS NULL
      AND m."checksum" IS NOT NULL
  ) INTO asset_valid;
  IF NOT asset_valid THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_market_chart_render_verified_asset',
      MESSAGE = 'market_chart_render_verified_asset';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "market_chart_render_transition"
BEFORE INSERT OR UPDATE ON "market_chart_render"
FOR EACH ROW EXECUTE FUNCTION "enforce_market_chart_render_transition"();--> statement-breakpoint
CREATE FUNCTION "install_market_chart_render"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  installed_count integer;
BEGIN
  UPDATE "market_analysis"
  SET "current_chart_render_id" = NEW."id",
      "current_chart_media_asset_id" = NEW."media_asset_id",
      "version" = "version" + 1,
      "updated_at" = now()
  WHERE "workspace_id" = NEW."workspace_id"
    AND "id" = NEW."market_analysis_id"
    AND "status" = 'in_progress'
    AND "chart_approval_fingerprint" = NEW."expected_chart_fingerprint";
  GET DIAGNOSTICS installed_count = ROW_COUNT;
  IF installed_count <> 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_market_chart_render_current_fence',
      MESSAGE = 'market_chart_render_current_fence';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "market_chart_render_install"
AFTER UPDATE OF "media_asset_id" ON "market_chart_render"
FOR EACH ROW
WHEN (OLD."media_asset_id" IS DISTINCT FROM NEW."media_asset_id")
EXECUTE FUNCTION "install_market_chart_render"();--> statement-breakpoint
CREATE FUNCTION "enforce_market_analysis_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  render_valid boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" = 'completed' THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'ck_market_analysis_completed_immutable',
        MESSAGE = 'market_analysis_completed_immutable';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" = 'completed' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_market_analysis_completed_immutable',
      MESSAGE = 'market_analysis_completed_immutable';
  END IF;

  IF num_nonnulls(NEW."current_chart_render_id", NEW."current_chart_media_asset_id") = 1 THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_market_analysis_chart_checkpoint_pair',
      MESSAGE = 'market_analysis_chart_checkpoint_pair';
  END IF;

  IF NEW."current_chart_render_id" IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM "market_chart_render" r
      WHERE r."workspace_id" = NEW."workspace_id"
        AND r."market_analysis_id" = NEW."id"
        AND r."id" = NEW."current_chart_render_id"
        AND r."media_asset_id" = NEW."current_chart_media_asset_id"
        AND r."verified_at" IS NOT NULL
    ) INTO render_valid;
    IF NOT render_valid THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'ck_market_analysis_chart_checkpoint_match',
        MESSAGE = 'market_analysis_chart_checkpoint_match';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "market_analysis_transition"
BEFORE UPDATE OR DELETE ON "market_analysis"
FOR EACH ROW EXECUTE FUNCTION "enforce_market_analysis_transition"();
