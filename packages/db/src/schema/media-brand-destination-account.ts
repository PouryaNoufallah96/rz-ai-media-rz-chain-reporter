import { foreignKey, pgTable, unique, uuid } from "drizzle-orm/pg-core";

import { destinationAccount } from "./destination-account";
import {
  softDelete,
  timestamps,
  uuidPrimaryKey,
  workspaceScope,
} from "./helpers";
import { mediaBrand } from "./media-brand";
import { workspace } from "./workspace";

export const mediaBrandDestinationAccount = pgTable(
  "media_brand_destination_account",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    mediaBrandId: uuid("media_brand_id").notNull(),
    destinationAccountId: uuid("destination_account_id").notNull(),
    ...timestamps,
    ...softDelete,
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
    unique(
      "uq_media_brand_destination_account_workspace_id_media__6f636d2f",
    ).on(t.workspaceId, t.mediaBrandId, t.destinationAccountId),
  ],
);
