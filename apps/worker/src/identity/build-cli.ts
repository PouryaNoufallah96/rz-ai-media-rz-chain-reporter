import "dotenv/config";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BUILD_METADATA_FILE,
  runTemplateBuild,
} from "@rz-chain-reporter/customer-template/build-metadata";

const outputDir = fileURLToPath(new URL("../../dist/", import.meta.url));

mkdirSync(outputDir, { recursive: true });

process.exitCode = runTemplateBuild({
  command: "build:template",
  repositoryRoot: fileURLToPath(new URL("../../../../", import.meta.url)),
  metadataPath: `${outputDir}${BUILD_METADATA_FILE}`,
  customerTemplateKey: process.env.CUSTOMER_TEMPLATE_KEY,
});
