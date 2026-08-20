import { fileURLToPath } from "node:url";
import {
  BUILD_METADATA_FILE,
  writeBuildMetadata,
} from "@rz-chain-reporter/customer-template/build-metadata";
import {
  CustomerTemplateError,
  loadCustomerTemplate,
} from "@rz-chain-reporter/customer-template/load";

const EXIT_FAILURE = 1;

const command = "build:template";
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const metadataPath = fileURLToPath(
  new URL(`../${BUILD_METADATA_FILE}`, import.meta.url),
);
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

  writeBuildMetadata(metadataPath, {
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
