import {
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { analysisRun } from "./analysis-run";
import { filterDisposition, filteringReason } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaBrand } from "./media-brand";
import { sourceItem } from "./source-item";
import { workspace } from "./workspace";

// Scores for gates never reached stay null; rank_position is absent for
// no_media_fit and low_score.
export const filterResult = pgTable(
  "filter_result",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisRunId: uuid("analysis_run_id").notNull(),
    sourceItemId: uuid("source_item_id").notNull(),
    mediaBrandId: uuid("media_brand_id").notNull(),
    disposition: filterDisposition("disposition").notNull(),
    reason: filteringReason("reason"),
    valueSignalCount: smallint("value_signal_count"),
    mediaFitScore: smallint("media_fit_score"),
    sourcePreferenceScore: smallint("source_preference_score"),
    diversityScore: smallint("diversity_score"),
    semanticBrandScore: smallint("semantic_brand_score"),
    policyScore: smallint("policy_score"),
    rankScore: smallint("rank_score"),
    rankPosition: integer("rank_position"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_filter_result_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_filter_result_analysis_run_id",
      columns: [t.analysisRunId],
      foreignColumns: [analysisRun.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_filter_result_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_filter_result_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    unique(
      "uq_filter_result_workspace_id_analysis_run_id_source_i_5a1c2e10",
    ).on(t.workspaceId, t.analysisRunId, t.sourceItemId, t.mediaBrandId),
    index("ix_filter_result_workspace_id_analysis_run_id_rank_position_id").on(
      t.workspaceId,
      t.analysisRunId,
      t.rankPosition,
      t.sourceItemId,
    ),
    index("ix_filter_result_workspace_id_analysis_run_id_media_br_46f52f27").on(
      t.workspaceId,
      t.analysisRunId,
      t.mediaBrandId,
      t.rankPosition,
    ),
  ],
);
