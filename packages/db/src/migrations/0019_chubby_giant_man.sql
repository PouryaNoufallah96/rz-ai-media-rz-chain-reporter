DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM "activity_event")
		OR EXISTS (SELECT 1 FROM "approval")
		OR EXISTS (SELECT 1 FROM "publish_operation")
		OR EXISTS (SELECT 1 FROM "saved_card")
		OR EXISTS (SELECT 1 FROM "schedule") THEN
		RAISE EXCEPTION '0019 refuses to reshape non-fixture dormant publishing rows';
	END IF;
END $$;
--> statement-breakpoint
CREATE TYPE "public"."activity_event_type" AS ENUM('saved_card.saved', 'saved_card.discarded', 'saved_card.restored', 'approval.granted', 'schedule.created', 'schedule.cancelled', 'schedule.rescheduled', 'schedule.missed', 'publication.requested', 'publication.confirmed', 'publication.failed', 'publication.delivery_unknown', 'publication.reconciled_delivered', 'publication.reconciled_not_delivered', 'publication.telegram_attested_delivered', 'publication.telegram_attested_not_delivered', 'publishing.paused', 'publishing.resumed');--> statement-breakpoint
CREATE TYPE "public"."checkpoint_evidence_authority" AS ENUM('provider', 'operator');--> statement-breakpoint
CREATE TYPE "public"."publication_lifecycle" AS ENUM('available', 'reserved', 'effect_claimed', 'delivery_unknown', 'confirmed');--> statement-breakpoint
CREATE TYPE "public"."publish_checkpoint_kind" AS ENUM('telegram_message', 'x_media', 'x_post', 'instagram_grant', 'instagram_container', 'instagram_media');--> statement-breakpoint
CREATE TYPE "public"."publish_command_kind" AS ENUM('direct', 'scheduled', 'missed_recovery', 'retry', 'reconciliation', 'telegram_attestation');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_authority" AS ENUM('provider', 'operator');--> statement-breakpoint
CREATE TYPE "public"."reconciliation_decision" AS ENUM('delivered', 'not_delivered');--> statement-breakpoint
CREATE TYPE "public"."schedule_lifecycle" AS ENUM('scheduled', 'cancelled', 'rescheduled', 'effect_claimed', 'completed', 'failed', 'delivery_unknown', 'missed_requires_confirmation');--> statement-breakpoint
CREATE TYPE "public"."settlement_activity_status" AS ENUM('not_due', 'pending', 'failed', 'recorded');--> statement-breakpoint
CREATE TABLE "publication" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"approval_id" uuid NOT NULL,
	"draft_revision_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"selected_final_media_asset_id" uuid,
	"lifecycle" "publication_lifecycle" DEFAULT 'available' NOT NULL,
	"reserved_schedule_id" uuid,
	"active_operation_id" uuid,
	"unresolved_attempt_id" uuid,
	"confirmed_checkpoint_id" uuid,
	"confirmed_provider_result_id" text,
	"confirmed_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_publication_workspace_revision_platform" UNIQUE("workspace_id","draft_revision_id","platform"),
	CONSTRAINT "ck_publication_version_positive" CHECK ("publication"."version" > 0),
	CONSTRAINT "ck_publication_platform_media" CHECK ("publication"."platform" <> 'instagram' or "publication"."selected_final_media_asset_id" is not null),
	CONSTRAINT "ck_publication_unknown_attempt" CHECK (("publication"."lifecycle" = 'delivery_unknown') = ("publication"."unresolved_attempt_id" is not null)),
	CONSTRAINT "ck_publication_confirmed_result" CHECK (("publication"."lifecycle" = 'confirmed') = ("publication"."confirmed_at" is not null and "publication"."confirmed_provider_result_id" is not null)),
	CONSTRAINT "ck_publication_active_owner" CHECK ("publication"."lifecycle" not in ('effect_claimed', 'delivery_unknown') or "publication"."active_operation_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "publication_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"ambiguous_attempt_id" uuid NOT NULL,
	"actor_id" text,
	"authority" "reconciliation_authority" NOT NULL,
	"decision" "reconciliation_decision" NOT NULL,
	"evidence_checkpoint_id" uuid,
	"idempotency_key" text NOT NULL,
	"request_hash" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_publication_reconciliation_identity" UNIQUE("workspace_id","actor_id","idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "publish_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"operation_attempt_id" uuid NOT NULL,
	"platform" "platform" NOT NULL,
	"kind" "publish_checkpoint_kind" NOT NULL,
	"provider_reference_id" text NOT NULL,
	"evidence_authority" "checkpoint_evidence_authority" DEFAULT 'provider' NOT NULL,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_publish_checkpoint_workspace_attempt_kind" UNIQUE("workspace_id","operation_attempt_id","kind"),
	CONSTRAINT "ck_publish_checkpoint_kind_platform" CHECK (("publish_checkpoint"."platform" = 'telegram' and "publish_checkpoint"."kind" = 'telegram_message') or ("publish_checkpoint"."platform" = 'x' and "publish_checkpoint"."kind" in ('x_media', 'x_post')) or ("publish_checkpoint"."platform" = 'instagram' and "publish_checkpoint"."kind" in ('instagram_grant', 'instagram_container', 'instagram_media')))
);
--> statement-breakpoint
CREATE TABLE "publishing_control" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_by" text,
	"paused_at" timestamp with time zone,
	"reason_code" text,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_publishing_control_version_positive" CHECK ("publishing_control"."version" > 0),
	CONSTRAINT "ck_publishing_control_pause_fields" CHECK ("publishing_control"."paused" = ("publishing_control"."paused_by" is not null and "publishing_control"."paused_at" is not null) and ("publishing_control"."paused" or "publishing_control"."reason_code" is null))
);
--> statement-breakpoint
CREATE TABLE "publishing_media_grant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"publication_id" uuid NOT NULL,
	"operation_id" uuid NOT NULL,
	"media_asset_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"container_accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_publishing_media_grant_token_hash" UNIQUE("token_hash"),
	CONSTRAINT "uq_publishing_media_grant_operation_asset" UNIQUE("workspace_id","operation_id","media_asset_id"),
	CONSTRAINT "ck_publishing_media_grant_version_positive" CHECK ("publishing_media_grant"."version" > 0),
	CONSTRAINT "ck_publishing_media_grant_terminal_exclusive" CHECK (num_nonnulls("publishing_media_grant"."container_accepted_at", "publishing_media_grant"."revoked_at") <= 1)
);
--> statement-breakpoint
ALTER TABLE "activity_event" RENAME COLUMN "actor" TO "actor_id";--> statement-breakpoint
ALTER TABLE "activity_event" DROP CONSTRAINT "fk_activity_event_actor";
--> statement-breakpoint
ALTER TABLE "approval" DROP CONSTRAINT "fk_approval_decided_by";
--> statement-breakpoint
ALTER TABLE "saved_card" DROP CONSTRAINT "fk_saved_card_content_card_id";
--> statement-breakpoint
ALTER TABLE "activity_event" ALTER COLUMN "event_type" SET DATA TYPE "public"."activity_event_type" USING "event_type"::"public"."activity_event_type";--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "request_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "saved_card_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "approval_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "activity_event" ADD COLUMN "publication_id" uuid;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "platform" "platform" NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "selected_final_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "approved_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "approved_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "idempotency_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "approval" ADD COLUMN "request_hash" text NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "publication_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "destination_account_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "selected_final_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "command_kind" "publish_command_kind" DEFAULT 'direct' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "settlement_activity_status" "settlement_activity_status" DEFAULT 'not_due' NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "settlement_activity_failure_code" text;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "settlement_activity_recorded_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "saved_card" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "approval_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "publication_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "selected_final_media_asset_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "destination_account_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "originating_operation_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "predecessor_schedule_id" uuid;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "lifecycle" "schedule_lifecycle" DEFAULT 'scheduled' NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "claimed_by" text;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "created_by" text NOT NULL;--> statement-breakpoint
ALTER TABLE "schedule" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "fk_publication_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "fk_publication_approval_id" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "fk_publication_draft_revision_id" FOREIGN KEY ("draft_revision_id") REFERENCES "public"."draft_revision"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "fk_publication_selected_final_media_asset_id" FOREIGN KEY ("selected_final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "fk_publication_active_operation_id" FOREIGN KEY ("active_operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication" ADD CONSTRAINT "fk_publication_unresolved_attempt_id" FOREIGN KEY ("unresolved_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliation" ADD CONSTRAINT "fk_publication_reconciliation_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliation" ADD CONSTRAINT "fk_publication_reconciliation_publication_id" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliation" ADD CONSTRAINT "fk_publication_reconciliation_attempt_id" FOREIGN KEY ("ambiguous_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliation" ADD CONSTRAINT "fk_publication_reconciliation_actor_id" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publication_reconciliation" ADD CONSTRAINT "fk_publication_reconciliation_checkpoint_id" FOREIGN KEY ("evidence_checkpoint_id") REFERENCES "public"."publish_checkpoint"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_checkpoint" ADD CONSTRAINT "fk_publish_checkpoint_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_checkpoint" ADD CONSTRAINT "fk_publish_checkpoint_publication_id" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_checkpoint" ADD CONSTRAINT "fk_publish_checkpoint_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_checkpoint" ADD CONSTRAINT "fk_publish_checkpoint_operation_attempt_id" FOREIGN KEY ("operation_attempt_id") REFERENCES "public"."operation_attempt"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_control" ADD CONSTRAINT "fk_publishing_control_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_control" ADD CONSTRAINT "fk_publishing_control_paused_by" FOREIGN KEY ("paused_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_media_grant" ADD CONSTRAINT "fk_publishing_media_grant_workspace_id" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspace"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_media_grant" ADD CONSTRAINT "fk_publishing_media_grant_publication_id" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_media_grant" ADD CONSTRAINT "fk_publishing_media_grant_operation_id" FOREIGN KEY ("operation_id") REFERENCES "public"."operation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publishing_media_grant" ADD CONSTRAINT "fk_publishing_media_grant_media_asset_id" FOREIGN KEY ("media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_actor_id" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_saved_card_id" FOREIGN KEY ("saved_card_id") REFERENCES "public"."saved_card"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_approval_id" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_schedule_id" FOREIGN KEY ("schedule_id") REFERENCES "public"."schedule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "fk_activity_event_publication_id" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "fk_approval_selected_final_media_asset_id" FOREIGN KEY ("selected_final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "fk_approval_approved_by" FOREIGN KEY ("approved_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_publication_id" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_destination_account_id" FOREIGN KEY ("destination_account_id") REFERENCES "public"."destination_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "fk_publish_operation_selected_final_media_asset_id" FOREIGN KEY ("selected_final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_approval_id" FOREIGN KEY ("approval_id") REFERENCES "public"."approval"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_publication_id" FOREIGN KEY ("publication_id") REFERENCES "public"."publication"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_selected_final_media_asset_id" FOREIGN KEY ("selected_final_media_asset_id") REFERENCES "public"."media_asset"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_destination_account_id" FOREIGN KEY ("destination_account_id") REFERENCES "public"."destination_account"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_originating_operation_id" FOREIGN KEY ("originating_operation_id") REFERENCES "public"."operation"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_predecessor_schedule_id" FOREIGN KEY ("predecessor_schedule_id") REFERENCES "public"."schedule"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "fk_schedule_created_by" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_event" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "activity_event" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "approval" DROP COLUMN "decided_by";--> statement-breakpoint
ALTER TABLE "approval" DROP COLUMN "decided_at";--> statement-breakpoint
ALTER TABLE "approval" DROP COLUMN "created_at";--> statement-breakpoint
ALTER TABLE "approval" DROP COLUMN "updated_at";--> statement-breakpoint
ALTER TABLE "publish_operation" DROP COLUMN "external_result_id";--> statement-breakpoint
ALTER TABLE "saved_card" DROP COLUMN "content_card_id";--> statement-breakpoint
ALTER TABLE "schedule" DROP COLUMN "status";--> statement-breakpoint
ALTER TABLE "activity_event" ADD CONSTRAINT "uq_activity_event_workspace_type_idempotency" UNIQUE("workspace_id","event_type","idempotency_key");--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "uq_approval_workspace_actor_idempotency" UNIQUE("workspace_id","approved_by","idempotency_key");--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "uq_approval_workspace_snapshot" UNIQUE NULLS NOT DISTINCT("workspace_id","draft_revision_id","platform","selected_final_media_asset_id");--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "uq_schedule_workspace_predecessor" UNIQUE("workspace_id","predecessor_schedule_id");--> statement-breakpoint
ALTER TABLE "approval" ADD CONSTRAINT "ck_approval_platform_media" CHECK ("approval"."platform" <> 'instagram' or "approval"."selected_final_media_asset_id" is not null);--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "ck_publish_operation_platform_media" CHECK ("publish_operation"."platform" <> 'instagram' or "publish_operation"."selected_final_media_asset_id" is not null);--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "ck_publish_operation_required_identity" CHECK ("publish_operation"."publication_id" is not null and "publish_operation"."destination_account_id" is not null);--> statement-breakpoint
ALTER TABLE "publish_operation" ADD CONSTRAINT "ck_publish_operation_activity_status" CHECK (("publish_operation"."settlement_activity_status" = 'recorded') = ("publish_operation"."settlement_activity_recorded_at" is not null) and ("publish_operation"."settlement_activity_status" = 'failed') = ("publish_operation"."settlement_activity_failure_code" is not null));--> statement-breakpoint
ALTER TABLE "saved_card" ADD CONSTRAINT "ck_saved_card_version_positive" CHECK ("saved_card"."version" > 0);--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "ck_schedule_version_positive" CHECK ("schedule"."version" > 0);--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "ck_schedule_claim_complete" CHECK (num_nonnulls("schedule"."claimed_by", "schedule"."claimed_at", "schedule"."lease_expires_at") in (0, 3));--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "ck_schedule_claim_lifecycle" CHECK ("schedule"."claimed_by" is null or "schedule"."lifecycle" = 'effect_claimed');--> statement-breakpoint
ALTER TABLE "schedule" ADD CONSTRAINT "ck_schedule_platform_media" CHECK ("schedule"."platform" <> 'instagram' or "schedule"."selected_final_media_asset_id" is not null);--> statement-breakpoint
DROP TYPE "public"."schedule_status";
