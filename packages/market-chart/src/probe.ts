import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ContentLocale,
  MARKET_CHART_PRESET_IDS,
  MARKET_CHART_RENDER_CONTRACT_VERSION,
  type MarketChartRenderInput,
  marketChartSpecSchema,
  persistedMarketChartSpecSchema,
} from "@rz-chain-reporter/contracts";

import {
  applyMarketChartPreset,
  createMarketChartScene,
  materialMarketChartSpec,
  normalizeMarketChartSpec,
  renderMarketChartSvg,
} from "./index";

function checksum(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const spec = {
  schemaVersion: 2,
  presetId: "brand-dark",
  background: "#0F172A",
  seriesColors: {
    beta: "#A78BFA",
    alpha: "#22C55E",
    gamma: "#FBBF24",
  },
  legendPosition: "bottom",
  legendFormat: "symbol_change",
  lineWidth: 4,
  markers: "endpoints",
  gridStrength: "subtle",
} as const;

function fixture(contentLocale: ContentLocale): MarketChartRenderInput {
  return {
    renderContractVersion: MARKET_CHART_RENDER_CONTRACT_VERSION,
    contentLocale,
    outputFormat: "square",
    dimensions: { width: 1080, height: 1080 },
    snapshot: {
      id: "11111111-1111-4111-8111-111111111111",
      checksum: "a".repeat(64),
      period: "7d",
      scale: "relative",
      effectiveWindowStart: "2026-08-01T00:00:00.000Z",
      effectiveWindowEnd: "2026-08-07T00:00:00.000Z",
      series: [
        {
          outcome: "succeeded",
          id: "alpha",
          label: contentLocale === "fa" ? "دارایی آلفا" : "Alpha Asset",
          symbol: "ALPHA",
          role: "primary",
          points: [
            ["2026-08-01T00:00:00.000Z", "10"],
            ["2026-08-02T00:00:00.000Z", "11"],
            ["2026-08-03T00:00:00.000Z", "10.5"],
            ["2026-08-06T00:00:00.000Z", "13"],
            ["2026-08-07T00:00:00.000Z", "12.75"],
          ],
          changePercent: "27.5",
          warnings: ["sparse"],
          attributionIdentity: "fixture-feed",
        },
        {
          outcome: "succeeded",
          id: "beta",
          label: contentLocale === "fa" ? "دارایی بتا" : "Beta Asset",
          symbol: "BETA",
          role: "comparison",
          points: [
            ["2026-08-01T00:00:00.000Z", "20"],
            ["2026-08-02T00:00:00.000Z", "19"],
            ["2026-08-03T00:00:00.000Z", "21"],
            ["2026-08-04T00:00:00.000Z", "22"],
            ["2026-08-07T00:00:00.000Z", "23"],
          ],
          changePercent: "15",
          warnings: [],
          attributionIdentity: "fixture-feed",
        },
        {
          outcome: "failed",
          id: "gamma",
          label: contentLocale === "fa" ? "دارایی گاما" : "Gamma Asset",
          symbol: "GAMMA",
          role: "comparison",
          warnings: ["provider unavailable"],
          failureCode: "MARKET_PROVIDER_UNAVAILABLE",
        },
      ],
    },
    spec,
    attribution: [
      {
        required: true,
        chartLevel: true,
        identity: "fixture-feed",
        text: "Data: Fixture Feed",
        hyperlinkRequired: false,
      },
    ],
  };
}

const normalized = normalizeMarketChartSpec(spec);
assert.deepEqual(Object.keys(normalized.seriesColors), [
  "alpha",
  "beta",
  "gamma",
]);
assert.equal(normalized.background, "#0f172a");
assert.equal("presetId" in materialMarketChartSpec(spec), false);
assert.deepEqual(
  materialMarketChartSpec({ ...spec, presetId: "custom" }),
  materialMarketChartSpec(spec),
);

const legacy = persistedMarketChartSpecSchema.parse({
  ...spec,
  schemaVersion: 1,
  legendFormat: "label_change",
  markers: true,
});
assert.equal(legacy.schemaVersion, 2);
assert.equal(legacy.presetId, "custom");
assert.equal(legacy.legendFormat, "symbol_change");
assert.equal(legacy.markers, "all");

const cleanLight = applyMarketChartPreset(spec, "clean-light", [
  "alpha",
  "beta",
]);
const highContrast = applyMarketChartPreset(spec, "high-contrast", [
  "alpha",
  "beta",
]);
assert.notDeepEqual(
  materialMarketChartSpec(cleanLight),
  materialMarketChartSpec(highContrast),
);
for (const presetId of MARKET_CHART_PRESET_IDS) {
  const preset = applyMarketChartPreset(spec, presetId, [
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
  ]);
  assert.equal(marketChartSpecSchema.safeParse(preset).success, true);
}
assert.equal(
  marketChartSpecSchema.safeParse({
    ...cleanLight,
    seriesColors: { alpha: "#1d4ed8", beta: "#1D4ED8" },
  }).success,
  false,
);
assert.equal(
  marketChartSpecSchema.safeParse({
    ...cleanLight,
    seriesColors: { ...cleanLight.seriesColors, alpha: "#fefefe" },
  }).success,
  false,
);

const enScene = createMarketChartScene(fixture("en"));
const faScene = createMarketChartScene(fixture("fa"));
assert.equal(enScene.direction, "ltr");
assert.equal(faScene.direction, "rtl");
assert.equal(enScene.series[0]?.segments.length, 2);
assert.equal(enScene.series[1]?.segments.length, 2);
assert.equal(enScene.failedSeries.length, 1);
assert.equal(enScene.series[0]?.interaction.length, 5);
assert.equal(enScene.series[0]?.markers.length, 2);
assert.equal(enScene.attribution?.entries.length, 1);

for (const legendPosition of [
  "top",
  "bottom",
  "left",
  "right",
  "overlay-top-right",
  "overlay-bottom-right",
] as const) {
  const scene = createMarketChartScene({
    ...fixture("en"),
    spec: { ...spec, legendPosition },
  });
  assert.equal(scene.legend.position, legendPosition);
  if (legendPosition === "top") {
    assert.ok(scene.legend.y + scene.legend.height <= scene.plot.y);
  }
  if (legendPosition === "bottom") {
    assert.ok(scene.legend.y >= scene.plot.y + scene.plot.height);
  }
  if (legendPosition === "left") {
    assert.ok(scene.legend.x + scene.legend.width <= scene.plot.x);
  }
  if (legendPosition === "right") {
    assert.ok(scene.legend.x >= scene.plot.x + scene.plot.width);
  }
  if (legendPosition.startsWith("overlay-")) {
    assert.equal(scene.legend.layout, "overlay");
    assert.ok(scene.legend.x >= scene.plot.x);
    assert.ok(scene.legend.y >= scene.plot.y);
    assert.ok(
      scene.legend.x + scene.legend.width <= scene.plot.x + scene.plot.width,
    );
    assert.ok(
      scene.legend.y + scene.legend.height <= scene.plot.y + scene.plot.height,
    );
  }
}

const allMarkersScene = createMarketChartScene({
  ...fixture("en"),
  spec: { ...spec, markers: "all" },
});
assert.equal(allMarkersScene.series[0]?.markers.length, 5);
const noMarkersScene = createMarketChartScene({
  ...fixture("en"),
  spec: { ...spec, markers: "none" },
});
assert.equal(noMarkersScene.series[0]?.markers.length, 0);

const enSvg = renderMarketChartSvg(fixture("en"));
const faSvg = renderMarketChartSvg(fixture("fa"));
assert.match(enSvg, /^<svg[^>]+>/u);
assert.match(faSvg, /[\u06f0-\u06f9]/u);
assert.doesNotMatch(enSvg, /<script|foreignObject|onload=/u);
assert.doesNotMatch(faSvg, /<script|foreignObject|onload=/u);

const normalizedChecksum = checksum(JSON.stringify(normalized));
const sceneChecksum = checksum(JSON.stringify(enScene));
const enSvgChecksum = checksum(enSvg);
const faSvgChecksum = checksum(faSvg);

process.stdout.write(
  `market-chart normalized=${normalizedChecksum} scene=${sceneChecksum} en-svg=${enSvgChecksum} fa-svg=${faSvgChecksum} gaps=pass intl=pass escape=pass\n`,
);

assert.equal(
  normalizedChecksum,
  "ebc6348bf73a105f6f64c24e603ff472fca868eba717fd129e9f37a60619615c",
);
assert.equal(
  sceneChecksum,
  "df9ddedc03a66b788ff7d073359c58e5252428ba3afbaad4a5f49fbf1b999db3",
);
assert.equal(
  enSvgChecksum,
  "660fb9868506ad2243bcfd3bec02339a4a237144361feaf91a548093930b534e",
);
assert.equal(
  faSvgChecksum,
  "895de3988ce58de2c2203c2fa8767f959dc5b8c6b81ca41df259ec043d9e851c",
);

const outputDirectory = process.env.MARKET_CHART_PROBE_OUTPUT_DIR;
if (outputDirectory) {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(join(outputDirectory, "market-chart-en.svg"), enSvg);
  writeFileSync(join(outputDirectory, "market-chart-fa.svg"), faSvg);
}
