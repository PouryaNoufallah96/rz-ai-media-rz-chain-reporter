CREATE TYPE "public"."draft_revision_command_kind" AS ENUM('apply_copy_variant', 'submit_content', 'adopt_image', 'remove_image');--> statement-breakpoint
CREATE TYPE "public"."image_source_projection_kind" AS ENUM('rss_extract', 'telegram_post', 'promo_idea');--> statement-breakpoint
CREATE TYPE "public"."media_derivation_purpose" AS ENUM('sharp_brand_logo');--> statement-breakpoint
CREATE TABLE "copy_generation" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform_draft_id" uuid NOT NULL,
	"requested_content_locale" "content_locale" NOT NULL,
	"model_option_key" text NOT NULL,
	"force_article_refresh" boolean DEFAULT false NOT NULL,
	"page_fetch_operation_attempt_id" uuid,
	"source_item_revision_id" uuid,
	"source_item_enrichment_id" uuid,
	"page_content_hash" text,
	"limited" boolean DEFAULT false NOT NULL,
	"limited_reason" text,
	"customer_template_fingerprint" text NOT NULL,
	"brand_policy_fingerprint" text NOT NULL,
	"prompt_version" text NOT NULL,
	"configuration_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_copy_generation_page_fetch_operation_attempt_id" UNIQUE("page_fetch_operation_attempt_id"),
	CONSTRAINT "ck_copy_generation_enrichment_provenance_complete" CHECK ("copy_generation"."source_item_enrichment_id" is null or ("copy_generation"."source_item_revision_id" is not null and "copy_generation"."page_content_hash" is not null)),
	CONSTRAINT "ck_copy_generation_limited_reason_consistent" CHECK ("copy_generation"."limited" = ("copy_generation"."limited_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "copy_generation_unit" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"copy_generation_id" uuid NOT NULL,
	"variant_key" text NOT NULL,
	"status" "model_unit_status" DEFAULT 'pending' NOT NULL,
	"operation_attempt_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_copy_generation_unit_workspace_generation_variant_key" UNIQUE("workspace_id","copy_generation_id","variant_key"),
	CONSTRAINT "uq_copy_generation_unit_operation_attempt_id" UNIQUE("operation_attempt_id"),
	CONSTRAINT "ck_copy_generation_unit_status_attempt_consistent" CHECK (("copy_generation_unit"."status" = 'pending' and "copy_generation_unit"."operation_attempt_id" is null) or ("copy_generation_unit"."status" in ('running', 'succeeded', 'failed') and "copy_generation_unit"."operation_attempt_id" is not null) or "copy_generation_unit"."status" = 'cancelled')
);
--> statement-breakpoint
CREATE TABLE "copy_variant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"copy_generation_unit_id" uuid NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"hashtags" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_copy_variant_copy_generation_unit_id" UNIQUE("copy_generation_unit_id"),
	CONSTRAINT "ck_copy_variant_headline_nonempty" CHECK (btrim("copy_variant"."headline") <> ''),
	CONSTRAINT "ck_copy_variant_body_nonempty" CHECK (btrim("copy_variant"."body") <> ''),
	CONSTRAINT "ck_copy_variant_hashtags_nonempty" CHECK (cardinality("copy_variant"."hashtags") > 0 and array_position("copy_variant"."hashtags", null) is null)
);
--> statement-breakpoint
CREATE TABLE "draft_revision_command_receipt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor_id" text NOT NULL,
	"platform_draft_id" uuid NOT NULL,
	"command_kind" "draft_revision_command_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"resulting_draft_revision_id" uuid NOT NULL,
	"appended_revision" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_draft_revision_command_receipt_identity" UNIQUE("workspace_id","actor_id","command_kind","idempotency_key"),
	CONSTRAINT "ck_draft_revision_command_receipt_idempotency_key_nonempty" CHECK (btrim("draft_revision_command_receipt"."idempotency_key") <> ''),
	CONSTRAINT "ck_draft_revision_command_receipt_request_hash_nonempty" CHECK (btrim("draft_revision_command_receipt"."request_hash") <> '')
);
--> statement-breakpoint
CREATE TABLE "image_brief" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"status" "model_unit_status" DEFAULT 'pending' NOT NULL,
	"terminal_failure_code" text,
	"template_selection" jsonb,
	"selection_rejections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"creative_brief" jsonb,
	"deterministic_fallback" boolean DEFAULT false NOT NULL,
	"fallback_code" text,
	"variety_degraded" boolean DEFAULT false NOT NULL,
	"repeated_image_variety_memory_id" uuid,
	"template_selection_operation_attempt_id" uuid NOT NULL,
	"creative_brief_operation_attempt_id" uuid,
	"operator_direction" text,
	"source_projection_kind" "image_source_projection_kind" NOT NULL,
	"source_projection_version" text NOT NULL,
	"source_projection_digest" text NOT NULL,
	"rss_source_item_enrichment_id" uuid,
	"rss_page_content_hash" text,
	"telegram_source_item_revision_id" uuid,
	"telegram_content_hash" text,
	"promo_idea_id" uuid,
	"brand_policy_fingerprint" text NOT NULL,
	"image_profile_fingerprint" text NOT NULL,
	"provider_prompt" text,
	"provider_prompt_digest" text,
	"prompt_schema_version" text NOT NULL,
	"assembler_version" text NOT NULL,
	"configuration_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_image_brief_template_selection_operation_attempt_id" UNIQUE("template_selection_operation_attempt_id"),
	CONSTRAINT "uq_image_brief_creative_brief_operation_attempt_id" UNIQUE("creative_brief_operation_attempt_id"),
	CONSTRAINT "ck_image_brief_template_selection_shape" CHECK ("image_brief"."template_selection" is null or (jsonb_typeof("image_brief"."template_selection") = 'object' and "image_brief"."template_selection" ?& array['family', 'axes'] and "image_brief"."template_selection" - array['family', 'axes'] = '{}'::jsonb and jsonb_typeof("image_brief"."template_selection"->'family') = 'string' and jsonb_typeof("image_brief"."template_selection"->'axes') = 'object')),
	CONSTRAINT "ck_image_brief_creative_brief_shape" CHECK ("image_brief"."creative_brief" is null or (jsonb_typeof("image_brief"."creative_brief") = 'object' and "image_brief"."creative_brief" ?& array['headline', 'subjectScene', 'dataElements'] and "image_brief"."creative_brief" - array['headline', 'subjectScene', 'dataElements'] = '{}'::jsonb and jsonb_typeof("image_brief"."creative_brief"->'headline') = 'string' and jsonb_typeof("image_brief"."creative_brief"->'subjectScene') = 'string' and jsonb_typeof("image_brief"."creative_brief"->'dataElements') = 'array')),
	CONSTRAINT "ck_image_brief_selection_rejections_shape" CHECK (jsonb_typeof("image_brief"."selection_rejections") = 'array' and jsonb_array_length("image_brief"."selection_rejections") <= 3),
	CONSTRAINT "ck_image_brief_source_projection_owner" CHECK (("image_brief"."source_projection_kind" = 'rss_extract' and "image_brief"."rss_source_item_enrichment_id" is not null and "image_brief"."rss_page_content_hash" is not null and "image_brief"."telegram_source_item_revision_id" is null and "image_brief"."telegram_content_hash" is null and "image_brief"."promo_idea_id" is null) or ("image_brief"."source_projection_kind" = 'telegram_post' and "image_brief"."rss_source_item_enrichment_id" is null and "image_brief"."rss_page_content_hash" is null and "image_brief"."telegram_source_item_revision_id" is not null and "image_brief"."telegram_content_hash" is not null and "image_brief"."promo_idea_id" is null) or ("image_brief"."source_projection_kind" = 'promo_idea' and "image_brief"."rss_source_item_enrichment_id" is null and "image_brief"."rss_page_content_hash" is null and "image_brief"."telegram_source_item_revision_id" is null and "image_brief"."telegram_content_hash" is null and "image_brief"."promo_idea_id" is not null)),
	CONSTRAINT "ck_image_brief_terminal_state_consistent" CHECK (("image_brief"."status" = 'succeeded' and "image_brief"."template_selection" is not null and "image_brief"."creative_brief" is not null and "image_brief"."provider_prompt" is not null and "image_brief"."provider_prompt_digest" is not null and "image_brief"."terminal_failure_code" is null) or ("image_brief"."status" = 'failed' and "image_brief"."terminal_failure_code" is not null and "image_brief"."provider_prompt" is null) or "image_brief"."status" in ('pending', 'running', 'cancelled')),
	CONSTRAINT "ck_image_brief_succeeded_creative_attempt_consistent" CHECK ("image_brief"."status" <> 'succeeded' or (("image_brief"."creative_brief_operation_attempt_id" is null) = "image_brief"."deterministic_fallback")),
	CONSTRAINT "ck_image_brief_repeated_memory_consistent" CHECK ("image_brief"."repeated_image_variety_memory_id" is null or ("image_brief"."deterministic_fallback" and "image_brief"."variety_degraded")),
	CONSTRAINT "ck_image_brief_provider_prompt_digest_consistent" CHECK (("image_brief"."provider_prompt" is null) = ("image_brief"."provider_prompt_digest" is null))
);
--> statement-breakpoint
CREATE TABLE "image_generation" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"image_brief_id" uuid,
	"model_option_key" text NOT NULL,
	"reference_media_asset_id" uuid,
	"provider_generation_operation_attempt_id" uuid,
	"provider_original_media_asset_id" uuid,
	"final_media_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_image_generation_provider_generation_operation_attempt_id" UNIQUE("provider_generation_operation_attempt_id"),
	CONSTRAINT "uq_image_generation_provider_original_media_asset_id" UNIQUE("provider_original_media_asset_id"),
	CONSTRAINT "uq_image_generation_final_media_asset_id" UNIQUE("final_media_asset_id"),
	CONSTRAINT "ck_image_generation_distinct_media_roles" CHECK (("image_generation"."reference_media_asset_id" is null or "image_generation"."provider_original_media_asset_id" is null or "image_generation"."reference_media_asset_id" <> "image_generation"."provider_original_media_asset_id") and ("image_generation"."reference_media_asset_id" is null or "image_generation"."final_media_asset_id" is null or "image_generation"."reference_media_asset_id" <> "image_generation"."final_media_asset_id") and ("image_generation"."provider_original_media_asset_id" is null or "image_generation"."final_media_asset_id" is null or "image_generation"."provider_original_media_asset_id" <> "image_generation"."final_media_asset_id")),
	CONSTRAINT "ck_image_generation_final_requires_original" CHECK ("image_generation"."final_media_asset_id" is null or "image_generation"."provider_original_media_asset_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "image_variety_memory" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"media_brand_id" uuid NOT NULL,
	"selection_signature" text NOT NULL,
	"image_generation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_image_variety_memory_workspace_image_generation_id" UNIQUE("workspace_id","image_generation_id"),
	CONSTRAINT "ck_image_variety_memory_selection_signature_sha256" CHECK (length("image_variety_memory"."selection_signature") = 64 and "image_variety_memory"."selection_signature" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "platform_draft"
		WHERE "id" <> '019b76da-a800-7000-8000-000000000002'::uuid
	) OR (
		SELECT count(*) FROM "platform_draft"
	) > 1 THEN
		RAISE EXCEPTION '0016 refuses to reshape non-fixture platform drafts';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "draft_revision"
		WHERE "id" <> '019b76da-a800-7000-8000-000000000003'::uuid
			OR "platform_draft_id" <> '019b76da-a800-7000-8000-000000000002'::uuid
	) OR (
		SELECT count(*) FROM "draft_revision"
	) <> (
		SELECT count(*) FROM "platform_draft"
	) THEN
		RAISE EXCEPTION '0016 refuses to reshape non-fixture draft revisions';
	END IF;

	IF EXISTS (SELECT 1 FROM "media_derivation")
		OR EXISTS (SELECT 1 FROM "activity_event")
		OR EXISTS (SELECT 1 FROM "approval")
		OR EXISTS (SELECT 1 FROM "publish_operation")
		OR EXISTS (SELECT 1 FROM "saved_card") THEN
		RAISE EXCEPTION '0016 refuses to reshape non-fixture draft consumers';
	END IF;

	IF EXISTS (
		SELECT 1
		FROM "schedule" AS "s"
		WHERE "s"."draft_revision_id" <> '019b76da-a800-7000-8000-000000000003'::uuid
			OR NOT EXISTS (
				SELECT 1
				FROM "outbox_event" AS "e"
				INNER JOIN "operation" AS "o" ON "o"."id" = "e"."operation_id"
				WHERE "e"."payload"->>'scheduleId' = "s"."id"::text
					AND "o"."command_type" LIKE 'scheduled-effect-probe:%'
			)
	) THEN
		RAISE EXCEPTION '0016 refuses to remove non-diagnostic schedules';
	END IF;
END $$;
--> statement-breakpoint
DELETE FROM "schedule"
WHERE "draft_revision_id" = '019b76da-a800-7000-8000-000000000003'::uuid;
--> statement-breakpoint
DELETE FROM "draft_revision"
WHERE "id" = '019b76da-a800-7000-8000-000000000003'::uuid;
--> statement-breakpoint
DELETE FROM "platform_draft"
WHERE "id" = '019b76da-a800-7000-8000-000000000002'::uuid;
--> statement-breakpoint
ALTER TABLE "draft_revision" RENAME COLUMN "copy" TO "body";--> statement-breakpoint
ALTER TABLE "draft_revision" RENAME COLUMN "media_asset_id" TO "selected_final_media_asset_id";--> statement-breakpoint
ALTER TABLE "media_derivation" RENAME COLUMN "media_asset_id" TO "source_media_asset_id";--> statement-breakpoint
ALTER TABLE "draft_revision" DROP CONSTRAINT "uq_draft_revision_workspace_id_platform_draft_id_revis_570bf336";--> statement-breakpoint
ALTER TABLE "media_derivation" DROP CONSTRAINT "uq_media_derivation_workspace_id_object_key";--> statement-breakpoint
ALTER TABLE "draft_revision" DROP CONSTRAINT "fk_draft_revision_media_asset_id";
--> statement-breakpoint
ALTER TABLE "draft_revision" DROP CONSTRAINT "fk_draft_revision_platform_draft_id";
--> statement-breakpoint
ALTER TABLE "media_derivation" DROP CONSTRAINT "fk_media_derivation_media_asset_id";
--> statement-breakpoint
ALTER TABLE "platform_draft" DROP CONSTRAINT "fk_platform_draft_source_item_id";
--> statement-breakpoint
ALTER TABLE "draft_revision" ALTER COLUMN "headline" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_revision" ALTER COLUMN "hashtags" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "draft_revision" ALTER COLUMN "authored_by" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "media_derivation" ALTER COLUMN "purpose" SET DATA TYPE "public"."media_derivation_purpose" USING "purpose"::"public"."media_derivation_purpose";--> statement-breakpoint
ALTER TABLE "source_item_enrichment" ALTER COLUMN "brief" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD COLUMN "originating_copy_variant_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "media_derivation" ADD COLUMN "derived_media_asset_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "telegram_filter_result_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "promo_idea_id" uuid;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "lane_position" integer NOT NULL;--> statement-breakpoint
ALTER TABLE "copy_generation" ADD CONSTRAINT "fk_copy_generation_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation" ADD CONSTRAINT "fk_copy_generation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation" ADD CONSTRAINT "fk_copy_generation_platform_draft_id" FOREIGN KEY ("platform_draft_id") REFERENCES "public"."platform_draft"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation" ADD CONSTRAINT "fk_copy_generation_page_fetch_operation_attempt_id" FOREIGN KEY ("page_fetch_operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation" ADD CONSTRAINT "fk_copy_generation_source_item_revision_id" FOREIGN KEY ("source_item_revision_id") REFERENCES "public"."source_item_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation" ADD CONSTRAINT "fk_copy_generation_source_item_enrichment_id" FOREIGN KEY ("source_item_enrichment_id") REFERENCES "public"."source_item_enrichment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation_unit" ADD CONSTRAINT "fk_copy_generation_unit_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation_unit" ADD CONSTRAINT "fk_copy_generation_unit_copy_generation_id" FOREIGN KEY ("copy_generation_id") REFERENCES "public"."copy_generation"("operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_generation_unit" ADD CONSTRAINT "fk_copy_generation_unit_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant" ADD CONSTRAINT "fk_copy_variant_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant" ADD CONSTRAINT "fk_copy_variant_copy_generation_unit_id" FOREIGN KEY ("copy_generation_unit_id") REFERENCES "public"."copy_generation_unit"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision_command_receipt" ADD CONSTRAINT "fk_draft_revision_command_receipt_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision_command_receipt" ADD CONSTRAINT "fk_draft_revision_command_receipt_actor_id" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision_command_receipt" ADD CONSTRAINT "fk_draft_revision_command_receipt_platform_draft_id" FOREIGN KEY ("platform_draft_id") REFERENCES "public"."platform_draft"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision_command_receipt" ADD CONSTRAINT "fk_draft_revision_command_receipt_resulting_draft_revision_id" FOREIGN KEY ("resulting_draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_repeated_image_variety_memory_id" FOREIGN KEY ("repeated_image_variety_memory_id") REFERENCES "public"."image_variety_memory"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_template_selection_operation_attempt_id" FOREIGN KEY ("template_selection_operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_creative_brief_operation_attempt_id" FOREIGN KEY ("creative_brief_operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_rss_source_item_enrichment_id" FOREIGN KEY ("rss_source_item_enrichment_id") REFERENCES "public"."source_item_enrichment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_telegram_source_item_revision_id" FOREIGN KEY ("telegram_source_item_revision_id") REFERENCES "public"."source_item_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_brief" ADD CONSTRAINT "fk_image_brief_promo_idea_id" FOREIGN KEY ("promo_idea_id") REFERENCES "public"."promo_idea"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_image_brief_id" FOREIGN KEY ("image_brief_id") REFERENCES "public"."image_brief"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_reference_media_asset_id" FOREIGN KEY ("reference_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_provider_generation_operation_attempt_id" FOREIGN KEY ("provider_generation_operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_provider_original_media_asset_id" FOREIGN KEY ("provider_original_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_final_media_asset_id" FOREIGN KEY ("final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivation" ADD CONSTRAINT "uq_media_derivation_workspace_derived_media_asset_id" UNIQUE("workspace_id","derived_media_asset_id");--> statement-breakpoint
ALTER TABLE "image_generation" ADD CONSTRAINT "fk_image_generation_final_media_derivation" FOREIGN KEY ("workspace_id","final_media_asset_id") REFERENCES "public"."media_derivation"("workspace_id","derived_media_asset_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_variety_memory" ADD CONSTRAINT "fk_image_variety_memory_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_variety_memory" ADD CONSTRAINT "fk_image_variety_memory_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "image_variety_memory" ADD CONSTRAINT "fk_image_variety_memory_image_generation_id" FOREIGN KEY ("image_generation_id") REFERENCES "public"."image_generation"("operation_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_copy_generation_workspace_platform_draft_created_at" ON "copy_generation" USING btree ("workspace_id","platform_draft_id","created_at" DESC NULLS LAST,"operation_id");--> statement-breakpoint
CREATE INDEX "ix_image_brief_workspace_draft_revision_created_at" ON "image_brief" USING btree ("workspace_id","draft_revision_id","created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "ix_image_generation_workspace_image_brief_created_at" ON "image_generation" USING btree ("workspace_id","image_brief_id","created_at" DESC NULLS LAST,"operation_id");--> statement-breakpoint
CREATE INDEX "ix_image_generation_workspace_final_media_asset_id" ON "image_generation" USING btree ("workspace_id","final_media_asset_id");--> statement-breakpoint
CREATE INDEX "ix_image_variety_memory_workspace_brand_created_at_id" ON "image_variety_memory" USING btree ("workspace_id","media_brand_id","created_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_originating_copy_variant_id" FOREIGN KEY ("originating_copy_variant_id") REFERENCES "public"."copy_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_selected_final_media_asset_id" FOREIGN KEY ("selected_final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_platform_draft_id" FOREIGN KEY ("platform_draft_id") REFERENCES "public"."platform_draft"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivation" ADD CONSTRAINT "fk_media_derivation_source_media_asset_id" FOREIGN KEY ("source_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivation" ADD CONSTRAINT "fk_media_derivation_derived_media_asset_id" FOREIGN KEY ("derived_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_telegram_filter_result_id" FOREIGN KEY ("telegram_filter_result_id") REFERENCES "public"."filter_result"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_promo_idea_id" FOREIGN KEY ("promo_idea_id") REFERENCES "public"."promo_idea"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_platform_draft_active_editorial_selection_route" ON "platform_draft" USING btree ("workspace_id","editorial_selection_id","media_brand_id","platform") WHERE "platform_draft"."deleted_at" is null and "platform_draft"."editorial_selection_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_platform_draft_active_telegram_filter_result_route" ON "platform_draft" USING btree ("workspace_id","telegram_filter_result_id","media_brand_id","platform") WHERE "platform_draft"."deleted_at" is null and "platform_draft"."telegram_filter_result_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_platform_draft_active_promo_idea_route" ON "platform_draft" USING btree ("workspace_id","promo_idea_id","media_brand_id","platform") WHERE "platform_draft"."deleted_at" is null and "platform_draft"."promo_idea_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_platform_draft_active_workspace_media_brand_platform" ON "platform_draft" USING btree ("workspace_id","media_brand_id","platform","lane_position","id") WHERE "platform_draft"."deleted_at" is null;--> statement-breakpoint
CREATE INDEX "ix_platform_draft_workspace_editorial_selection_id" ON "platform_draft" USING btree ("workspace_id","editorial_selection_id");--> statement-breakpoint
CREATE INDEX "ix_platform_draft_workspace_telegram_filter_result_id" ON "platform_draft" USING btree ("workspace_id","telegram_filter_result_id");--> statement-breakpoint
CREATE INDEX "ix_platform_draft_workspace_promo_idea_id" ON "platform_draft" USING btree ("workspace_id","promo_idea_id");--> statement-breakpoint
ALTER TABLE "draft_revision" DROP COLUMN "variants";--> statement-breakpoint
ALTER TABLE "draft_revision" DROP COLUMN "editorial_model";--> statement-breakpoint
ALTER TABLE "draft_revision" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "media_derivation" DROP COLUMN "object_key";--> statement-breakpoint
ALTER TABLE "media_derivation" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "platform_draft" DROP COLUMN "content_locale";--> statement-breakpoint
ALTER TABLE "platform_draft" DROP COLUMN "source_item_id";--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "uq_draft_revision_workspace_platform_draft_revision_number" UNIQUE("workspace_id","platform_draft_id","revision_number");--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "ck_draft_revision_revision_number_positive" CHECK ("draft_revision"."revision_number" > 0);--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "ck_draft_revision_headline_nonempty" CHECK (btrim("draft_revision"."headline") <> '');--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "ck_draft_revision_body_nonempty" CHECK (btrim("draft_revision"."body") <> '');--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "ck_draft_revision_hashtags_nonempty" CHECK (cardinality("draft_revision"."hashtags") > 0 and array_position("draft_revision"."hashtags", null) is null);--> statement-breakpoint
ALTER TABLE "media_derivation" ADD CONSTRAINT "ck_media_derivation_distinct_assets" CHECK ("media_derivation"."source_media_asset_id" <> "media_derivation"."derived_media_asset_id");--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "ck_platform_draft_exactly_one_origin" CHECK (num_nonnulls("platform_draft"."editorial_selection_id", "platform_draft"."telegram_filter_result_id", "platform_draft"."promo_idea_id") = 1);--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "ck_platform_draft_lane_position_positive" CHECK ("platform_draft"."lane_position" > 0);--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "ck_platform_draft_version_positive" CHECK ("platform_draft"."version" > 0);
