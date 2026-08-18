import "server-only";

import { resolve } from "node:path";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import { env } from "@rz-chain-reporter/env/server";

// Build, start, and standalone all cwd at apps/web; the artifact root is ../..
const artifactRoot = resolve(process.cwd(), "../..");

const { fingerprint, template } = loadCustomerTemplate(
  artifactRoot,
  env.CUSTOMER_TEMPLATE_KEY,
);

export const customerTemplateFingerprint = fingerprint;

export const customerProductName = template.customer.productName;
