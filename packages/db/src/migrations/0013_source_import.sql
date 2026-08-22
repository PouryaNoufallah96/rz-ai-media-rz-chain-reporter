-- Phase 5 Source Import: the first real pipeline writes per-source outcomes,
-- immutable content revisions, per-item admission/ordering, and successful
-- enrichment rows. source_item finally gains the source_id 0007 deferred, and
-- its uniqueness moves from (workspace_id, origin, external_id) to
-- (workspace_id, source_id, external_id) so two feeds carrying the same guid
-- stay distinct items.
-- source_item content columns become the frozen first-seen snapshot: every
-- content read resolves through the highest-numbered source_item_revision, and
-- an unchanged content hash writes nothing.
-- No aggregate counts are stored. sourceImportProgress derives stage counts and
-- the partial predicate from the cascade-owned child rows on every read.
-- §7.3 truncation applies to four names; both forms are recorded here so the
-- SQLSTATE walker's discriminators stay recoverable
-- (printf '%s' "<assembled>" | shasum -a 256 | cut -c1-8):
--   uq_source_item_revision_workspace_id_source_item_id_revision_number (67)
--     -> uq_source_item_revision_workspace_id_source_item_id_re_fc2f2a55 (63)
--   uq_source_item_revision_workspace_id_source_item_id_content_hash (64)
--     -> uq_source_item_revision_workspace_id_source_item_id_co_643af24a (63)
--   uq_source_import_item_workspace_id_source_import_id_source_item_id (66)
--     -> uq_source_import_item_workspace_id_source_import_id_so_ef8b0562 (63)
--   uq_source_item_enrichment_workspace_id_source_item_revision_id_policy_version_page_content_hash (95)
--     -> uq_source_item_enrichment_workspace_id_source_item_rev_d3884b4d (63)
-- uq_source_import_source_workspace_id_source_import_id_source_id is exactly
-- 63 bytes and is stored unchanged. uq_source_import_workspace_id_unsettled
-- carries the §7.2 `unsettled` predicate token (WHERE stage <> 'settled') and
-- is the mechanism behind SOURCE_IMPORT_IN_PROGRESS (409).
-- Backfill: source.content_locale is 'en' for every pre-Phase-5 row because
-- acquisition supports no other locale; the template reconciler owns the value
-- from here on. source_item.source_id is added nullable, backfilled to the
-- workspace's first non-retired source of the same origin by key order, then
-- set NOT NULL in this same migration. The only pre-Phase-5 rows are the dev
-- seed's synthetic item (production count asserted 0), and a platform_draft
-- references it under a restrict FK, so no row is deleted.
-- Forward recovery: if the backfill leaves any source_item.source_id null the
-- SET NOT NULL fails and the whole migration rolls back; resolve by adding the
-- missing source rows through template:reconcile and re-running. Rollback runs
-- with the previous template together (v1 templates do not load under v2 code):
--   ALTER TABLE source_item DROP CONSTRAINT uq_source_item_workspace_id_source_id_external_id;
--   ALTER TABLE source_item ADD CONSTRAINT uq_source_item_workspace_id_origin_external_id UNIQUE (workspace_id, origin, external_id);
-- which is safe while every item has one source per origin. The new tables are
-- inert under Phase 4 code and may be dropped in reverse FK order.
CREATE TYPE "public"."admission_outcome" AS ENUM('admitted', 'skipped_language', 'skipped_undated', 'out_of_window', 'over_cap');--> statement-breakpoint
CREATE TYPE "public"."article_adapter" AS ENUM('feed', 'direct', 'firecrawl');--> statement-breakpoint
CREATE TYPE "public"."article_fetch_mode" AS ENUM('direct', 'direct_then_firecrawl', 'firecrawl');--> statement-breakpoint
CREATE TYPE "public"."enrichment_outcome" AS ENUM('pending', 'succeeded', 'skipped', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."enrichment_reason" AS ENUM('off_origin', 'deadline', 'js_required', 'anti_bot_challenge', 'extraction_insufficient', 'unsupported_mime', 'too_large', 'ssrf_blocked', 'redirect_blocked', 'fetch_failed', 'brief_invalid');--> statement-breakpoint
CREATE TYPE "public"."source_fetch_outcome" AS ENUM('pending', 'succeeded', 'not_modified', 'partial', 'skipped', 'rejected', 'blocked', 'timed_out', 'failed_retryable', 'failed_terminal');--> statement-breakpoint
CREATE TYPE "public"."source_fetch_reason" AS ENUM('empty_feed', 'disabled_at_run_time', 'parse_failure', 'markup_drift', 'missing_external_identity', 'no_web_preview', 'ssrf_blocked', 'redirect_blocked', 'unsupported_mime', 'too_large', 'deadline', 'retry_after');--> statement-breakpoint
CREATE TYPE "public"."source_import_stage" AS ENUM('acquiring', 'enriching', 'settled');--> statement-breakpoint
CREATE TYPE "public"."telegram_ordering_mode" AS ENUM('views', 'latest', 'views_per_source', 'latest_per_source', 'keywords');--> statement-breakpoint
CREATE TABLE "source_import" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"stage" "source_import_stage" NOT NULL,
	"failure_code" text,
	"window_hours" integer NOT NULL,
	"ordering_mode" "telegram_ordering_mode" NOT NULL,
	"top_n" integer NOT NULL,
	"topics" text[] NOT NULL,
	"enrichment_enabled" boolean NOT NULL,
	"template_fingerprint" text NOT NULL,
	"embedding_attempt_id" uuid,
	"embedding_dimension" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_import_operation_id" UNIQUE("operation_id")
);
--> statement-breakpoint
CREATE TABLE "source_import_item" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_import_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"source_item_revision_id" uuid NOT NULL,
	"admission" "admission_outcome" NOT NULL,
	"rank" integer,
	"keyword_score" double precision,
	"views" bigint,
	"enrichment_outcome" "enrichment_outcome",
	"enrichment_reason" "enrichment_reason",
	"enrichment_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_import_item_workspace_id_source_import_id_so_ef8b0562" UNIQUE("workspace_id","source_import_id","source_item_id")
);
--> statement-breakpoint
CREATE TABLE "source_import_source" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_import_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"outcome" "source_fetch_outcome" NOT NULL,
	"reason" "source_fetch_reason",
	"etag" text,
	"last_modified" text,
	"fetched_count" integer DEFAULT 0 NOT NULL,
	"admitted_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_import_source_workspace_id_source_import_id_source_id" UNIQUE("workspace_id","source_import_id","source_id")
);
--> statement-breakpoint
CREATE TABLE "source_item_enrichment" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_item_revision_id" uuid NOT NULL,
	"operation_attempt_id" uuid NOT NULL,
	"policy_version" text NOT NULL,
	"adapter" "article_adapter" NOT NULL,
	"fallback_reason" "enrichment_reason",
	"page_content_hash" text NOT NULL,
	"extract" text NOT NULL,
	"brief" jsonb NOT NULL,
	"provider_request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_item_enrichment_workspace_id_source_item_rev_d3884b4d" UNIQUE("workspace_id","source_item_revision_id","policy_version","page_content_hash")
);
--> statement-breakpoint
CREATE TABLE "source_item_revision" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_item_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"canonical_url" text NOT NULL,
	"content_locale" "content_locale" NOT NULL,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_item_revision_workspace_id_source_item_id_re_fc2f2a55" UNIQUE("workspace_id","source_item_id","revision_number"),
	CONSTRAINT "uq_source_item_revision_workspace_id_source_item_id_co_643af24a" UNIQUE("workspace_id","source_item_id","content_hash")
);
--> statement-breakpoint
ALTER TABLE "source_item" DROP CONSTRAINT "uq_source_item_workspace_id_origin_external_id";--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "content_locale" "content_locale";--> statement-breakpoint
UPDATE "source" SET "content_locale" = 'en' WHERE "content_locale" IS NULL;--> statement-breakpoint
ALTER TABLE "source" ALTER COLUMN "content_locale" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "article_fetch_mode" "article_fetch_mode";--> statement-breakpoint
ALTER TABLE "source_item" ADD COLUMN "source_id" uuid;--> statement-breakpoint
UPDATE "source_item" SET "source_id" = (
	SELECT "source"."id" FROM "source"
	WHERE "source"."workspace_id" = "source_item"."workspace_id"
		AND "source"."origin" = "source_item"."origin"
		AND "source"."deleted_at" IS NULL
	ORDER BY "source"."key"
	LIMIT 1
) WHERE "source_id" IS NULL;--> statement-breakpoint
ALTER TABLE "source_item" ALTER COLUMN "source_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "fk_source_import_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "fk_source_import_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import" ADD CONSTRAINT "fk_source_import_embedding_attempt_id" FOREIGN KEY ("embedding_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_item" ADD CONSTRAINT "fk_source_import_item_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_item" ADD CONSTRAINT "fk_source_import_item_source_import_id" FOREIGN KEY ("source_import_id") REFERENCES "public"."source_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_item" ADD CONSTRAINT "fk_source_import_item_source_item_id" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_item" ADD CONSTRAINT "fk_source_import_item_source_item_revision_id" FOREIGN KEY ("source_item_revision_id") REFERENCES "public"."source_item_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_item" ADD CONSTRAINT "fk_source_import_item_enrichment_id" FOREIGN KEY ("enrichment_id") REFERENCES "public"."source_item_enrichment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_source" ADD CONSTRAINT "fk_source_import_source_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_source" ADD CONSTRAINT "fk_source_import_source_source_import_id" FOREIGN KEY ("source_import_id") REFERENCES "public"."source_import"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_import_source" ADD CONSTRAINT "fk_source_import_source_source_id" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_enrichment" ADD CONSTRAINT "fk_source_item_enrichment_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_enrichment" ADD CONSTRAINT "fk_source_item_enrichment_source_item_revision_id" FOREIGN KEY ("source_item_revision_id") REFERENCES "public"."source_item_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_enrichment" ADD CONSTRAINT "fk_source_item_enrichment_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_revision" ADD CONSTRAINT "fk_source_item_revision_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_item_revision" ADD CONSTRAINT "fk_source_item_revision_source_item_id" FOREIGN KEY ("source_item_id") REFERENCES "public"."source_item"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_source_import_workspace_id_unsettled" ON "source_import" USING btree ("workspace_id") WHERE "source_import"."stage" <> 'settled';--> statement-breakpoint
CREATE INDEX "ix_source_import_item_source_item_id" ON "source_import_item" USING btree ("source_item_id");--> statement-breakpoint
CREATE INDEX "ix_source_import_source_workspace_id_source_id_started_at" ON "source_import_source" USING btree ("workspace_id","source_id","started_at");--> statement-breakpoint
ALTER TABLE "source_item" ADD CONSTRAINT "fk_source_item_source_id" FOREIGN KEY ("source_id") REFERENCES "public"."source"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ix_source_item_workspace_id_created_at_id" ON "source_item" USING btree ("workspace_id","created_at","id");--> statement-breakpoint
ALTER TABLE "source_item" ADD CONSTRAINT "uq_source_item_workspace_id_source_id_external_id" UNIQUE("workspace_id","source_id","external_id");