import { fileURLToPath } from "node:url";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";

import { notDeleted } from "../filters";
import { createDb } from "../index";
import { reconcileCustomerTemplate } from "../reconcile/customer-template";
import { formatReconcileReport } from "../reconcile/report";
import { draftRevision } from "../schema/draft-revision";
import { mediaBrand } from "../schema/media-brand";
import { platformDraft } from "../schema/platform-draft";
import { source } from "../schema/source";
import { sourceItem } from "../schema/source-item";
import { workspace } from "../schema/workspace";
import {
  DEV_DRAFT_REVISION_ID,
  DEV_PLATFORM_DRAFT_ID,
  DEV_SOURCE_ITEM_ID,
} from "./dev-draft";

// The dev installation is the crypto customer, reconciled from its committed
// template; only the synthetic draft below is dev-only material.
const DEV_TEMPLATE_KEY = "crypto";
const DEV_DRAFT_BRAND_KEY = "chain-reporter";
const DEV_SOURCE_KEY = "coindesk-rss";

dotenv.config({
  path: "../../.env.migration",
});

const migrationEnv = validateMigrationEnv(process.env);

if (migrationEnv.NODE_ENV === "production") {
  throw new Error("dev seed refused outside development");
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const database = createDb(migrationEnv.MIGRATION_DATABASE_URL);

try {
  const loaded = loadCustomerTemplate(repositoryRoot, DEV_TEMPLATE_KEY);
  const report = await reconcileCustomerTemplate(database.db, loaded, "apply");

  console.log(formatReconcileReport(report));

  const [brand] = await database.db
    .select({ id: mediaBrand.id, workspaceId: mediaBrand.workspaceId })
    .from(mediaBrand)
    .innerJoin(workspace, eq(workspace.id, mediaBrand.workspaceId))
    .where(
      and(
        eq(workspace.customerTemplateKey, DEV_TEMPLATE_KEY),
        eq(mediaBrand.key, DEV_DRAFT_BRAND_KEY),
        notDeleted(mediaBrand),
      ),
    );

  if (!brand) {
    throw new Error(
      `dev seed found no live media brand "${DEV_DRAFT_BRAND_KEY}" in the ${DEV_TEMPLATE_KEY} installation`,
    );
  }

  const [devSource] = await database.db
    .select({ id: source.id })
    .from(source)
    .where(
      and(
        eq(source.workspaceId, brand.workspaceId),
        eq(source.key, DEV_SOURCE_KEY),
        notDeleted(source),
      ),
    );

  if (!devSource) {
    throw new Error(
      `dev seed found no live source "${DEV_SOURCE_KEY}" in the ${DEV_TEMPLATE_KEY} installation`,
    );
  }

  await database.db
    .insert(sourceItem)
    .values({
      id: DEV_SOURCE_ITEM_ID,
      workspaceId: brand.workspaceId,
      sourceId: devSource.id,
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
      workspaceId: brand.workspaceId,
      mediaBrandId: brand.id,
      platform: "telegram",
      contentLocale: "en",
      sourceItemId: DEV_SOURCE_ITEM_ID,
    })
    .onConflictDoNothing({ target: platformDraft.id });

  await database.db
    .insert(draftRevision)
    .values({
      id: DEV_DRAFT_REVISION_ID,
      workspaceId: brand.workspaceId,
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
