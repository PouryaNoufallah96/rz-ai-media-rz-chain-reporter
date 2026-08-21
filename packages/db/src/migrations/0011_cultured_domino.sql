-- Preserve the existing counter while adopting its dispatcher-owned name.
-- Forward recovery: a later migration may rename dispatch_attempt_count back
-- to attempt_count; no data rewrite or counter reset is required.
ALTER TABLE "outbox_event" RENAME COLUMN "attempt_count" TO "dispatch_attempt_count";
