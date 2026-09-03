import { z } from "zod";

import {
  marketOutputFormatSchema,
  marketPeriodSchema,
  marketScaleSchema,
} from "./market";
import { contentLocaleSchema } from "./source";

export const MARKET_CHART_SPEC_SCHEMA_VERSION = 2;
export const MARKET_CHART_RENDER_CONTRACT_VERSION =
  "market-chart-v2-sharp-0.35.4-vips-8.18.6-rsvg-2.62.91-geist-1.5.1-vazirmatn-33.003";

export const MARKET_CHART_PRESET_IDS = [
  "clean-light",
  "brand-dark",
  "high-contrast",
  "color-blind-safe",
] as const;
export const marketChartPresetIdSchema = z.enum(MARKET_CHART_PRESET_IDS);
export type MarketChartPresetId = z.infer<typeof marketChartPresetIdSchema>;

export const MARKET_CHART_LEGEND_POSITIONS = [
  "top",
  "bottom",
  "left",
  "right",
  "overlay-top-right",
  "overlay-bottom-right",
] as const;
export const marketChartLegendPositionSchema = z.enum(
  MARKET_CHART_LEGEND_POSITIONS,
);

export const MARKET_CHART_LEGEND_FORMATS = [
  "symbol_only",
  "symbol_change",
] as const;
export const marketChartLegendFormatSchema = z.enum(
  MARKET_CHART_LEGEND_FORMATS,
);

export const MARKET_CHART_MARKERS = ["none", "endpoints", "all"] as const;
export const marketChartMarkersSchema = z.enum(MARKET_CHART_MARKERS);

export const MARKET_CHART_GRID_STRENGTHS = [
  "none",
  "subtle",
  "standard",
] as const;
export const marketChartGridStrengthSchema = z.enum(
  MARKET_CHART_GRID_STRENGTHS,
);

export const MARKET_CHART_LINE_WIDTHS = [2, 4, 6] as const;
export const MARKET_CHART_MIN_COLOR_CONTRAST = 3;

const hexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/u);
const boundedLabelSchema = z.string().trim().min(1).max(160);

function rgb(hex: string) {
  return [1, 3, 5].map((offset) =>
    Number.parseInt(hex.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

function luminance(hex: string) {
  const converted = rgb(hex).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (converted[0] ?? 0) +
    0.7152 * (converted[1] ?? 0) +
    0.0722 * (converted[2] ?? 0)
  );
}

export function marketChartColorContrast(left: string, right: string) {
  const high = Math.max(luminance(left), luminance(right));
  const low = Math.min(luminance(left), luminance(right));
  return (high + 0.05) / (low + 0.05);
}

export const marketChartSpecShapeSchema = z.strictObject({
  schemaVersion: z.literal(MARKET_CHART_SPEC_SCHEMA_VERSION),
  presetId: z.string().trim().min(1).max(80),
  background: hexColorSchema,
  seriesColors: z.record(boundedLabelSchema, hexColorSchema),
  legendPosition: marketChartLegendPositionSchema,
  legendFormat: marketChartLegendFormatSchema,
  lineWidth: z.union([z.literal(2), z.literal(4), z.literal(6)]),
  markers: marketChartMarkersSchema,
  gridStrength: marketChartGridStrengthSchema,
});

export const marketChartSpecSchema = marketChartSpecShapeSchema.superRefine(
  (spec, context) => {
    const entries = Object.entries(spec.seriesColors);
    const seen = new Set<string>();
    for (const [identity, color] of entries) {
      const normalized = color.toLowerCase();
      if (seen.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: "market_chart_series_color_duplicate",
          path: ["seriesColors", identity],
        });
      }
      seen.add(normalized);
      if (
        marketChartColorContrast(color, spec.background) <
        MARKET_CHART_MIN_COLOR_CONTRAST
      ) {
        context.addIssue({
          code: "custom",
          message: "market_chart_series_color_contrast",
          path: ["seriesColors", identity],
        });
      }
    }
  },
);

export type MarketChartSpec = z.infer<typeof marketChartSpecSchema>;

const legacyMarketChartSpecSchema = z.strictObject({
  schemaVersion: z.literal(1),
  presetId: z.string().trim().min(1).max(80),
  background: hexColorSchema,
  seriesColors: z.record(boundedLabelSchema, hexColorSchema),
  legendPosition: z.enum(["top", "bottom", "right"]),
  legendFormat: z.enum(["label", "label_change", "label_value"]),
  lineWidth: z.union([z.literal(2), z.literal(4), z.literal(6)]),
  markers: z.boolean(),
  gridStrength: marketChartGridStrengthSchema,
});

export const persistedMarketChartSpecSchema = z
  .union([marketChartSpecSchema, legacyMarketChartSpecSchema])
  .transform((spec): MarketChartSpec => {
    if (spec.schemaVersion === MARKET_CHART_SPEC_SCHEMA_VERSION) return spec;
    return {
      ...spec,
      schemaVersion: MARKET_CHART_SPEC_SCHEMA_VERSION,
      presetId: "custom",
      legendFormat:
        spec.legendFormat === "label_change" ? "symbol_change" : "symbol_only",
      markers: spec.markers ? "all" : "none",
    };
  })
  .pipe(marketChartSpecSchema);

export const marketChartPointSchema = z.tuple([
  z.iso.datetime({ offset: true }),
  z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u),
]);

export const marketChartSeriesSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("succeeded"),
    id: boundedLabelSchema,
    label: boundedLabelSchema,
    symbol: boundedLabelSchema,
    role: z.enum(["primary", "comparison"]),
    points: z.array(marketChartPointSchema).min(2).max(10_000),
    changePercent: z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/u),
    warnings: z.array(z.string().trim().min(1).max(160)).max(32),
    attributionIdentity: boundedLabelSchema.nullable(),
  }),
  z.strictObject({
    outcome: z.literal("failed"),
    id: boundedLabelSchema,
    label: boundedLabelSchema,
    symbol: boundedLabelSchema,
    role: z.enum(["primary", "comparison"]),
    warnings: z.array(z.string().trim().min(1).max(160)).max(32),
    failureCode: z.string().trim().min(1).max(80),
  }),
]);

export const marketChartAttributionProfileSchema = z.strictObject({
  required: z.boolean(),
  chartLevel: z.boolean(),
  identity: boundedLabelSchema,
  text: z.string().trim().min(1).max(240),
  hyperlinkRequired: z.boolean(),
  href: z.url().optional(),
});

export const marketChartRenderInputSchema = z.strictObject({
  renderContractVersion: z.literal(MARKET_CHART_RENDER_CONTRACT_VERSION),
  contentLocale: contentLocaleSchema,
  outputFormat: marketOutputFormatSchema,
  dimensions: z.strictObject({
    width: z.int().min(640).max(4096),
    height: z.int().min(640).max(4096),
  }),
  snapshot: z.strictObject({
    id: z.uuid(),
    checksum: z.string().regex(/^[0-9a-f]{64}$/u),
    period: marketPeriodSchema,
    scale: marketScaleSchema,
    effectiveWindowStart: z.iso.datetime({ offset: true }),
    effectiveWindowEnd: z.iso.datetime({ offset: true }),
    series: z.array(marketChartSeriesSchema).min(1).max(6),
  }),
  spec: marketChartSpecSchema,
  attribution: z.array(marketChartAttributionProfileSchema).max(6),
});

export type MarketChartRenderInput = z.infer<
  typeof marketChartRenderInputSchema
>;

export const MARKET_CHART_OUTPUT_DIMENSIONS = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
  landscape: { width: 1600, height: 900 },
} as const;
