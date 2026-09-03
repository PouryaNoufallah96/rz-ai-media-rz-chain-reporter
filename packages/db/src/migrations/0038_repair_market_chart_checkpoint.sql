CREATE OR REPLACE FUNCTION "enforce_market_analysis_transition"() RETURNS trigger
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

  IF NEW."current_chart_render_id" IS NULL
    AND NEW."current_chart_media_asset_id" IS NOT NULL
  THEN
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
        AND r."expected_chart_fingerprint" = NEW."chart_approval_fingerprint"
        AND (
          (
            NEW."current_chart_media_asset_id" IS NULL
            AND r."media_asset_id" IS NULL
            AND r."verified_at" IS NULL
          )
          OR (
            NEW."current_chart_media_asset_id" IS NOT NULL
            AND r."media_asset_id" = NEW."current_chart_media_asset_id"
            AND r."verified_at" IS NOT NULL
          )
        )
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
CREATE OR REPLACE FUNCTION "install_market_chart_render"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  installed_count integer;
BEGIN
  UPDATE "market_analysis"
  SET "current_chart_media_asset_id" = NEW."media_asset_id",
      "version" = "version" + 1,
      "updated_at" = now()
  WHERE "workspace_id" = NEW."workspace_id"
    AND "id" = NEW."market_analysis_id"
    AND "current_chart_render_id" = NEW."id"
    AND "current_chart_media_asset_id" IS NULL
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
$$;
