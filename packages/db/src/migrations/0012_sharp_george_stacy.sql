-- Keep raw_usage metadata-only at the database boundary; content-bearing or
-- provider-body keys fail closed even when a caller bypasses TypeScript.
-- Forward recovery: extend this named check in a later migration when a new
-- reviewed metadata key is required; dropping it weakens the privacy boundary.
ALTER TABLE "ai_usage_event" ADD CONSTRAINT "ck_ai_usage_event_raw_usage" CHECK ("ai_usage_event"."raw_usage" is null or (jsonb_typeof("ai_usage_event"."raw_usage") = 'object' and "ai_usage_event"."raw_usage" - array['isByok', 'nativeFinishReason', 'route', 'routingAttempts'] = '{}'::jsonb));
