import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  type PgTableExtraConfigValue,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { draftRevision } from "./draft-revision";
import { timestamps, workspaceScope } from "./helpers";
import { imageBrief } from "./image-brief";
import { mediaAsset } from "./media-asset";
import { mediaDerivation } from "./media-derivation";
import { operation } from "./operation";
import { operationAttempt } from "./operation-attempt";
import { workspace } from "./workspace";

export const imageGeneration = pgTable(
  "image_generation",
  {
    operationId: uuid("operation_id").primaryKey(),
    ...workspaceScope,
    draftRevisionId: uuid("draft_revision_id").notNull(),
    expectedRevisionVersion: integer("expected_revision_version"),
    expectedImageIntentVersion: integer("expected_image_intent_version"),
    imageBriefId: uuid("image_brief_id"),
    operatorDirection: text("operator_direction"),
    modelOptionKey: text("model_option_key").notNull(),
    referenceMediaAssetId: uuid("reference_media_asset_id"),
    providerGenerationOperationAttemptId: uuid(
      "provider_generation_operation_attempt_id",
    ),
    providerOriginalMediaAssetId: uuid("provider_original_media_asset_id"),
    finalMediaAssetId: uuid("final_media_asset_id"),
    ...timestamps,
  },
  (t): PgTableExtraConfigValue[] => [
    check(
      "ck_image_generation_expected_revision_version_nonnegative",
      sql`${t.expectedRevisionVersion} is null or ${t.expectedRevisionVersion} >= 0`,
    ),
    check(
      "ck_image_generation_expected_image_intent_version_nonnegative",
      sql`${t.expectedImageIntentVersion} is null or ${t.expectedImageIntentVersion} >= 0`,
    ),
    foreignKey({
      name: "fk_image_generation_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_draft_revision_id",
      columns: [t.draftRevisionId],
      foreignColumns: [draftRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_image_brief_id",
      columns: [t.imageBriefId],
      foreignColumns: [imageBrief.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_reference_media_asset_id",
      columns: [t.referenceMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_provider_generation_operation_attempt_id",
      columns: [t.providerGenerationOperationAttemptId],
      foreignColumns: [operationAttempt.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_provider_original_media_asset_id",
      columns: [t.providerOriginalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_final_media_asset_id",
      columns: [t.finalMediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_image_generation_final_media_derivation",
      columns: [t.workspaceId, t.finalMediaAssetId],
      foreignColumns: [
        mediaDerivation.workspaceId,
        mediaDerivation.derivedMediaAssetId,
      ],
    }).onDelete("restrict"),
    unique("uq_image_generation_provider_generation_operation_attempt_id").on(
      t.providerGenerationOperationAttemptId,
    ),
    unique("uq_image_generation_provider_original_media_asset_id").on(
      t.providerOriginalMediaAssetId,
    ),
    unique("uq_image_generation_final_media_asset_id").on(t.finalMediaAssetId),
    check(
      "ck_image_generation_distinct_media_roles",
      sql`(${t.referenceMediaAssetId} is null or ${t.providerOriginalMediaAssetId} is null or ${t.referenceMediaAssetId} <> ${t.providerOriginalMediaAssetId}) and (${t.referenceMediaAssetId} is null or ${t.finalMediaAssetId} is null or ${t.referenceMediaAssetId} <> ${t.finalMediaAssetId}) and (${t.providerOriginalMediaAssetId} is null or ${t.finalMediaAssetId} is null or ${t.providerOriginalMediaAssetId} <> ${t.finalMediaAssetId})`,
    ),
    check(
      "ck_image_generation_final_requires_original",
      sql`${t.finalMediaAssetId} is null or ${t.providerOriginalMediaAssetId} is not null`,
    ),
    check(
      "ck_image_generation_operator_direction_bounds",
      sql`${t.operatorDirection} is null or (char_length(${t.operatorDirection}) <= 1000 and octet_length(${t.operatorDirection}) <= 4000 and ${t.operatorDirection} !~ '[\\x00-\\x08\\x0B-\\x1F\\x7F-\\x9F]' and ${t.operatorDirection} !~ '[؜‎‏‪-‮⁦-⁩]')`,
    ),
    check(
      "ck_image_generation_bound_direction_cleared",
      sql`${t.imageBriefId} is null or ${t.operatorDirection} is null`,
    ),
    index("ix_image_generation_workspace_image_brief_created_at").on(
      t.workspaceId,
      t.imageBriefId,
      t.createdAt.desc(),
      t.operationId,
    ),
    index("ix_image_generation_workspace_draft_revision_created_at").on(
      t.workspaceId,
      t.draftRevisionId,
      t.createdAt.desc(),
      t.operationId,
    ),
    index("ix_image_generation_workspace_final_media_asset_id").on(
      t.workspaceId,
      t.finalMediaAssetId,
    ),
  ],
);
