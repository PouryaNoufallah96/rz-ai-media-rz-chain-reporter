-- Source and analysis provenance. filter_result is owned by its run and
-- cascades with it; editorial_selection is provenance for every draft made from
-- it and therefore restricts, as does every source_item and workspace edge.
-- uq_editorial_selection_workspace_id_analysis_run_id_ed_4eeeb797 is the 63-byte
-- form of uq_editorial_selection_workspace_id_analysis_run_id_editorial_model_media_brand_rank
-- (84 bytes) under the vocabulary §7.3 rule; both names are recorded here so the
-- mapping stays recoverable without re-deriving it.
-- analysis_run carries no operation_id yet: the operation table does not exist,
-- and an unenforced uuid column is the legacy defect this schema corrects. The
-- migration that creates operation adds the column with fk_analysis_run_operation_id.
-- Forward recovery: nothing outside this migration references these four tables,
-- so a later migration can drop them and the eight types in reverse order.
CREATE TYPE "public"."analysis_run_kind" AS ENUM('news', 'promo');--> statement-breakpoint
CREATE TYPE "public"."content_locale" AS ENUM('en', 'fa');--> statement-breakpoint
CREATE TYPE "public"."editorial_model" AS ENUM('gpt', 'gemini', 'claude', 'deepseek');--> statement-breakpoint
CREATE TYPE "public"."filter_disposition" AS ENUM('rejected', 'scored', 'clustered', 'routed');--> statement-breakpoint
CREATE TYPE "public"."media_asset_lifecycle" AS ENUM('pending', 'uploaded', 'validating', 'verified', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."media_brand" AS ENUM('rz_prime', 'coin_hall', 'chain_reporter', 'meta_coin_guard');--> statement-breakpoint
CREATE TYPE "public"."platform" AS ENUM('x', 'telegram', 'instagram');--> statement-breakpoint
CREATE TYPE "public"."source_origin" AS ENUM('rss', 'telegram_public');--> statement-breakpoint
CREATE TABLE "analysis_run" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" "analysis_run_kind" NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "editorial_selection" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"editorial_model" "editorial_model" NOT NULL,
	"media_brand" "media_brand" NOT NULL,
	"rank" integer NOT NULL,
	"source_item_id" uuid NOT NULL,
	"reasoning" text,
	"scores" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_editorial_selection_workspace_id_analysis_run_id_ed_4eeeb797" UNIQUE("workspace_id","analysis_run_id","editorial_model","media_brand","rank")
);
--> statement-breakpoint
CREATE TABLE "filter_result" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"analysis_run_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"disposition" "filter_disposition" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_filter_result_workspace_id_analysis_run_id_source_item_id" UNIQUE("workspace_id","analysis_run_id","source_item_id")
);
--> statement-breakpoint
CREATE TABLE "source_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"origin" "source_origin" NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"attribution" text NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_item_workspace_id_origin_external_id" UNIQUE("workspace_id","origin","external_id")
);
--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "fk_analysis_run_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "fk_editorial_selection_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "fk_editorial_selection_analysis_run_id" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_run"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "editorial_selection" ADD CONSTRAINT "fk_editorial_selection_source_item_id" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_result" ADD CONSTRAINT "fk_filter_result_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_result" ADD CONSTRAINT "fk_filter_result_analysis_run_id" FOREIGN KEY ("analysis_run_id") REFERENCES "public"."analysis_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "filter_result" ADD CONSTRAINT "fk_filter_result_source_item_id" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item" ADD CONSTRAINT "fk_source_item_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;