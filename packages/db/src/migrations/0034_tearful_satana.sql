CREATE TABLE "copy_variant_localization" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"copy_variant_id" uuid NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"operation_attempt_id" uuid NOT NULL,
	"headline" text NOT NULL,
	"body" text NOT NULL,
	"hashtags" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_copy_variant_localization_variant_locale" UNIQUE("workspace_id","copy_variant_id","content_locale"),
	CONSTRAINT "ck_copy_variant_localization_headline_nonempty" CHECK (btrim("copy_variant_localization"."headline") <> ''),
	CONSTRAINT "ck_copy_variant_localization_body_nonempty" CHECK (btrim("copy_variant_localization"."body") <> ''),
	CONSTRAINT "ck_copy_variant_localization_hashtags_nonempty" CHECK (cardinality("copy_variant_localization"."hashtags") > 0 and array_position("copy_variant_localization"."hashtags", null) is null)
);
--> statement-breakpoint
CREATE TABLE "copy_variant_localization_request" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"copy_variant_id" uuid NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "copy_variant_localization" ADD CONSTRAINT "fk_copy_variant_localization_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant_localization" ADD CONSTRAINT "fk_copy_variant_localization_copy_variant_id" FOREIGN KEY ("copy_variant_id") REFERENCES "public"."copy_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant_localization" ADD CONSTRAINT "fk_copy_variant_localization_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant_localization_request" ADD CONSTRAINT "fk_copy_variant_translation_request_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant_localization_request" ADD CONSTRAINT "fk_copy_variant_translation_request_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copy_variant_localization_request" ADD CONSTRAINT "fk_copy_variant_translation_request_copy_variant_id" FOREIGN KEY ("copy_variant_id") REFERENCES "public"."copy_variant"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_copy_variant_translation_request_variant_locale" ON "copy_variant_localization_request" USING btree ("workspace_id","copy_variant_id","content_locale","created_at" DESC NULLS LAST,"operation_id");