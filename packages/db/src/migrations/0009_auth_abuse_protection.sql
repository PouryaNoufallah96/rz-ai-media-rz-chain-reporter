-- Two tables, two different jobs. auth_throttle is the sign-in policy point: a
-- Better Auth before-hook consumes it from all three sign-in transports. It is
-- deliberately unscoped — it runs before authentication and before installation
-- identity is resolved — and `bucket` is the natural primary key so that one
-- INSERT ... ON CONFLICT (bucket) DO UPDATE ... RETURNING both counts and
-- decides a fixed window without a read-then-write race. The hook composes one
-- bucket per trusted client IP, one per normalized sign-in identifier, and one
-- deployment-wide ceiling. Identifier buckets are attacker-supplied input, so
-- ix_auth_throttle_window_started_at backs the bounded opportunistic prune that
-- gives those rows a stated retention; the raw identifier is never logged.
-- rate_limit is Better Auth's own model table, needed once rateLimit.storage is
-- "database". Its shape is dictated by installed better-auth 1.6.29, not chosen
-- here: @better-auth/core/dist/db/get-tables.mjs declares key (unique), count,
-- and lastRequest (number, bigint) — hence epoch-millisecond bigint — and the
-- adapter resolves the model by the export key `rateLimit`. The unique on `key`
-- is load-bearing rather than cosmetic: the storage wrapper in
-- better-auth/dist/api/rate-limiter/index.mjs recovers from a concurrent insert
-- by catching that violation and re-reading. The `id` column is equally
-- required — @better-auth/drizzle-adapter's incrementOne returns null with no id
-- column, which would make every guarded update look like a lost race.
-- Constraint names assemble under the vocabulary §7.1 grammar inside 63 bytes,
-- so no §7.3 truncation applies: uq_rate_limit_key (17) and
-- ix_auth_throttle_window_started_at (34). Both primary keys keep PostgreSQL's
-- default <table>_pkey, which the SQLSTATE walker never discriminates on.
-- Forward recovery: DROP TABLE "auth_throttle"; DROP TABLE "rate_limit"; no
-- other table references either, and both hold only transient counters.
CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "uq_rate_limit_key" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "auth_throttle" (
	"bucket" text PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "ix_auth_throttle_window_started_at" ON "auth_throttle" USING btree ("window_started_at");