CREATE TABLE "editorial_presentation_localization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_item_revision_id" uuid,
	"editorial_selection_id" uuid,
	"promo_idea_id" uuid,
	"presentation_locale" "content_locale" NOT NULL,
	"operation_attempt_id" uuid NOT NULL,
	"title" text,
	"summary" text,
	"reasoning" text,
	"description" text,
	"angle" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_editorial_presentation_localization_exactly_one_subject" CHECK (num_nonnulls("editorial_presentation_localization"."source_item_revision_id", "editorial_presentation_localization"."editorial_selection_id", "editorial_presentation_localization"."promo_idea_id") = 1),
	CONSTRAINT "ck_editorial_presentation_localization_payload_shape" CHECK ((
          "editorial_presentation_localization"."source_item_revision_id" is not null
          and "editorial_presentation_localization"."title" is not null
          and btrim("editorial_presentation_localization"."title") <> ''
          and ("editorial_presentation_localization"."summary" is null or btrim("editorial_presentation_localization"."summary") <> '')
          and "editorial_presentation_localization"."reasoning" is null
          and "editorial_presentation_localization"."description" is null
          and "editorial_presentation_localization"."angle" is null
        ) or (
          "editorial_presentation_localization"."editorial_selection_id" is not null
          and "editorial_presentation_localization"."reasoning" is not null
          and btrim("editorial_presentation_localization"."reasoning") <> ''
          and "editorial_presentation_localization"."title" is null
          and "editorial_presentation_localization"."summary" is null
          and "editorial_presentation_localization"."description" is null
          and "editorial_presentation_localization"."angle" is null
        ) or (
          "editorial_presentation_localization"."promo_idea_id" is not null
          and "editorial_presentation_localization"."title" is not null
          and btrim("editorial_presentation_localization"."title") <> ''
          and "editorial_presentation_localization"."description" is not null
          and btrim("editorial_presentation_localization"."description") <> ''
          and "editorial_presentation_localization"."angle" is not null
          and btrim("editorial_presentation_localization"."angle") <> ''
          and "editorial_presentation_localization"."summary" is null
          and "editorial_presentation_localization"."reasoning" is null
        ))
);
--> statement-breakpoint
ALTER TABLE "source_import" ADD COLUMN "effective_topics" jsonb;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization" ADD CONSTRAINT "fk_editorial_presentation_localization_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization" ADD CONSTRAINT "fk_editorial_presentation_localization_source_item_revision_id" FOREIGN KEY ("source_item_revision_id") REFERENCES "public"."source_item_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization" ADD CONSTRAINT "fk_editorial_presentation_localization_editorial_selection_id" FOREIGN KEY ("editorial_selection_id") REFERENCES "public"."editorial_selection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization" ADD CONSTRAINT "fk_editorial_presentation_localization_promo_idea_id" FOREIGN KEY ("promo_idea_id") REFERENCES "public"."promo_idea"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization" ADD CONSTRAINT "fk_editorial_presentation_localization_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_editorial_presentation_localization_source_revision_locale" ON "editorial_presentation_localization" USING btree ("workspace_id","source_item_revision_id","presentation_locale") WHERE "editorial_presentation_localization"."source_item_revision_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_editorial_presentation_localization_selection_locale" ON "editorial_presentation_localization" USING btree ("workspace_id","editorial_selection_id","presentation_locale") WHERE "editorial_presentation_localization"."editorial_selection_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_editorial_presentation_localization_promo_idea_locale" ON "editorial_presentation_localization" USING btree ("workspace_id","promo_idea_id","presentation_locale") WHERE "editorial_presentation_localization"."promo_idea_id" is not null;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "ck_source_import_effective_topics_shape" CHECK ("source_import"."effective_topics" is null or (
        jsonb_typeof("source_import"."effective_topics") = 'object'
        and "source_import"."effective_topics" ?& array['contentLocale', 'values', 'usedOriginalFallback']
        and "source_import"."effective_topics" - array['contentLocale', 'values', 'usedOriginalFallback'] = '{}'::jsonb
        and jsonb_typeof("source_import"."effective_topics"->'contentLocale') = 'string'
        and "source_import"."effective_topics"->>'contentLocale' in ('en', 'fa')
        and jsonb_typeof("source_import"."effective_topics"->'values') = 'array'
        and not jsonb_path_exists("source_import"."effective_topics"->'values', '$[*] ? (@.type() != "string")')
        and jsonb_array_length("source_import"."effective_topics"->'values') = cardinality("source_import"."topics")
        and jsonb_typeof("source_import"."effective_topics"->'usedOriginalFallback') = 'boolean'
      ));