CREATE TABLE "editorial_presentation_localization_request" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"editorial_selection_id" uuid,
	"telegram_filter_result_id" uuid,
	"promo_idea_id" uuid,
	"presentation_locale" "content_locale" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_presentation_translation_request_exactly_one_origin" CHECK (num_nonnulls("editorial_presentation_localization_request"."editorial_selection_id", "editorial_presentation_localization_request"."telegram_filter_result_id", "editorial_presentation_localization_request"."promo_idea_id") = 1)
);
--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization_request" ADD CONSTRAINT "fk_presentation_translation_request_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization_request" ADD CONSTRAINT "fk_presentation_translation_request_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization_request" ADD CONSTRAINT "fk_presentation_translation_request_selection_id" FOREIGN KEY ("editorial_selection_id") REFERENCES "public"."editorial_selection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization_request" ADD CONSTRAINT "fk_presentation_translation_request_filter_result_id" FOREIGN KEY ("telegram_filter_result_id") REFERENCES "public"."filter_result"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_presentation_localization_request" ADD CONSTRAINT "fk_presentation_translation_request_promo_idea_id" FOREIGN KEY ("promo_idea_id") REFERENCES "public"."promo_idea"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_presentation_translation_request_selection_locale" ON "editorial_presentation_localization_request" USING btree ("workspace_id","editorial_selection_id","presentation_locale","created_at" DESC NULLS LAST,"operation_id") WHERE "editorial_presentation_localization_request"."editorial_selection_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_presentation_translation_request_telegram_locale" ON "editorial_presentation_localization_request" USING btree ("workspace_id","telegram_filter_result_id","presentation_locale","created_at" DESC NULLS LAST,"operation_id") WHERE "editorial_presentation_localization_request"."telegram_filter_result_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_presentation_translation_request_promo_locale" ON "editorial_presentation_localization_request" USING btree ("workspace_id","promo_idea_id","presentation_locale","created_at" DESC NULLS LAST,"operation_id") WHERE "editorial_presentation_localization_request"."promo_idea_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_presentation_translation_request_recent" ON "editorial_presentation_localization_request" USING btree ("workspace_id","created_at" DESC NULLS LAST,"operation_id");