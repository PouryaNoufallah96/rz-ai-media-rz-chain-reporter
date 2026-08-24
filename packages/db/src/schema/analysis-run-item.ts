import {
  foreignKey,
  pgTable,
  smallint,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { analysisRun } from "./analysis-run";
import {
  duplicateMethod,
  itemEligibility,
  semanticParticipation,
} from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { sourceItem } from "./source-item";
import { sourceItemRevision } from "./source-item-revision";
import { workspace } from "./workspace";

// Candidate loading pins the revision; filter-and-score exclusively owns score,
// semantic, duplicate, and final eligibility fields.
export const analysisRunItem = pgTable(
  "analysis_run_item",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisRunId: uuid("analysis_run_id").notNull(),
    sourceItemId: uuid("source_item_id").notNull(),
    sourceItemRevisionId: uuid("source_item_revision_id").notNull(),
    eligibility: itemEligibility("eligibility").notNull(),
    duplicateMethod: duplicateMethod("duplicate_method"),
    duplicateOfSourceItemId: uuid("duplicate_of_source_item_id"),
    duplicateSimilarityBp: smallint("duplicate_similarity_bp"),
    sourceAuthorityScore: smallint("source_authority_score"),
    freshnessScore: smallint("freshness_score"),
    policyViralityScore: smallint("policy_virality_score"),
    lexicalTopicScore: smallint("lexical_topic_score"),
    lexicalTopicIndex: smallint("lexical_topic_index"),
    semanticTopicScore: smallint("semantic_topic_score"),
    semanticTopicIndex: smallint("semantic_topic_index"),
    semanticParticipation: semanticParticipation("semantic_participation"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_analysis_run_item_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_run_item_analysis_run_id",
      columns: [t.analysisRunId],
      foreignColumns: [analysisRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_analysis_run_item_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_run_item_source_item_revision_id",
      columns: [t.sourceItemRevisionId],
      foreignColumns: [sourceItemRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_analysis_run_item_duplicate_of_source_item_id",
      columns: [t.duplicateOfSourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    unique(
      "uq_analysis_run_item_workspace_id_analysis_run_id_sour_cf4fb965",
    ).on(t.workspaceId, t.analysisRunId, t.sourceItemId),
  ],
);
