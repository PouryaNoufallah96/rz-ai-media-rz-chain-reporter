CREATE OR REPLACE FUNCTION "enforce_draft_revision_transition"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  generated_match boolean;
  media_match boolean;
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."workspace_id" IS DISTINCT FROM OLD."workspace_id"
    OR NEW."platform_draft_id" IS DISTINCT FROM OLD."platform_draft_id"
    OR NEW."revision_number" IS DISTINCT FROM OLD."revision_number"
    OR NEW."content_locale" IS DISTINCT FROM OLD."content_locale"
    OR NEW."headline" IS DISTINCT FROM OLD."headline"
    OR NEW."body" IS DISTINCT FROM OLD."body"
    OR NEW."hashtags" IS DISTINCT FROM OLD."hashtags"
    OR NEW."originating_copy_variant_id" IS DISTINCT FROM OLD."originating_copy_variant_id"
    OR NEW."authored_by" IS DISTINCT FROM OLD."authored_by"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_draft_revision_copy_immutable',
      MESSAGE = 'draft_revision_copy_immutable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "approval" a
    WHERE a."workspace_id" = OLD."workspace_id"
      AND a."draft_revision_id" = OLD."id"
  ) AND (
    NEW."selected_final_media_asset_id" IS DISTINCT FROM OLD."selected_final_media_asset_id"
    OR NEW."image_intent_version" IS DISTINCT FROM OLD."image_intent_version"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_draft_revision_media_locked_after_approval',
      MESSAGE = 'draft_revision_media_locked_after_approval';
  END IF;

  IF NEW."selected_final_media_asset_id" IS DISTINCT FROM OLD."selected_final_media_asset_id" THEN
    IF NEW."image_intent_version" = OLD."image_intent_version" THEN
      SELECT EXISTS (
        SELECT 1 FROM "image_generation" g
        WHERE g."workspace_id" = OLD."workspace_id"
          AND g."draft_revision_id" = OLD."id"
          AND g."expected_image_intent_version" = NEW."image_intent_version"
          AND g."final_media_asset_id" = NEW."selected_final_media_asset_id"
      ) INTO generated_match;
      IF NOT generated_match THEN
        RAISE EXCEPTION USING
          ERRCODE = '23514',
          CONSTRAINT = 'ck_draft_revision_generated_media_transition',
          MESSAGE = 'draft_revision_generated_media_transition';
      END IF;
    ELSIF NEW."image_intent_version" <> OLD."image_intent_version" + 1 THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'ck_draft_revision_image_intent_transition',
        MESSAGE = 'draft_revision_image_intent_transition';
    END IF;
  ELSIF NEW."image_intent_version" NOT IN (
    OLD."image_intent_version",
    OLD."image_intent_version" + 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_draft_revision_image_intent_transition',
      MESSAGE = 'draft_revision_image_intent_transition';
  END IF;

  IF NEW."selected_final_media_asset_id" IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM "media_asset" m
      WHERE m."workspace_id" = NEW."workspace_id"
        AND m."id" = NEW."selected_final_media_asset_id"
        AND m."lifecycle" = 'verified'
        AND m."object_removed_at" IS NULL
        AND (
          m."kind" = 'image'
          OR (
            m."kind" = 'image_final'
            AND EXISTS (
              SELECT 1
              FROM "image_generation" g
              INNER JOIN "draft_revision" source_revision
                ON source_revision."workspace_id" = g."workspace_id"
                AND source_revision."id" = g."draft_revision_id"
              WHERE g."workspace_id" = NEW."workspace_id"
                AND g."final_media_asset_id" = m."id"
                AND source_revision."platform_draft_id" = NEW."platform_draft_id"
            )
          )
          OR (
            m."kind" = 'market_generation_final'
            AND EXISTS (
              SELECT 1
              FROM "platform_draft" pd
              INNER JOIN "market_analysis_handoff" h
                ON h."workspace_id" = pd."workspace_id"
                AND h."id" = pd."market_analysis_handoff_id"
              WHERE pd."workspace_id" = NEW."workspace_id"
                AND pd."id" = NEW."platform_draft_id"
                AND h."final_media_asset_id" = m."id"
            )
          )
        )
    ) INTO media_match;
    IF NOT media_match THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        CONSTRAINT = 'ck_draft_revision_selected_media_publishable',
        MESSAGE = 'draft_revision_selected_media_publishable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
