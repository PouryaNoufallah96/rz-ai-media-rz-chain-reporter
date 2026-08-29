import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  BUILD_METADATA_FILE,
  runTemplateBuild,
} from "@rz-chain-reporter/customer-template/build-metadata";

process.exitCode = runTemplateBuild({
  command: "build:template",
  repositoryRoot: fileURLToPath(new URL("../../../", import.meta.url)),
  metadataPath: fileURLToPath(
    new URL(`../${BUILD_METADATA_FILE}`, import.meta.url),
  ),
  customerTemplateKey: process.env.CUSTOMER_TEMPLATE_KEY,
});
