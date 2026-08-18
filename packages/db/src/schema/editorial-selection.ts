import {
  foreignKey,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { analysisRun } from "./analysis-run";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaBrand } from "./media-brand";
import { sourceItem } from "./source-item";
import { workspace } from "./workspace";

export const editorialSelection = pgTable(
  "editorial_selection",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisRunId: uuid("analysis_run_id").notNull(),
    editorialModel: text("editorial_model").notNull(),
    mediaBrandId: uuid("media_brand_id").notNull(),
    rank: integer("rank").notNull(),
    sourceItemId: uuid("source_item_id").notNull(),
    reasoning: text("reasoning"),
    scores: jsonb("scores"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_editorial_selection_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_selection_analysis_run_id",
      columns: [t.analysisRunId],
      foreignColumns: [analysisRun.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_selection_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_editorial_selection_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    unique(
      "uq_editorial_selection_workspace_id_analysis_run_id_ed_838762e6",
    ).on(
      t.workspaceId,
      t.analysisRunId,
      t.editorialModel,
      t.mediaBrandId,
      t.rank,
    ),
  ],
);
