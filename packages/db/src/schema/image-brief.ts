import type {
  CreativeImageBrief,
  ErrorCode,
  SelectionRejection,
  TemplateSelection,
} from "@rz-chain-reporter/contracts";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { draftRevision } from "./draft-revision";
import { imageSourceProjectionKind, modelUnitStatus } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { imageVarietyMemory } from "./image-variety-memory";
import { operationAttempt } from "./operation-attempt";
import { promoIdea } from "./promo-idea";
import { sourceItemEnrichment } from "./source-item-enrichment";
import { sourceItemRevision } from "./source-item-revision";
import { workspace } from "./workspace";

export const imageBrief = pgTable(
  "image_brief",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    draftRevisionId: uuid("draft_revision_id").notNull(),
    status: modelUnitStatus("status").default("pending").notNull(),
    terminalFailureCode: text("terminal_failure_code").$type<ErrorCode>(),
    templateSelection: jsonb("template_selection").$type<TemplateSelection>(),
    selectionRejections: jsonb("selection_rejections")
      .$type<SelectionRejection[]>()
      .default(sql`'[]'::jsonb`)
      .notNull(),
    creativeBrief: jsonb("creative_brief").$type<CreativeImageBrief>(),
    deterministicFallback: boolean("deterministic_fallback")
      .default(false)
      .notNull(),
    fallbackCode: text("fallback_code").$type<ErrorCode>(),
    varietyDegraded: boolean("variety_degraded").default(false).notNull(),
    repeatedImageVarietyMemoryId: uuid("repeated_image_variety_memory_id"),
    templateSelectionOperationAttemptId: uuid(
      "template_selection_operation_attempt_id",
    ).notNull(),
    creativeBriefOperationAttemptId: uuid(
      "creative_brief_operation_attempt_id",
    ),
    operatorDirection: text("operator_direction"),
    sourceProjectionKind: imageSourceProjectionKind(
      "source_projection_kind",
    ).notNull(),
    sourceProjectionVersion: text("source_projection_version").notNull(),
    sourceProjectionDigest: text("source_projection_digest").notNull(),
    rssSourceItemEnrichmentId: uuid("rss_source_item_enrichment_id"),
    rssPageContentHash: text("rss_page_content_hash"),
    telegramSourceItemRevisionId: uuid("telegram_source_item_revision_id"),
    telegramContentHash: text("telegram_content_hash"),
    promoIdeaId: uuid("promo_idea_id"),
    brandPolicyFingerprint: text("brand_policy_fingerprint").notNull(),
    imageProfileFingerprint: text("image_profile_fingerprint").notNull(),
    providerPrompt: text("provider_prompt"),
    providerPromptDigest: text("provider_prompt_digest"),
    promptSchemaVersion: text("prompt_schema_version").notNull(),
    assemblerVersion: text("assembler_version").notNull(),
    configurationVersion: text("configuration_version").notNull(),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    foreignKey({
      name: "fk_image_brief_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_repeated_image_variety_memory_id",
      columns: [t.repeatedImageVarietyMemoryId],
      foreignColumns: [imageVarietyMemory.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_template_selection_operation_attempt_id",
      columns: [t.templateSelectionOperationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_creative_brief_operation_attempt_id",
      columns: [t.creativeBriefOperationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_rss_source_item_enrichment_id",
      columns: [t.rssSourceItemEnrichmentId],
      foreignColumns: [sourceItemEnrichment.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_telegram_source_item_revision_id",
      columns: [t.telegramSourceItemRevisionId],
      foreignColumns: [sourceItemRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_brief_promo_idea_id",
      columns: [t.promoIdeaId],
      foreignColumns: [promoIdea.id],
    }).onDelete("restrict"),
    unique("uq_image_brief_template_selection_operation_attempt_id").on(
      t.templateSelectionOperationAttemptId,
    ),
    unique("uq_image_brief_creative_brief_operation_attempt_id").on(
      t.creativeBriefOperationAttemptId,
    ),
    check(
      "ck_image_brief_template_selection_shape",
      sql`${t.templateSelection} is null or (jsonb_typeof(${t.templateSelection}) = 'object' and ${t.templateSelection} ?& array['family', 'axes'] and ${t.templateSelection} - array['family', 'axes'] = '{}'::jsonb and jsonb_typeof(${t.templateSelection}->'family') = 'string' and jsonb_typeof(${t.templateSelection}->'axes') = 'object')`,
    ),
    check(
      "ck_image_brief_creative_brief_shape",
      sql`${t.creativeBrief} is null or (jsonb_typeof(${t.creativeBrief}) = 'object' and ${t.creativeBrief} ?& array['headline', 'subjectScene', 'dataElements'] and ${t.creativeBrief} - array['headline', 'subjectScene', 'dataElements'] = '{}'::jsonb and jsonb_typeof(${t.creativeBrief}->'headline') = 'string' and jsonb_typeof(${t.creativeBrief}->'subjectScene') = 'string' and jsonb_typeof(${t.creativeBrief}->'dataElements') = 'array')`,
    ),
    check(
      "ck_image_brief_selection_rejections_shape",
      sql`jsonb_typeof(${t.selectionRejections}) = 'array' and jsonb_array_length(${t.selectionRejections}) <= 3`,
    ),
    check(
      "ck_image_brief_source_projection_owner",
      sql`(${t.sourceProjectionKind} = 'rss_extract' and ${t.rssSourceItemEnrichmentId} is not null and ${t.rssPageContentHash} is not null and ${t.telegramSourceItemRevisionId} is null and ${t.telegramContentHash} is null and ${t.promoIdeaId} is null) or (${t.sourceProjectionKind} = 'telegram_post' and ${t.rssSourceItemEnrichmentId} is null and ${t.rssPageContentHash} is null and ${t.telegramSourceItemRevisionId} is not null and ${t.telegramContentHash} is not null and ${t.promoIdeaId} is null) or (${t.sourceProjectionKind} = 'promo_idea' and ${t.rssSourceItemEnrichmentId} is null and ${t.rssPageContentHash} is null and ${t.telegramSourceItemRevisionId} is null and ${t.telegramContentHash} is null and ${t.promoIdeaId} is not null)`,
    ),
    check(
      "ck_image_brief_terminal_state_consistent",
      sql`(${t.status} = 'succeeded' and ${t.templateSelection} is not null and ${t.creativeBrief} is not null and ${t.providerPrompt} is not null and ${t.providerPromptDigest} is not null and ${t.terminalFailureCode} is null) or (${t.status} = 'failed' and ${t.terminalFailureCode} is not null and ${t.providerPrompt} is null) or ${t.status} in ('pending', 'running', 'cancelled')`,
    ),
    check(
      "ck_image_brief_succeeded_creative_attempt_consistent",
      sql`${t.status} <> 'succeeded' or ((${t.creativeBriefOperationAttemptId} is null) = ${t.deterministicFallback})`,
    ),
    check(
      "ck_image_brief_repeated_memory_consistent",
      sql`${t.repeatedImageVarietyMemoryId} is null or (${t.deterministicFallback} and ${t.varietyDegraded})`,
    ),
    check(
      "ck_image_brief_provider_prompt_digest_consistent",
      sql`(${t.providerPrompt} is null) = (${t.providerPromptDigest} is null)`,
    ),
    check(
      "ck_image_brief_operator_direction_bounds",
      sql`${t.operatorDirection} is null or (char_length(${t.operatorDirection}) <= 1000 and octet_length(${t.operatorDirection}) <= 4000 and ${t.operatorDirection} !~ '[\\x00-\\x08\\x0B-\\x1F\\x7F-\\x9F]' and ${t.operatorDirection} !~ '[؜‎‏‪-‮⁦-⁩]')`,
    ),
    index("ix_image_brief_workspace_draft_revision_created_at").on(
      t.workspaceId,
      t.draftRevisionId,
      t.createdAt.desc(),
      t.id,
    ),
  ],
);
