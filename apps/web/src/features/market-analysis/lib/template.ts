import "server-only";

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  MARKET_CHART_MIN_COLOR_CONTRAST,
  marketChartColorContrast,
  persistedMarketChartSpecSchema,
} from "@rz-chain-reporter/contracts";
import {
  marketCompositionCatalogSchema,
  marketInstrumentProfileSchema,
} from "@rz-chain-reporter/customer-template/schema";
import { MARKET_CHART_PRESETS } from "@rz-chain-reporter/market-chart";

import {
  customerRoot,
  customerTemplate,
  customerTemplateFingerprint,
  readStaticRasterAsset,
} from "@/lib/customer-template.server";

import { hashPayload, normalizeMarketChartSpec } from "./fingerprints";

function readJson(path: string) {
  return JSON.parse(readFileSync(resolve(customerRoot, path), "utf8"));
}

export const marketTemplate = customerTemplate.marketAnalysis;
export const marketCompositionCatalog = marketTemplate.enabled
  ? marketCompositionCatalogSchema.parse(readJson(marketTemplate.compositions))
  : { schemaVersion: 1 as const, families: [] };

export function readMarketCompositionSample(
  familyKey: string,
  variantKey: string,
) {
  if (!marketTemplate.enabled) return null;
  const family = marketCompositionCatalog.families.find(
    (candidate) => candidate.enabled && candidate.key === familyKey,
  );
  const variant = family?.variants.find(
    (candidate) => candidate.enabled && candidate.key === variantKey,
  );
  return variant ? readStaticRasterAsset(variant.sample) : null;
}

export function readMarketInstrumentSelectorIcon(instrumentKey: string) {
  const instrument = marketInstrumentTemplate(instrumentKey);
  return instrument ? readStaticRasterAsset(instrument.selectorIcon) : null;
}

export function marketBrandKeyForInstrument(instrumentKey: string) {
  if (!marketTemplate.enabled) return null;
  return (
    marketTemplate.brandInstruments.find(
      (mapping) => mapping.instrumentKey === instrumentKey,
    )?.brandKey ?? null
  );
}

export function marketInstrumentTemplate(key: string) {
  if (!marketTemplate.enabled) return undefined;
  return marketTemplate.instruments.find(
    (instrument) => instrument.enabled && instrument.key === key,
  );
}

export function marketInstrumentProfile(key: string) {
  const instrument = marketInstrumentTemplate(key);
  if (!instrument) return null;
  const profile = marketInstrumentProfileSchema.parse(
    readJson(instrument.visualProfile),
  );
  return {
    profile,
    fingerprint: hashPayload({
      customerTemplateFingerprint,
      instrumentKey: instrument.key,
      profile,
    }),
  };
}

export function defaultChartSpec(
  instrumentKey: string,
  descriptorIdentities: readonly string[],
) {
  const loaded = marketInstrumentProfile(instrumentKey);
  if (!loaded) return null;
  const background = loaded.profile.theme.background;
  const darkBackground = marketChartColorContrast(background, "#ffffff") >= 4.5;
  const candidates = [
    loaded.profile.defaultChartColor,
    loaded.profile.theme.accentAlt,
    loaded.profile.theme.positive,
    loaded.profile.theme.negative,
    loaded.profile.theme.accent,
    loaded.profile.theme.muted,
    ...(darkBackground
      ? MARKET_CHART_PRESETS["brand-dark"].colors
      : MARKET_CHART_PRESETS["color-blind-safe"].colors),
    ...(darkBackground
      ? MARKET_CHART_PRESETS["high-contrast"].colors
      : MARKET_CHART_PRESETS["clean-light"].colors),
  ];
  const colors: string[] = [];
  const seen = new Set<string>();
  for (const color of candidates) {
    const normalized = color.toLowerCase();
    if (
      seen.has(normalized) ||
      marketChartColorContrast(color, background) <
        MARKET_CHART_MIN_COLOR_CONTRAST
    ) {
      continue;
    }
    seen.add(normalized);
    colors.push(color);
  }
  if (colors.length < descriptorIdentities.length) return null;
  return {
    chartSpec: normalizeMarketChartSpec({
      schemaVersion: 2,
      presetId: "custom",
      background,
      seriesColors: Object.fromEntries(
        descriptorIdentities.map((identity, index) => [
          identity,
          colors[index % colors.length] ?? loaded.profile.defaultChartColor,
        ]),
      ),
      legendPosition: "bottom",
      legendFormat: "symbol_change",
      lineWidth: 4,
      markers: "endpoints",
      gridStrength: "subtle",
    }),
    profileFingerprint: loaded.fingerprint,
  };
}

export function initialChartSpec(
  instrumentKey: string,
  descriptorIdentities: readonly string[],
  savedChartSpec: unknown,
) {
  const template = defaultChartSpec(instrumentKey, descriptorIdentities);
  if (!template) return null;
  const saved = persistedMarketChartSpecSchema.safeParse(savedChartSpec);
  if (!saved.success) return template;
  const merged = {
    ...saved.data,
    seriesColors: Object.fromEntries(
      descriptorIdentities.flatMap((identity) => {
        const color =
          saved.data.seriesColors[identity] ??
          template.chartSpec.seriesColors[identity];
        return color ? [[identity, color]] : [];
      }),
    ),
  };
  try {
    return { ...template, chartSpec: normalizeMarketChartSpec(merged) };
  } catch {
    return template;
  }
}

export function requireMarketTemplate() {
  if (!marketTemplate.enabled) {
    throw new Error("MARKET_ANALYSIS_DISABLED");
  }
  return marketTemplate;
}
