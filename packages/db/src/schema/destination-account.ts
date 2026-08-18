import {
  boolean,
  foreignKey,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { platform } from "./enums";
import {
  softDelete,
  timestamps,
  uuidPrimaryKey,
  workspaceScope,
} from "./helpers";
import { workspace } from "./workspace";

export const destinationAccount = pgTable(
  "destination_account",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    key: text("key").notNull(),
    platform: platform("platform").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    metadata: jsonb("metadata"),
    bindingPresent: boolean("binding_present"),
    bindingCheckedAt: timestamp("binding_checked_at", { withTimezone: true }),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    foreignKey({
      name: "fk_destination_account_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    unique("uq_destination_account_workspace_id_key").on(t.workspaceId, t.key),
  ],
);
