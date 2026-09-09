ALTER TABLE "ai_usage_event" DROP CONSTRAINT "uq_ai_usage_event_operation_attempt_id_invocation_key";--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD COLUMN "call_index" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "uq_ai_usage_event_operation_attempt_invocation_call" UNIQUE("operation_attempt_id","invocation_key","call_index");--> statement-breakpoint
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ck_ai_usage_event_call_index" CHECK ("ai_usage_event"."call_index" >= 0);