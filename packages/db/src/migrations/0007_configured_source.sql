-- The configured source a customer draws material from had no home: source_item
-- is fetched-item provenance, so nothing recorded which feed or channel an
-- installation reads and swapping the set per customer had nowhere to happen.
-- `source` is customer-template reference data seeded at provisioning, not
-- operator CRUD, and it mirrors destination_account exactly: a stable template
-- `key` unique per workspace is the domain identity, `endpoint` holds the feed
-- URL for `rss` and the public channel handle for `telegram_public`, and the
-- workspace edge restricts so removing an installation cannot silently drop its
-- configuration. source_origin stays an enum because each origin needs its own
-- SourceFetcher adapter, so the set grows only when code ships — the same class
-- as platform, not the class media_brand was corrected out of in 0006.
-- No secret value and no environment-variable name is stored; `metadata` is
-- non-secret fetch detail only.
-- Keywords, scoring weights, thresholds, caps and source authority are
-- deliberately NOT columns here. They are customer-template configuration that
-- Phase 6 filtering consumes, and one implementation reads them as configuration
-- rather than a per-row copy — putting them on this row would recreate the
-- legacy constant drift 0006's note describes.
-- source_item.source_id is deliberately deferred, not overlooked. Linking a
-- fetched item back to its configured source is purely additive and has no
-- consumer until Phase 5 ships SourceFetcher; adding it now would mean a NOT
-- NULL column no writer can populate or a nullable one nothing reads. Phase 5
-- adds it with its first writer.
-- Both constraint names assemble under the vocabulary §7.1 grammar well inside
-- 63 bytes, so no §7.3 truncation applies: fk_source_workspace_id (22) and
-- uq_source_workspace_id_key (26).
-- Forward recovery: DROP TABLE "source"; no other table references it.
CREATE TABLE "source" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"origin" "source_origin" NOT NULL,
	"endpoint" text NOT NULL,
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_source_workspace_id_key" UNIQUE("workspace_id","key")
);
--> statement-breakpoint
ALTER TABLE "source" ADD CONSTRAINT "fk_source_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;