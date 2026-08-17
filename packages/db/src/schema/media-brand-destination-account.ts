import { foreignKey, pgTable, unique, uuid } from "drizzle-orm/pg-core";

import { destinationAccount } from "./destination-account";
import { timestamps, uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaBrand } from "./media-brand";
import { workspace } from "./workspace";

// The customer template's brand-to-destination mapping, many-to-many in both
// directions: several brands may share one account and one brand may publish to
// several platforms. Both edges restrict because the mapping is configuration —
// removing a brand or an account must not silently drop it.
export const mediaBrandDestinationAccount = pgTable(
  "media_brand_destination_account",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    mediaBrandId: uuid("media_brand_id").notNull(),
    destinationAccountId: uuid("destination_account_id").notNull(),
    ...timestamps,
  },
  (t) => [
    foreignKey({
      name: "fk_media_brand_destination_account_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_media_brand_destination_account_media_brand_id",
      columns: [t.mediaBrandId],
      foreignColumns: [mediaBrand.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_media_brand_destination_account_destination_account_id",
      columns: [t.destinationAccountId],
      foreignColumns: [destinationAccount.id],
    }).onDelete("restrict"),
    // Assembled name is 85 bytes; stored under the §7.3 truncation of
    // uq_media_brand_destination_account_workspace_id_media_brand_id_destination_account_id.
    unique(
      "uq_media_brand_destination_account_workspace_id_media__6f636d2f",
    ).on(t.workspaceId, t.mediaBrandId, t.destinationAccountId),
  ],
);
