DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "approval"
    GROUP BY "workspace_id", "draft_revision_id", "platform"
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_approval_revision_platform_preflight',
      MESSAGE = 'approval_revision_platform_duplicate';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "approval" a
    INNER JOIN "draft_revision" r ON r."id" = a."draft_revision_id"
    WHERE a."workspace_id" <> r."workspace_id"
      OR a."selected_final_media_asset_id" IS DISTINCT FROM r."selected_final_media_asset_id"
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_approval_snapshot_preflight',
      MESSAGE = 'approval_snapshot_mismatch';
  END IF;
END;
$$;--> statement-breakpoint
ALTER TABLE "approval" DROP CONSTRAINT "uq_approval_workspace_snapshot";--> statement-breakpoint
ALTER TABLE "draft_revision" ADD COLUMN "image_intent_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "expected_image_intent_version" integer;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "projection_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "uq_approval_workspace_revision_platform" UNIQUE("workspace_id","draft_revision_id","platform");--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "ck_draft_revision_image_intent_version_nonnegative" CHECK ("draft_revision"."image_intent_version" >= 0);--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "ck_image_generation_expected_image_intent_version_nonnegative" CHECK ("image_generation"."expected_image_intent_version" is null or "image_generation"."expected_image_intent_version" >= 0);--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "ck_platform_draft_projection_version_nonnegative" CHECK ("platform_draft"."projection_version" >= 0);
--> statement-breakpoint
DROP TRIGGER IF EXISTS "draft_revision_immutable" ON "draft_revision";--> statement-breakpoint
DROP FUNCTION IF EXISTS "reject_draft_revision_update"();--> statement-breakpoint
CREATE FUNCTION "enforce_draft_revision_transition"() RETURNS trigger
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
$$;--> statement-breakpoint
CREATE TRIGGER "draft_revision_transition"
BEFORE UPDATE ON "draft_revision"
FOR EACH ROW EXECUTE FUNCTION "enforce_draft_revision_transition"();--> statement-breakpoint
CREATE FUNCTION "advance_platform_draft_projection_from_revision"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."selected_final_media_asset_id" IS DISTINCT FROM OLD."selected_final_media_asset_id"
    OR NEW."image_intent_version" IS DISTINCT FROM OLD."image_intent_version"
  THEN
    BEGIN
      PERFORM 1
      FROM "platform_draft"
      WHERE "workspace_id" = NEW."workspace_id"
        AND "id" = NEW."platform_draft_id"
      FOR UPDATE NOWAIT;
    EXCEPTION WHEN lock_not_available THEN
      RAISE EXCEPTION USING
        ERRCODE = '40001',
        CONSTRAINT = 'ck_draft_revision_projection_serialization',
        MESSAGE = 'draft_revision_projection_serialization';
    END;
    UPDATE "platform_draft"
    SET "projection_version" = "projection_version" + 1,
        "updated_at" = now()
    WHERE "workspace_id" = NEW."workspace_id"
      AND "id" = NEW."platform_draft_id";
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "draft_revision_projection"
AFTER UPDATE ON "draft_revision"
FOR EACH ROW EXECUTE FUNCTION "advance_platform_draft_projection_from_revision"();--> statement-breakpoint
CREATE FUNCTION "advance_platform_draft_projection_on_selection"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."active_revision_id" IS DISTINCT FROM OLD."active_revision_id"
    AND NEW."projection_version" = OLD."projection_version"
  THEN
    NEW."projection_version" = OLD."projection_version" + 1;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "platform_draft_selection_projection"
BEFORE UPDATE ON "platform_draft"
FOR EACH ROW EXECUTE FUNCTION "advance_platform_draft_projection_on_selection"();--> statement-breakpoint
CREATE FUNCTION "validate_approval_snapshot"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  draft_id uuid;
  draft_platform "platform";
  current_revision_id uuid;
  selected_media_id uuid;
BEGIN
  SELECT r."platform_draft_id" INTO draft_id
  FROM "draft_revision" r
  WHERE r."workspace_id" = NEW."workspace_id"
    AND r."id" = NEW."draft_revision_id";
  IF draft_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'approval_revision_missing';
  END IF;

  SELECT d."platform", d."active_revision_id"
  INTO draft_platform, current_revision_id
  FROM "platform_draft" d
  WHERE d."workspace_id" = NEW."workspace_id"
    AND d."id" = draft_id
    AND d."deleted_at" IS NULL
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'approval_draft_missing';
  END IF;

  SELECT r."selected_final_media_asset_id" INTO selected_media_id
  FROM "draft_revision" r
  WHERE r."workspace_id" = NEW."workspace_id"
    AND r."id" = NEW."draft_revision_id"
    AND r."platform_draft_id" = draft_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '23503', MESSAGE = 'approval_revision_missing';
  END IF;
  IF current_revision_id IS DISTINCT FROM NEW."draft_revision_id"
    OR draft_platform IS DISTINCT FROM NEW."platform"
    OR selected_media_id IS DISTINCT FROM NEW."selected_final_media_asset_id"
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_approval_exact_snapshot',
      MESSAGE = 'approval_exact_snapshot';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM "image_generation" g
    INNER JOIN "operation" o
      ON o."workspace_id" = g."workspace_id"
      AND o."id" = g."operation_id"
    WHERE g."workspace_id" = NEW."workspace_id"
      AND g."draft_revision_id" = NEW."draft_revision_id"
      AND o."lifecycle" IN ('queued', 'running', 'settling')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_approval_no_nonterminal_image_generation',
      MESSAGE = 'approval_image_generation_in_progress';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "approval_snapshot_guard"
BEFORE INSERT ON "approval"
FOR EACH ROW EXECUTE FUNCTION "validate_approval_snapshot"();--> statement-breakpoint
CREATE FUNCTION "reject_approval_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    CONSTRAINT = 'ck_approval_immutable',
    MESSAGE = 'approval_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "approval_immutable_update"
BEFORE UPDATE ON "approval"
FOR EACH ROW EXECUTE FUNCTION "reject_approval_mutation"();--> statement-breakpoint
CREATE TRIGGER "approval_immutable_delete"
BEFORE DELETE ON "approval"
FOR EACH ROW EXECUTE FUNCTION "reject_approval_mutation"();--> statement-breakpoint
CREATE FUNCTION "advance_platform_draft_projection_from_approval"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "platform_draft" d
  SET "projection_version" = d."projection_version" + 1,
      "updated_at" = now()
  FROM "draft_revision" r
  WHERE r."workspace_id" = NEW."workspace_id"
    AND r."id" = NEW."draft_revision_id"
    AND d."workspace_id" = r."workspace_id"
    AND d."id" = r."platform_draft_id";
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "approval_projection"
AFTER INSERT ON "approval"
FOR EACH ROW EXECUTE FUNCTION "advance_platform_draft_projection_from_approval"();
