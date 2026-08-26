import {
  foreignKey,
  integer,
  pgTable,
  smallint,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { analysisModelUnit } from "./analysis-model-unit";
import { platform } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { sourceItem } from "./source-item";
import { workspace } from "./workspace";

export const editorialSelection = pgTable(
  "editorial_selection",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisModelUnitId: uuid("analysis_model_unit_id").notNull(),
    rank: integer("rank").notNull(),
    sourceItemId: uuid("source_item_id").notNull(),
    suggestedPlatform: platform("suggested_platform").notNull(),
    reasoning: text("reasoning"),
    selectionSuitabilityScore: smallint("selection_suitability_score"),
    selectionImpactScore: smallint("selection_impact_score"),
    selectionViralityScore: smallint("selection_virality_score"),
    selectionConfidenceScore: smallint("selection_confidence_score"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_editorial_selection_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_selection_analysis_model_unit_id",
      columns: [t.analysisModelUnitId],
      foreignColumns: [analysisModelUnit.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_editorial_selection_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    unique(
      "uq_editorial_selection_workspace_id_analysis_model_unit_id_rank",
    ).on(t.workspaceId, t.analysisModelUnitId, t.rank),
    unique(
      "uq_editorial_selection_workspace_id_analysis_model_uni_8cd4ece6",
    ).on(t.workspaceId, t.analysisModelUnitId, t.sourceItemId),
  ],
);
