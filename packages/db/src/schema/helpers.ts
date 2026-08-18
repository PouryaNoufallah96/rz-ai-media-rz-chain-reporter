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

// Named `fk_<table>_workspace_id`: `.references()` cannot spell the SQLSTATE walker name.
export const workspaceScope = {
  workspaceId: uuid("workspace_id").notNull(),
};
