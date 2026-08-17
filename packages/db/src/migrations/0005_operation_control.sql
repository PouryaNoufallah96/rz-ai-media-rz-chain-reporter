-- Operation control. uq_operation_workspace_id_actor_command_type_idempotency_key
-- is the SQLSTATE walker's discriminator, so renaming it silently unmaps 23505;
-- request_hash is stored outside it so the use case can tell an idempotent
-- replay from a same-key changed payload after the 23505 fires.
-- Attempts and the publish/projection detail rows are owned by their operation
-- and cascade; outbox events and usage reservations restrict, so an operation
-- cannot be deleted while an undispatched effect or a live hold exists.
-- usage_reservation is a bare hold: unit is opaque and no bucket, plan, tariff,
-- meter, or entitlement exists in this phase.
-- This migration closes the seam 0003 recorded: analysis_run.operation_id is
-- added here with fk_analysis_run_operation_id, nullable because no producer
-- exists yet. No constraint name assembled above 63 bytes, so the vocabulary
-- §7.3 truncation rule was not needed; the longest is
-- uq_operation_attempt_workspace_id_operation_id_attempt_number at 61 bytes.
-- Forward recovery: nothing outside this migration references these nine
-- tables, so a later migration can drop them in reverse dependency order, drop
-- the four types, and drop analysis_run.operation_id with its constraint.
CREATE TYPE "public"."attempt_outcome" AS ENUM('succeeded', 'failed_retryable', 'failed_terminal', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."operation_lifecycle" AS ENUM('queued', 'running', 'settling', 'succeeded', 'failed', 'cancelled', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."schedule_status" AS ENUM('scheduled', 'cancelled', 'completed');--> statement-breakpoint
CREATE TYPE "public"."usage_reservation_state" AS ENUM('active', 'settled', 'released', 'expired');--> statement-breakpoint
CREATE TABLE "activity_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"event_type" text NOT NULL,
	"platform_draft_id" uuid,
	"operation_id" uuid,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_conversation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assistant_message" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"command_type" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"lifecycle" "operation_lifecycle" DEFAULT 'queued' NOT NULL,
	"effective_at" timestamp with time zone DEFAULT now() NOT NULL,
	"request_id" text,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"lease_expires_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_operation_workspace_id_actor_command_type_idempotency_key" UNIQUE("workspace_id","actor","command_type","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "operation_attempt" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"outcome" "attempt_outcome" NOT NULL,
	"failure_code" text,
	"provider_result_id" text,
	"latency_ms" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_operation_attempt_workspace_id_operation_id_attempt_number" UNIQUE("workspace_id","operation_id","attempt_number")
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"schema_version" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"dispatched_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projection_operation" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target" text NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"external_result_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "publish_operation" (
	"operation_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"schedule_id" uuid,
	"external_result_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"timezone" text NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"status" "schedule_status" DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_reservation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"unit" text NOT NULL,
	"amount" integer NOT NULL,
	"state" "usage_reservation_state" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_usage_reservation_amount" CHECK ("usage_reservation"."amount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analysis_run" ADD COLUMN "operation_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_actor" FOREIGN KEY ("actor") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_platform_draft_id" FOREIGN KEY ("platform_draft_id") REFERENCES "public"."platform_draft"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "fk_assistant_conversation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_conversation" ADD CONSTRAINT "fk_assistant_conversation_user_id" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "fk_assistant_message_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assistant_message" ADD CONSTRAINT "fk_assistant_message_conversation_id" FOREIGN KEY ("conversation_id") REFERENCES "public"."assistant_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation" ADD CONSTRAINT "fk_operation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation" ADD CONSTRAINT "fk_operation_actor" FOREIGN KEY ("actor") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_attempt" ADD CONSTRAINT "fk_operation_attempt_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operation_attempt" ADD CONSTRAINT "fk_operation_attempt_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "fk_outbox_event_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "fk_outbox_event_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_operation" ADD CONSTRAINT "fk_projection_operation_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_operation" ADD CONSTRAINT "fk_projection_operation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projection_operation" ADD CONSTRAINT "fk_projection_operation_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_schedule_id" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_reservation" ADD CONSTRAINT "fk_usage_reservation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_reservation" ADD CONSTRAINT "fk_usage_reservation_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_run" ADD CONSTRAINT "fk_analysis_run_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;