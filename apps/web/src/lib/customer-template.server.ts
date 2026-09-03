import "server-only";

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import {
  modelVendor,
  type RunConfigurationBounds,
} from "@rz-chain-reporter/contracts";
import { computeBrandPolicyFingerprint } from "@rz-chain-reporter/customer-template/fingerprint";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import { env } from "@rz-chain-reporter/env/server";

// Build, start, and standalone all cwd at apps/web; the artifact root is ../..
const artifactRoot = resolve(process.cwd(), "../..");

const { fingerprint, references, reviewedKnowledge, template } =
  loadCustomerTemplate(artifactRoot, env.CUSTOMER_TEMPLATE_KEY);

export const customerRoot = resolve(
  artifactRoot,
  "customer-templates",
  env.CUSTOMER_TEMPLATE_KEY,
);

type StaticRasterAsset = {
  path: string;
  mimeType: "image/png";
  byteLength: number;
  sha256: string;
};

export function readStaticRasterAsset(asset: StaticRasterAsset) {
  const assetPath = resolve(customerRoot, asset.path);
  const boundedPath = relative(customerRoot, assetPath);
  if (
    boundedPath === "" ||
    boundedPath === ".." ||
    boundedPath.startsWith(`..${sep}`) ||
    resolve(customerRoot, boundedPath) !== assetPath
  ) {
    return null;
  }
  let bytes: Buffer;
  try {
    bytes = readFileSync(assetPath);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  if (
    bytes.byteLength !== asset.byteLength ||
    createHash("sha256").update(bytes).digest("hex") !== asset.sha256
  ) {
    return null;
  }
  return { bytes, mimeType: asset.mimeType };
}

const market = template.marketAnalysis;
const instrumentByBrand = new Map(
  market.enabled
    ? market.brandInstruments.flatMap(({ brandKey, instrumentKey }) => {
        const instrument = market.instruments.find(
          (entry) => entry.enabled && entry.key === instrumentKey,
        );
        return instrument ? [[brandKey, instrument] as const] : [];
      })
    : [],
);

function brandLogoOf(brand: (typeof template.mediaBrands)[number]) {
  const instrument = instrumentByBrand.get(brand.key);
  if (instrument) {
    return {
      url: `/api/market-analysis-instruments/${encodeURIComponent(instrument.key)}/icon`,
      width: instrument.selectorIcon.pixelWidth,
      height: instrument.selectorIcon.pixelHeight,
    };
  }
  return brand.brandLogo
    ? {
        url: `/api/media-brands/${encodeURIComponent(brand.key)}/logo`,
        width: brand.brandLogo.pixelWidth,
        height: brand.brandLogo.pixelHeight,
      }
    : null;
}

export function readMediaBrandLogo(brandKey: string) {
  const brand = template.mediaBrands.find((entry) => entry.key === brandKey);
  return brand?.brandLogo ? readStaticRasterAsset(brand.brandLogo) : null;
}

export const customerTemplateFingerprint = fingerprint;

export const customerProductName = template.customer.productName;

export const customerReviewedKnowledge = reviewedKnowledge;

export const customerTemplate = template;

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
  logo: brandLogoOf(brand),
  brandBible: referenceOf(brand.brandBible),
  imageProfile: referenceOf(brand.imageProfile),
  brandLogo: referenceOf(brand.brandLogo?.path),
}));

export const customerBrandPolicyFingerprints = new Map(
  template.mediaBrands.map((brand) => [
    brand.key,
    computeBrandPolicyFingerprint(brand.editorial),
  ]),
);

export const customerAcquisition = {
  defaultWindowHours: template.acquisition.defaultWindowHours,
  maxItemsPerSource: template.acquisition.maxItemsPerSource,
  orderingMode: template.acquisition.telegram.orderingMode,
  topN: template.acquisition.telegram.topN,
  enrichmentEnabled: template.enrichment.enabled,
};

const modelTasks = template.models.tasks;

export const customerEditorial = {
  models: template.editorial.models.map(({ key, name }) => ({
    key,
    name,
    vendor: modelVendor(modelTasks[`copy-generation:${key}`]?.model),
  })),
  brands: template.mediaBrands.map((brand) => ({
    key: brand.key,
    name: brand.name,
    logo: brandLogoOf(brand),
    promoEnabled: brand.editorial.promoEnabled,
  })),
  platforms: template.editorial.platforms,
  drafting: template.editorial.drafting,
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
    lexicalTopicScore: template.editorial.policy.thresholds.lexicalTopicScore,
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

export const enabledImageModels =
  customerEditorial.drafting.image.models.flatMap(({ enabled, key, name }) =>
    enabled
      ? [
          {
            key,
            name,
            vendor: modelVendor(modelTasks[`image-generation:${key}`]?.model),
          },
        ]
      : [],
  );
