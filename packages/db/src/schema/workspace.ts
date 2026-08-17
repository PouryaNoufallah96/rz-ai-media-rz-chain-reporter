import { pgTable, text } from "drizzle-orm/pg-core";

import { timestamps, uuidPrimaryKey } from "./helpers";

// Display name only: no name_key and no unique name. Workspace names are the
// first fold_unique_name_v1 consumer and Phase 3 owns that decision. There is
// no organization binding to come: ADR 0005 retires Better Auth organizations
// and one deployment holds exactly one workspace row.
export const workspace = pgTable("workspace", {
  ...uuidPrimaryKey,
  name: text("name").notNull(),
  ...timestamps,
});
