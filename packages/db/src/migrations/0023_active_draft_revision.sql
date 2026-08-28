ALTER TYPE "public"."draft_revision_command_kind" ADD VALUE 'select_revision';--> statement-breakpoint
ALTER TABLE "image_generation" ADD COLUMN "expected_revision_version" integer;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "active_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "revision_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "uq_draft_revision_workspace_platform_draft_id" UNIQUE("workspace_id","platform_draft_id","id");--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_active_revision" FOREIGN KEY ("workspace_id","id","active_revision_id") REFERENCES "public"."draft_revision"("workspace_id","platform_draft_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "ck_image_generation_expected_revision_version_nonnegative" CHECK ("image_generation"."expected_revision_version" is null or "image_generation"."expected_revision_version" >= 0);--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "ck_platform_draft_revision_version_nonnegative" CHECK ("platform_draft"."revision_version" >= 0);--> statement-breakpoint
UPDATE "platform_draft" AS draft
SET "active_revision_id" = revision.id, "revision_version" = 1
FROM (
  SELECT DISTINCT ON ("workspace_id", "platform_draft_id")
    "workspace_id", "platform_draft_id", "id"
  FROM "draft_revision"
  ORDER BY "workspace_id", "platform_draft_id", "revision_number" DESC
) AS revision
WHERE draft."workspace_id" = revision."workspace_id"
  AND draft."id" = revision."platform_draft_id";--> statement-breakpoint
CREATE FUNCTION "reject_draft_revision_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      CONSTRAINT = 'ck_draft_revision_immutable',
      MESSAGE = 'draft_revision_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "draft_revision_immutable"
BEFORE UPDATE ON "draft_revision"
FOR EACH ROW EXECUTE FUNCTION "reject_draft_revision_update"();
