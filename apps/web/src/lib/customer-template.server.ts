import "server-only";

import { resolve } from "node:path";
import type { RunConfigurationBounds } from "@rz-chain-reporter/contracts";
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

export const customerEditorial = {
  models: template.editorial.models,
  brands: template.mediaBrands.map((brand) => ({
    key: brand.key,
    name: brand.name,
    promoEnabled: brand.editorial.promoEnabled,
  })),
  platforms: template.editorial.platforms,
  defaults: template.editorial.defaults,
  bounds: {
    brandKeys: template.mediaBrands.map((brand) => brand.key),
    modelKeys: template.editorial.models.map((model) => model.key),
    platforms: template.editorial.platforms,
    selectionCap: template.editorial.selectionCap,
    shortlistCap: template.editorial.shortlistCap,
    promoPromptMaxChars: template.editorial.promo.promptMaxChars,
    semanticMaxChars: template.editorial.semantic.maxChars,
    semanticMaxTopics: template.editorial.semantic.maxTopics,
    fanOutMaxUnits: template.editorial.fanOut.maxUnits,
  } satisfies RunConfigurationBounds,
  thresholds: {
    policyScore: template.editorial.policy.thresholds.policyScore,
    semanticDedup: template.editorial.semantic.dedupThreshold,
    shortlistCap: template.editorial.shortlistCap,
    mediaFitByBrandKey: Object.fromEntries(
      template.mediaBrands.map((brand) => [
        brand.key,
        brand.editorial.mediaFitThreshold,
      ]),
    ),
  },
};
