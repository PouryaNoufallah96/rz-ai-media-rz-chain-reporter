ALTER TABLE "publish_operation" DROP CONSTRAINT "ck_publish_operation_required_identity";--> statement-breakpoint
ALTER TABLE "publish_operation" ALTER COLUMN "publication_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "publish_operation" ALTER COLUMN "destination_account_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "operation_attempt" ADD COLUMN "provider_failure_code" text;--> statement-breakpoint
ALTER TABLE "operation_attempt" ADD COLUMN "final_effect_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "publish_operation" ADD COLUMN "cache_notification_completed_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "ix_operation_workspace_lifecycle_lease" ON "operation" USING btree ("workspace_id","lifecycle","lease_expires_at");--> statement-breakpoint
CREATE INDEX "ix_publication_workspace_updated_id" ON "publication" USING btree ("workspace_id","updated_at","id");--> statement-breakpoint
CREATE INDEX "ix_publication_reconciliation_workspace_publication_occurred_id" ON "publication_reconciliation" USING btree ("workspace_id","publication_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "ix_publish_checkpoint_workspace_publication_observed" ON "publish_checkpoint" USING btree ("workspace_id","publication_id","observed_at");--> statement-breakpoint
CREATE INDEX "ix_publish_operation_workspace_publication_updated_operation" ON "publish_operation" USING btree ("workspace_id","publication_id","updated_at","operation_id");--> statement-breakpoint
CREATE INDEX "ix_publish_operation_workspace_follow_up" ON "publish_operation" USING btree ("workspace_id","updated_at","operation_id");--> statement-breakpoint
CREATE INDEX "ix_saved_card_workspace_saved_by_created_id" ON "saved_card" USING btree ("workspace_id","saved_by","created_at","id");--> statement-breakpoint
CREATE INDEX "ix_schedule_workspace_scheduled_id" ON "schedule" USING btree ("workspace_id","scheduled_at","id");