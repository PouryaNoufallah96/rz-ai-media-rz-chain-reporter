import {
  bigint,
  doublePrecision,
  foreignKey,
  index,
  integer,
  pgTable,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { admissionOutcome, enrichmentOutcome, enrichmentReason } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { sourceImport } from "./source-import";
import { sourceItem } from "./source-item";
import { sourceItemEnrichment } from "./source-item-enrichment";
import { sourceItemRevision } from "./source-item-revision";
import { workspace } from "./workspace";

export const sourceImportItem = pgTable(
  "source_import_item",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceImportId: uuid("source_import_id").notNull(),
    sourceItemId: uuid("source_item_id").notNull(),
    sourceItemRevisionId: uuid("source_item_revision_id").notNull(),
    admission: admissionOutcome("admission").notNull(),
    rank: integer("rank"),
    keywordScore: doublePrecision("keyword_score"),
    views: bigint("views", { mode: "number" }),
    enrichmentOutcome: enrichmentOutcome("enrichment_outcome"),
    enrichmentReason: enrichmentReason("enrichment_reason"),
    enrichmentId: uuid("enrichment_id"),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_source_import_item_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_import_item_source_import_id",
      columns: [t.sourceImportId],
      foreignColumns: [sourceImport.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_source_import_item_source_item_id",
      columns: [t.sourceItemId],
      foreignColumns: [sourceItem.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_import_item_source_item_revision_id",
      columns: [t.sourceItemRevisionId],
      foreignColumns: [sourceItemRevision.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_import_item_enrichment_id",
      columns: [t.enrichmentId],
      foreignColumns: [sourceItemEnrichment.id],
    }).onDelete("restrict"),
    unique(
      "uq_source_import_item_workspace_id_source_import_id_so_ef8b0562",
    ).on(t.workspaceId, t.sourceImportId, t.sourceItemId),
    index("ix_source_import_item_source_item_id").on(t.sourceItemId),
  ],
);
