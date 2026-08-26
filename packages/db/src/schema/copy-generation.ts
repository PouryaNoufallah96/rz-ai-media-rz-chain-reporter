import type { EnrichmentReason } from "@rz-chain-reporter/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { contentLocale } from "./enums";
import { timestamps, workspaceScope } from "./helpers";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { platformDraft } from "./platform-draft";
import { sourceItemEnrichment } from "./source-item-enrichment";
import { sourceItemRevision } from "./source-item-revision";
import { workspace } from "./workspace";

export const copyGeneration = pgTable(
  "copy_generation",
  {
    operationId: uuid("operation_id").primaryKey(),
    ...workspaceScope,
    platformDraftId: uuid("platform_draft_id").notNull(),
    requestedContentLocale: contentLocale("requested_content_locale").notNull(),
    modelOptionKey: text("model_option_key").notNull(),
    forceArticleRefresh: boolean("force_article_refresh")
      .default(false)
      .notNull(),
    pageFetchOperationAttemptId: uuid("page_fetch_operation_attempt_id"),
    sourceItemRevisionId: uuid("source_item_revision_id"),
    sourceItemEnrichmentId: uuid("source_item_enrichment_id"),
    pageContentHash: text("page_content_hash"),
    limited: boolean("limited").default(false).notNull(),
    limitedReason: text("limited_reason").$type<EnrichmentReason>(),
    customerTemplateFingerprint: text(
      "customer_template_fingerprint",
    ).notNull(),
    brandPolicyFingerprint: text("brand_policy_fingerprint").notNull(),
    promptVersion: text("prompt_version").notNull(),
    configurationVersion: text("configuration_version").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_copy_generation_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_platform_draft_id",
      columns: [t.platformDraftId],
      foreignColumns: [platformDraft.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_page_fetch_operation_attempt_id",
      columns: [t.pageFetchOperationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_source_item_revision_id",
      columns: [t.sourceItemRevisionId],
      foreignColumns: [sourceItemRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_copy_generation_source_item_enrichment_id",
      columns: [t.sourceItemEnrichmentId],
      foreignColumns: [sourceItemEnrichment.id],
    }).onDelete("restrict"),
    unique("uq_copy_generation_page_fetch_operation_attempt_id").on(
      t.pageFetchOperationAttemptId,
    ),
    check(
      "ck_copy_generation_enrichment_provenance_complete",
      sql`${t.sourceItemEnrichmentId} is null or (${t.sourceItemRevisionId} is not null and ${t.pageContentHash} is not null)`,
    ),
    check(
      "ck_copy_generation_limited_reason_consistent",
      sql`${t.limited} = (${t.limitedReason} is not null)`,
    ),
    index("ix_copy_generation_workspace_platform_draft_created_at").on(
      t.workspaceId,
      t.platformDraftId,
      t.createdAt.desc(),
      t.operationId,
    ),
  ],
);
