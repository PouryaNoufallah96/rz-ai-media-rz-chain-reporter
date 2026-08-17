-- Content identity and media. Revisions and derivations are aggregate-owned and
-- cascade; everything a later step pins or attributes -- revisions from approval,
-- assets from revisions, drafts from saved cards, users, workspace -- restricts.
-- uq_saved_card_workspace_id_saved_by_platform_draft_id_active is the partial
-- unique that collapses the legacy duplicate-save defect; its name is also the
-- SQLSTATE walker's discriminator, so renaming it silently unmaps 23505.
-- uq_draft_revision_workspace_id_platform_draft_id_revis_570bf336 is the 63-byte
-- form of uq_draft_revision_workspace_id_platform_draft_id_revision_number
-- (64 bytes) under the vocabulary §7.3 rule; both names are recorded here so the
-- mapping stays recoverable without re-deriving it.
-- Forward recovery: no rows exist yet, so a later migration can drop these six
-- tables in reverse dependency order; the eight enum types belong to 0003.
CREATE TABLE "approval" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"decided_by" text NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "draft_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform_draft_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"headline" text,
	"copy" text NOT NULL,
	"hashtags" text[] DEFAULT '{}' NOT NULL,
	"variants" jsonb,
	"authored_by" text,
	"editorial_model" "editorial_model",
	"media_asset_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_draft_revision_workspace_id_platform_draft_id_revis_570bf336" UNIQUE("workspace_id","platform_draft_id","revision_number")
);
--> statement-breakpoint
CREATE TABLE "media_asset" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"declared_bytes" bigint NOT NULL,
	"actual_bytes" bigint,
	"checksum" text,
	"width" integer,
	"height" integer,
	"lifecycle" "media_asset_lifecycle" DEFAULT 'pending' NOT NULL,
	"upload_expires_at" timestamp with time zone,
	"cleanup_after" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_asset_workspace_id_object_key" UNIQUE("workspace_id","object_key")
);
--> statement-breakpoint
CREATE TABLE "media_derivation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"object_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_derivation_workspace_id_object_key" UNIQUE("workspace_id","object_key")
);
--> statement-breakpoint
CREATE TABLE "platform_draft" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"media_brand" "media_brand" NOT NULL,
	"platform" "platform" NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"editorial_selection_id" uuid,
	"source_item_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "saved_card" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform_draft_id" uuid NOT NULL,
	"content_card_id" uuid NOT NULL,
	"saved_by" text NOT NULL,
	"discarded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "fk_approval_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "fk_approval_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "fk_approval_decided_by" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_platform_draft_id" FOREIGN KEY ("platform_draft_id") REFERENCES "public"."platform_draft"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_media_asset_id" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "draft_revision" ADD CONSTRAINT "fk_draft_revision_authored_by" FOREIGN KEY ("authored_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_asset" ADD CONSTRAINT "fk_media_asset_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivation" ADD CONSTRAINT "fk_media_derivation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_derivation" ADD CONSTRAINT "fk_media_derivation_media_asset_id" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_editorial_selection_id" FOREIGN KEY ("editorial_selection_id") REFERENCES "public"."editorial_selection"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_source_item_id" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_card" ADD CONSTRAINT "fk_saved_card_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_card" ADD CONSTRAINT "fk_saved_card_platform_draft_id" FOREIGN KEY ("platform_draft_id") REFERENCES "public"."platform_draft"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_card" ADD CONSTRAINT "fk_saved_card_content_card_id" FOREIGN KEY ("content_card_id") REFERENCES "public"."platform_draft"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_card" ADD CONSTRAINT "fk_saved_card_saved_by" FOREIGN KEY ("saved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_saved_card_workspace_id_saved_by_platform_draft_id_active" ON "saved_card" USING btree ("workspace_id","saved_by","platform_draft_id") WHERE discarded_at is null;