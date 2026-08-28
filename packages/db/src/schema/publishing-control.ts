import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { user } from "./auth";
import { timestamps } from "./helpers";
import { workspace } from "./workspace";

export const publishingControl = pgTable(
  "publishing_control",
  {
    workspaceId: uuid("workspace_id").primaryKey(),
    paused: boolean("paused").default(false).notNull(),
    pausedBy: text("paused_by"),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    reasonCode: text("reason_code"),
    version: integer("version").default(1).notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_publishing_control_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publishing_control_paused_by",
      columns: [t.pausedBy],
      foreignColumns: [user.id],
    }).onDelete("restrict"),
    check("ck_publishing_control_version_positive", sql`${t.version} > 0`),
    check(
      "ck_publishing_control_pause_fields",
      sql`${t.paused} = (${t.pausedBy} is not null and ${t.pausedAt} is not null) and (${t.paused} or ${t.reasonCode} is null)`,
    ),
  ],
);
