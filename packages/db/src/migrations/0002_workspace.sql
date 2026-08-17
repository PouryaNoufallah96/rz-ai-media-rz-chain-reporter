-- workspace.id is the permanent tenant key every later tenant table restricts
-- against. The only constraint is the workspace_pkey default; name carries no
-- uniqueness and no generated name_key, because Phase 3 owns the first
-- fold_unique_name_v1 consumer along with the Better Auth organization binding.
-- Forward recovery: nothing references this table yet, so a later migration can
-- DROP TABLE "workspace" outright until the first tenant table lands.
CREATE TABLE "workspace" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
