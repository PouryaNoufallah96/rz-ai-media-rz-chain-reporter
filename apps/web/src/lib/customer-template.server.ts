import "server-only";

import { resolve } from "node:path";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import { env } from "@rz-chain-reporter/env/server";

// Build, start, and standalone all cwd at apps/web; the artifact root is ../..
const artifactRoot = resolve(process.cwd(), "../..");

const { fingerprint, references, template } = loadCustomerTemplate(
  artifactRoot,
  env.CUSTOMER_TEMPLATE_KEY,
);

export const customerTemplateFingerprint = fingerprint;

export const customerProductName = template.customer.productName;

export const customerTimeZone = template.customer.timeZone;

const referenceByPath = new Map(
  references.map((reference) => [reference.path, reference]),
);

function referenceOf(path: string | undefined) {
  return path ? (referenceByPath.get(path) ?? null) : null;
}

export const customerBrandPolicy = template.mediaBrands.map((brand) => ({
  key: brand.key,
  name: brand.name,
  brandBible: referenceOf(brand.brandBible),
  imageProfile: referenceOf(brand.imageProfile),
}));

export const customerAcquisition = {
  defaultWindowHours: template.acquisition.defaultWindowHours,
  maxItemsPerSource: template.acquisition.maxItemsPerSource,
  orderingMode: template.acquisition.telegram.orderingMode,
  topN: template.acquisition.telegram.topN,
  enrichmentEnabled: template.enrichment.enabled,
};
