-- Durable-work persistence substrate. The usage ledger is append-only by
-- invocation identity; operation_attempt.outcome becomes nullable so an
-- allocated attempt exists before provider I/O and receives its outcome later.
-- The two partial-index predicate tokens are registered in
-- OPERATION-VOCABULARY §7.2. No assembled name exceeds 63 bytes.
-- Forward recovery: ship a later additive repair migration. A deliberate
-- reversal must first prove ai_usage_event and the new columns contain no
-- required history, then drop indexes/FKs/table/columns/types in reverse order;
-- outcome may regain NOT NULL only after every in-flight NULL is resolved.
CREATE TYPE "public"."model_backend" AS ENUM('remote', 'local');--> statement-breakpoint
CREATE TYPE "public"."usage_api_kind" AS ENUM('chat', 'embedding', 'image');--> statement-breakpoint
CREATE TYPE "public"."usage_cost_authority" AS ENUM('billed_openrouter', 'estimated_openrouter', 'local', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."usage_provider_gateway" AS ENUM('openrouter', 'ollama');--> statement-breakpoint
CREATE TYPE "public"."usage_source" AS ENUM('inline', 'generation_reconciled');--> statement-breakpoint
CREATE TYPE "public"."usage_status" AS ENUM('pending', 'succeeded', 'failed', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TABLE "ai_usage_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"operation_attempt_id" uuid NOT NULL,
	"invocation_key" text NOT NULL,
	"task_key" text NOT NULL,
	"api_kind" "usage_api_kind" NOT NULL,
	"backend" "model_backend" NOT NULL,
	"provider_gateway" "usage_provider_gateway" NOT NULL,
	"requested_model" text NOT NULL,
	"resolved_model" text,
	"upstream_provider" text,
	"generation_id" text,
	"provider_request_id" text,
	"status" "usage_status" DEFAULT 'pending' NOT NULL,
	"finish_reason" text,
	"prompt_tokens" bigint,
	"completion_tokens" bigint,
	"reasoning_tokens" bigint,
	"cache_read_tokens" bigint,
	"cache_write_tokens" bigint,
	"total_tokens" bigint,
	"openrouter_cost" numeric(20, 10),
	"upstream_inference_cost" numeric(20, 10),
	"currency" text DEFAULT 'USD' NOT NULL,
	"cost_authority" "usage_cost_authority" DEFAULT 'unknown' NOT NULL,
	"usage_source" "usage_source" DEFAULT 'inline' NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reconciled_at" timestamp with time zone,
	"raw_usage" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_ai_usage_event_operation_attempt_id_invocation_key" UNIQUE("operation_attempt_id","invocation_key"),
	CONSTRAINT "ck_ai_usage_event_invocation_key" CHECK ("ai_usage_event"."invocation_key" in ('primary', 'retry-1', 'fallback'))
);
--> statement-breakpoint
ALTER TABLE "operation_attempt" ALTER COLUMN "outcome" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "object_removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "delete_failed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "media_asset" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "operation" ADD COLUMN "attempt_seq" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "dispatch_claimed_by" text;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "dispatch_claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "dispatch_lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "last_error_code" text;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "last_error_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD COLUMN "exhausted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "fk_ai_usage_event_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "fk_ai_usage_event_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "fk_ai_usage_event_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_ai_usage_event_provider_gateway_generation_id_present" ON "ai_usage_event" USING btree ("provider_gateway","generation_id") WHERE "ai_usage_event"."generation_id" is not null;--> statement-breakpoint
CREATE INDEX "ix_ai_usage_event_workspace_id_occurred_at_id" ON "ai_usage_event" USING btree ("workspace_id","occurred_at" DESC NULLS LAST,"id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ix_outbox_event_next_attempt_at_undispatched" ON "outbox_event" USING btree ("next_attempt_at") WHERE "outbox_event"."dispatched_at" is null and "outbox_event"."exhausted_at" is null;
