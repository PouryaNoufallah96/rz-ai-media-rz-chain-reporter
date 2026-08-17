import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";

import { createDb } from "../index";
import { destinationAccount } from "../schema/destination-account";
import { draftRevision } from "../schema/draft-revision";
import { mediaBrand } from "../schema/media-brand";
import { mediaBrandDestinationAccount } from "../schema/media-brand-destination-account";
import { platformDraft } from "../schema/platform-draft";
import { source } from "../schema/source";
import { sourceItem } from "../schema/source-item";
import { workspace } from "../schema/workspace";
import {
  DEV_DRAFT_REVISION_ID,
  DEV_PLATFORM_DRAFT_ID,
  DEV_SOURCE_ITEM_ID,
} from "./dev-draft";
import {
  DEV_CHAIN_REPORTER_BRAND_ID,
  DEV_DESTINATION_ACCOUNTS,
  DEV_MEDIA_BRANDS,
  DEV_SOURCES,
} from "./dev-installation";
import { DEV_WORKSPACE_ID, DEV_WORKSPACE_NAME } from "./dev-workspace";

dotenv.config({
  path: "../../.env.migration",
});

const migrationEnv = validateMigrationEnv(process.env);

if (migrationEnv.NODE_ENV === "production") {
  throw new Error("dev seed refused outside development");
}

const database = createDb(migrationEnv.MIGRATION_DATABASE_URL);

try {
  await database.db
    .insert(workspace)
    .values({ id: DEV_WORKSPACE_ID, name: DEV_WORKSPACE_NAME })
    .onConflictDoNothing({ target: workspace.id });

  await database.db
    .insert(mediaBrand)
    .values(
      DEV_MEDIA_BRANDS.map((brand) => ({
        ...brand,
        workspaceId: DEV_WORKSPACE_ID,
      })),
    )
    .onConflictDoNothing({ target: mediaBrand.id });

  await database.db
    .insert(destinationAccount)
    .values(
      DEV_DESTINATION_ACCOUNTS.map((account) => ({
        ...account,
        workspaceId: DEV_WORKSPACE_ID,
      })),
    )
    .onConflictDoNothing({ target: destinationAccount.id });

  await database.db
    .insert(mediaBrandDestinationAccount)
    .values(
      DEV_MEDIA_BRANDS.flatMap((brand) =>
        DEV_DESTINATION_ACCOUNTS.map((account) => ({
          workspaceId: DEV_WORKSPACE_ID,
          mediaBrandId: brand.id,
          destinationAccountId: account.id,
        })),
      ),
    )
    .onConflictDoNothing({
      target: [
        mediaBrandDestinationAccount.workspaceId,
        mediaBrandDestinationAccount.mediaBrandId,
        mediaBrandDestinationAccount.destinationAccountId,
      ],
    });

  await database.db
    .insert(source)
    .values(
      DEV_SOURCES.map((configuredSource) => ({
        ...configuredSource,
        workspaceId: DEV_WORKSPACE_ID,
      })),
    )
    .onConflictDoNothing({ target: source.id });

  await database.db
    .insert(sourceItem)
    .values({
      id: DEV_SOURCE_ITEM_ID,
      workspaceId: DEV_WORKSPACE_ID,
      origin: "rss",
      externalId: "dev-source-item",
      title: "Dev source item",
      url: "https://example.com/dev-source-item",
      attribution: "Dev Feed",
      contentLocale: "en",
    })
    .onConflictDoNothing({ target: sourceItem.id });

  await database.db
    .insert(platformDraft)
    .values({
      id: DEV_PLATFORM_DRAFT_ID,
      workspaceId: DEV_WORKSPACE_ID,
      mediaBrandId: DEV_CHAIN_REPORTER_BRAND_ID,
      platform: "telegram",
      contentLocale: "en",
      sourceItemId: DEV_SOURCE_ITEM_ID,
    })
    .onConflictDoNothing({ target: platformDraft.id });

  await database.db
    .insert(draftRevision)
    .values({
      id: DEV_DRAFT_REVISION_ID,
      workspaceId: DEV_WORKSPACE_ID,
      platformDraftId: DEV_PLATFORM_DRAFT_ID,
      revisionNumber: 1,
      contentLocale: "en",
      headline: "Dev draft revision",
      copy: "Synthetic dev copy for the publish command.",
    })
    .onConflictDoNothing({ target: draftRevision.id });
} finally {
  await database.close();
}
