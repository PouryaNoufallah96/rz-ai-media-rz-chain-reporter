-- Product-model correction. media_brand and editorial_model were one customer's
-- value sets written into core DDL, which made onboarding another customer a
-- schema migration. media_brand becomes template-seeded reference data every
-- consumer restricts against; editorial_model becomes a plain text key because
-- it records which model produced a selection and models reach code through
-- ModelGateway, so no adapter-per-model exists to close the set. platform stays
-- an enum: a destination platform exists only once its adapter ships.
-- destination_account carries the stable key deployment configuration resolves
-- to a credential; no secret value and no environment-variable name is stored,
-- and metadata is non-secret platform detail only. Its mapping to media_brand is
-- many-to-many in both directions and both edges restrict, because the mapping is
-- template configuration that removing either side must not silently drop.
-- projection_operation existed only for the retired Google Sheets projection and
-- usage_reservation only for a quota model that no longer exists; both are
-- dropped without CASCADE so a forgotten dependant would fail this migration
-- rather than be silently removed.
-- Statement order is load-bearing and is not drizzle-kit's emitted order: a table
-- carries an associated type of the same name, so "media_brand" cannot be created
-- until the enum type of that name is gone, and the type cannot be dropped until
-- both columns using it are. Every drop therefore precedes every create.
-- Two assembled names exceeded 63 bytes and are stored under the vocabulary §7.3
-- truncation; both forms are recorded here so the mapping stays recoverable:
--   uq_editorial_selection_workspace_id_analysis_run_id_editorial_model_media_brand_id_rank (87)
--     -> uq_editorial_selection_workspace_id_analysis_run_id_ed_838762e6
--   uq_media_brand_destination_account_workspace_id_media_brand_id_destination_account_id (85)
--     -> uq_media_brand_destination_account_workspace_id_media__6f636d2f
-- No data migration: zero rows exist in editorial_selection and platform_draft,
-- which is why the two media_brand_id columns can be added NOT NULL outright. On
-- a database holding rows this migration fails loudly, and correctly — an enum
-- label cannot be resolved to a media_brand row that does not exist yet.
-- Forward recovery: re-adding either enum means re-creating the type, adding the
-- enum column back, dropping the FK column and rebuilding the unique constraint
-- under its own §7.3 name; the retired tables are re-created from 0005.
ALTER TABLE "editorial_selection" DROP CONSTRAINT "uq_editorial_selection_workspace_id_analysis_run_id_ed_4eeeb797";--> statement-breakpoint
ALTER TABLE "draft_revision" ALTER COLUMN "editorial_model" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "editorial_selection" ALTER COLUMN "editorial_model" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "editorial_selection" DROP COLUMN "media_brand";--> statement-breakpoint
ALTER TABLE "platform_draft" DROP COLUMN "media_brand";--> statement-breakpoint
DROP TABLE "projection_operation";--> statement-breakpoint
DROP TABLE "usage_reservation";--> statement-breakpoint
DROP TYPE "public"."editorial_model";--> statement-breakpoint
DROP TYPE "public"."media_brand";--> statement-breakpoint
DROP TYPE "public"."usage_reservation_state";--> statement-breakpoint
CREATE TABLE "media_brand" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_brand_workspace_id_key" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "destination_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"platform" "platform" NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_destination_account_workspace_id_key" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
CREATE TABLE "media_brand_destination_account" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"media_brand_id" uuid NOT NULL,
	"destination_account_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_media_brand_destination_account_workspace_id_media__6f636d2f" UNIQUE("workspace_id","media_brand_id","destination_account_id")
);
--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD COLUMN "media_brand_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD COLUMN "media_brand_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "media_brand" ADD CONSTRAINT "fk_media_brand_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destination_account" ADD CONSTRAINT "fk_destination_account_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_brand_destination_account" ADD CONSTRAINT "fk_media_brand_destination_account_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_brand_destination_account" ADD CONSTRAINT "fk_media_brand_destination_account_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_brand_destination_account" ADD CONSTRAINT "fk_media_brand_destination_account_destination_account_id" FOREIGN KEY ("destination_account_id") REFERENCES "public"."destination_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "fk_editorial_selection_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_draft" ADD CONSTRAINT "fk_platform_draft_media_brand_id" FOREIGN KEY ("media_brand_id") REFERENCES "public"."media_brand"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "uq_editorial_selection_workspace_id_analysis_run_id_ed_838762e6" UNIQUE("workspace_id","analysis_run_id","editorial_model","media_brand_id","rank");
