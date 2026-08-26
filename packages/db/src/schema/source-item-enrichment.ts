import {
  foreignKey,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { articleAdapter, enrichmentReason } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { operationAttempt } from "./operation-attempt";
import { sourceItemRevision } from "./source-item-revision";
import { workspace } from "./workspace";

// Successful units only. Freshness is from created_at; a matching page_content_hash reuses the row at any age.
export const sourceItemEnrichment = pgTable(
  "source_item_enrichment",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceItemRevisionId: uuid("source_item_revision_id").notNull(),
    operationAttemptId: uuid("operation_attempt_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    adapter: articleAdapter("adapter").notNull(),
    fallbackReason: enrichmentReason("fallback_reason"),
    pageContentHash: text("page_content_hash").notNull(),
    extract: text("extract").notNull(),
    brief: jsonb("brief"),
    providerRequestId: text("provider_request_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_source_item_enrichment_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_item_enrichment_source_item_revision_id",
      columns: [t.sourceItemRevisionId],
      foreignColumns: [sourceItemRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_item_enrichment_operation_attempt_id",
      columns: [t.operationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    unique(
      "uq_source_item_enrichment_workspace_id_source_item_rev_d3884b4d",
    ).on(
      t.workspaceId,
      t.sourceItemRevisionId,
      t.policyVersion,
      t.pageContentHash,
    ),
  ],
);
