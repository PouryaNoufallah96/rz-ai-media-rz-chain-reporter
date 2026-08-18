import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CustomerTemplateError,
  loadCustomerTemplate,
} from "@rz-chain-reporter/customer-template/load";

import { BUILD_METADATA_FILE, writeBuildMetadata } from "./build-metadata";

const EXIT_FAILURE = 1;

const command = "build:template";
const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const outputDir = fileURLToPath(new URL("../../dist/", import.meta.url));
const customerTemplateKey = process.env.CUSTOMER_TEMPLATE_KEY;

if (!customerTemplateKey) {
  console.error(
    `${command} failed [MISSING_TEMPLATE_KEY]: CUSTOMER_TEMPLATE_KEY is not set`,
  );
  process.exit(EXIT_FAILURE);
}

try {
  const { template, fingerprint } = loadCustomerTemplate(
    repositoryRoot,
    customerTemplateKey,
  );

  mkdirSync(outputDir, { recursive: true });
  writeBuildMetadata(`${outputDir}${BUILD_METADATA_FILE}`, {
    customerTemplateKey,
    schemaVersion: template.schemaVersion,
    fingerprint,
  });

  console.log(
    `${command} ${customerTemplateKey} schemaVersion ${template.schemaVersion} fingerprint ${fingerprint}`,
  );
} catch (error) {
  process.exitCode = EXIT_FAILURE;

  if (error instanceof CustomerTemplateError) {
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else {
    console.error(`${command} failed:`, error);
  }
}
