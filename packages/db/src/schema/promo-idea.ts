import {
  foreignKey,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { analysisModelUnit } from "./analysis-model-unit";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// Promo Ideas have no Source Item; run/brand/model/task provenance comes from the unit.
export const promoIdea = pgTable(
  "promo_idea",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    analysisModelUnitId: uuid("analysis_model_unit_id").notNull(),
    rank: integer("rank").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull(),
    angle: text("angle").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_promo_idea_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_promo_idea_analysis_model_unit_id",
      columns: [t.analysisModelUnitId],
      foreignColumns: [analysisModelUnit.id],
    }).onDelete("cascade"),
    unique("uq_promo_idea_workspace_id_analysis_model_unit_id_rank").on(
      t.workspaceId,
      t.analysisModelUnitId,
      t.rank,
    ),
  ],
);
