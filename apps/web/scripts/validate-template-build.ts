import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  CustomerTemplateError,
  loadCustomerTemplate,
} from "@rz-chain-reporter/customer-template/load";

const EXIT_FAILURE = 1;

const command = "build:template";
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
// The prestart bundle reads this shape back; both writers keep the same key
// order so two builds of one template produce byte-identical metadata.
const metadataPath = fileURLToPath(
  new URL("../build-metadata.json", import.meta.url),
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

  writeFileSync(
    metadataPath,
    `${JSON.stringify(
      {
        customerTemplateKey,
        schemaVersion: template.schemaVersion,
        fingerprint,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

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
