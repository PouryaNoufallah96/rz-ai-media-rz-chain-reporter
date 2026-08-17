import { foreignKey, jsonb, pgTable, text, unique } from "drizzle-orm/pg-core";

import { platform } from "./enums";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { workspace } from "./workspace";

// `key` is the domain identity of a concrete publishing destination; deployment
// configuration resolves it to a credential. Neither the credential nor the name
// of the variable holding it is ever stored here, and `metadata` carries only
// non-secret platform detail.
export const destinationAccount = pgTable(
  "destination_account",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    key: text("key").notNull(),
    platform: platform("platform").notNull(),
    metadata: jsonb("metadata"),
    ...timestamps,
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
