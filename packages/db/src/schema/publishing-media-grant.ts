import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { uuidPrimaryKey, workspaceScope } from "./helpers";
import { mediaAsset } from "./media-asset";
import { operation } from "./operation";
import { publication } from "./publication";
import { workspace } from "./workspace";

export const publishingMediaGrant = pgTable(
  "publishing_media_grant",
  {
    ...uuidPrimaryKey,
    ...workspaceScope,
    publicationId: uuid("publication_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    mediaAssetId: uuid("media_asset_id").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    containerAcceptedAt: timestamp("container_accepted_at", {
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    version: integer("version").default(1).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    foreignKey({
      name: "fk_publishing_media_grant_workspace_id",
      columns: [t.workspaceId],
      foreignColumns: [workspace.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publishing_media_grant_publication_id",
      columns: [t.publicationId],
      foreignColumns: [publication.id],
    }).onDelete("restrict"),
    foreignKey({
      name: "fk_publishing_media_grant_operation_id",
      columns: [t.operationId],
      foreignColumns: [operation.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "fk_publishing_media_grant_media_asset_id",
      columns: [t.mediaAssetId],
      foreignColumns: [mediaAsset.id],
    }).onDelete("restrict"),
    unique("uq_publishing_media_grant_token_hash").on(t.tokenHash),
    unique("uq_publishing_media_grant_operation_asset").on(
      t.workspaceId,
      t.operationId,
      t.mediaAssetId,
    ),
    check("ck_publishing_media_grant_version_positive", sql`${t.version} > 0`),
    check(
      "ck_publishing_media_grant_terminal_exclusive",
      sql`num_nonnulls(${t.containerAcceptedAt}, ${t.revokedAt}) <= 1`,
    ),
  ],
);
