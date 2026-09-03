CREATE OR REPLACE FUNCTION "reject_immutable_market_row"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = TG_ARGV[0],
    MESSAGE = TG_ARGV[0];
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_market_chart_render_transition"() RETURNS trigger
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
$$;
