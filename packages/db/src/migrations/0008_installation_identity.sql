-- Phase 3 turns "which customer is this deployment for" into persisted state.
-- workspace.name_key is the first fold_unique_name_v1 consumer: the fold runs in
-- the database, so no SQL path can bypass it, and STORED is explicit because
-- PostgreSQL 18 defaults a generated column to VIRTUAL, which cannot be indexed.
-- The three customer_template_* columns are the reconciler's applied-state
-- provenance and stay nullable: a workspace row exists before the first
-- reconcile writes them, and readiness compares the loaded fingerprint against
-- customer_template_fingerprint. uq_workspace_customer_template_key is the
-- single-installation guard behind the reconciler's advisory lock — two
-- concurrent runs cannot both provision the same key. NULLs are distinct there
-- by design: an un-provisioned workspace row is a legitimate pre-reconcile state.
-- deleted_at makes retirement of template-owned reference data non-destructive.
-- The existing stable-key uniques are deliberately left FULL rather than made
-- partial, so uq_media_brand_workspace_id_key, uq_source_workspace_id_key,
-- uq_destination_account_workspace_id_key and the mapping unique hold across
-- active and retired rows: reintroducing a template key restores the original
-- row with its UUID and history instead of inserting a sibling. Partial
-- uniqueness is reserved for human-facing name reuse, never for stable domain
-- identity.
-- destination_account.enabled is template-owned and mirrors source.enabled, so
-- "declared but intentionally inactive" stays distinct from "omitted from the
-- template", which is retirement. binding_present and binding_checked_at are the
-- runtime-owned sanitized projection the deployment command and worker prestart
-- write; null means no check has been recorded yet, and neither column holds a
-- secret value or the name of the variable carrying one.
-- Both new constraint names assemble under the vocabulary §7.1 grammar well
-- inside 63 bytes, so no §7.3 truncation applies: uq_workspace_name_key (21) and
-- uq_workspace_customer_template_key (34).
-- Forward recovery: drop the two workspace constraints and every column added
-- here. All of them are nullable or defaulted, so the drop loses only retirement
-- marks and applied-state provenance, and the next reconcile rewrites the latter.
ALTER TABLE "destination_account" ADD COLUMN "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "destination_account" ADD COLUMN "binding_present" boolean;--> statement-breakpoint
ALTER TABLE "destination_account" ADD COLUMN "binding_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "destination_account" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_brand" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media_brand_destination_account" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "source" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "name_key" text GENERATED ALWAYS AS (fold_unique_name_v1("name")) STORED NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "customer_template_key" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "customer_template_fingerprint" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "customer_template_applied_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "uq_workspace_name_key" UNIQUE("name_key");--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "uq_workspace_customer_template_key" UNIQUE("customer_template_key");