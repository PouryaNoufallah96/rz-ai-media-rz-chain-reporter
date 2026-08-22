import {
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { sourceFetchOutcome, sourceFetchReason } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { source } from "./source";
import { sourceImport } from "./source-import";
import { workspace } from "./workspace";

// started_at is the fetch start and updated_at is the settle; created_at is neither.
export const sourceImportSource = pgTable(
  "source_import_source",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    sourceImportId: uuid("source_import_id").notNull(),
    sourceId: uuid("source_id").notNull(),
    outcome: sourceFetchOutcome("outcome").notNull(),
    reason: sourceFetchReason("reason"),
    etag: text("etag"),
    lastModified: text("last_modified"),
    fetchedCount: integer("fetched_count").notNull().default(0),
    admittedCount: integer("admitted_count").notNull().default(0),
    startedAt: timestamp("started_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_source_import_source_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_source_import_source_source_import_id",
      columns: [t.sourceImportId],
      foreignColumns: [sourceImport.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_source_import_source_source_id",
      columns: [t.sourceId],
      foreignColumns: [source.id],
    }).onDelete("restrict"),
    unique(
      "uq_source_import_source_workspace_id_source_import_id_source_id",
    ).on(t.workspaceId, t.sourceImportId, t.sourceId),
    index("ix_source_import_source_workspace_id_source_id_started_at").on(
      t.workspaceId,
      t.sourceId,
      t.startedAt,
    ),
  ],
);
