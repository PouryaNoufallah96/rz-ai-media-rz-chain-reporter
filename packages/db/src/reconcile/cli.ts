import { fileURLToPath } from "node:url";
import { notifyCacheInvalidation } from "@rz-chain-reporter/cache-invalidation";
import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import {
  CustomerTemplateError,
  loadCustomerTemplate,
} from "@rz-chain-reporter/customer-template/load";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";

import { createDb } from "../index";
import { ReconcileError, reconcileCustomerTemplate } from "./customer-template";
import { formatReconcileReport } from "./report";

const EXIT_FAILURE = 1;
const EXIT_DIVERGENT = 2;

dotenv.config({
  path: "../../.env.migration",
});

const unknownArguments = process.argv
  .slice(2)
  .filter((argument) => argument !== "--check");

if (unknownArguments.length > 0) {
  console.error(
    `template:reconcile failed [USAGE]: unsupported argument ${unknownArguments.join(" ")}; the only flag is --check`,
  );
  process.exit(EXIT_FAILURE);
}

const mode = process.argv.includes("--check") ? "check" : "apply";
const migrationEnv = validateMigrationEnv(process.env);
const customerTemplateKey = process.env.CUSTOMER_TEMPLATE_KEY;

if (!customerTemplateKey) {
  console.error(
    "template:reconcile failed [MISSING_TEMPLATE_KEY]: CUSTOMER_TEMPLATE_KEY is not set",
  );
  process.exit(EXIT_FAILURE);
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const database = createDb(migrationEnv.MIGRATION_DATABASE_URL);
let exitCode = 0;

try {
  const loaded = loadCustomerTemplate(repositoryRoot, customerTemplateKey);
  const report = await reconcileCustomerTemplate(database.db, loaded, mode);

  console.log(formatReconcileReport(report));

  if (report.workspaceId && report.appliedAt) {
    console.log(
      `cache invalidation ${await notifyCacheInvalidation({
        baseUrl: migrationEnv.WEB_INTERNAL_BASE_URL,
        secret: migrationEnv.CACHE_INVALIDATION_WEBHOOK_SECRET,
        tags: [
          workspaceCacheTag(report.workspaceId, "installation"),
          workspaceCacheTag(report.workspaceId, "sources"),
        ],
      })}`,
    );
  }

  if (mode === "check" && report.divergent) {
    exitCode = EXIT_DIVERGENT;
  }
} catch (error) {
  exitCode = EXIT_FAILURE;

  if (
    error instanceof CustomerTemplateError ||
    error instanceof ReconcileError
  ) {
    console.error(
      `template:reconcile failed [${error.code}]: ${error.message}`,
    );
  } else {
    console.error("template:reconcile failed:", error);
  }
} finally {
  await database.close();
}

process.exitCode = exitCode;
