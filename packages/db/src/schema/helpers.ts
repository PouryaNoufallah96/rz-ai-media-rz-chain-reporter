import { sql } from "drizzle-orm";
import { timestamp, uuid } from "drizzle-orm/pg-core";

export const uuidPrimaryKey = {
  id: uuid("id").primaryKey().default(sql`uuidv7()`),
};

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull(),
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

// The restrict edge to `workspace` is declared per table as a named
// `foreignKey()`, because the constraint grammar the SQLSTATE walker
// discriminates on needs `fk_<table>_workspace_id` and `.references()` cannot
// spell a constraint name.
export const workspaceScope = {
  workspaceId: uuid("workspace_id").notNull(),
};
