import { SCRIPT } from "@rz-chain-reporter/i18n";

import { imageTextLanguageInstruction } from "../image-assembler";

import type {
  MarketGenerationBrief,
  MarketGenerationFacts,
  MarketGenerationSeriesFact,
} from "./brief";

export type BriefPolicyRejection = {
  code:
    | "FACT_NOT_VERIFIED"
    | "LANGUAGE_MISMATCH"
    | "SCENE_NOT_APPROVED"
    | "TEXT_CHANGED";
  path: string;
};

const persian = /[\u0600-\u06ff]/u;

function normalized(value: string) {
  return value.trim().replace(/\s+/gu, " ");
}

export function normalizeAndValidateBrief(
  brief: MarketGenerationBrief,
  facts: MarketGenerationFacts,
) {
  const normalizedBrief: MarketGenerationBrief = {
    ...brief,
    backgroundScene: normalized(brief.backgroundScene),
    brandTranslation: normalized(brief.brandTranslation),
    chartTreatment: normalized(brief.chartTreatment),
    composition: normalized(brief.composition),
    factualClaims: brief.factualClaims.map(normalized),
    footerSafeArea: normalized(brief.footerSafeArea),
    headline: normalized(brief.headline),
    supportingText: normalized(brief.supportingText),
  };
  const rejections: BriefPolicyRejection[] = [];
  if (
    normalizedBrief.headline !== normalized(facts.headline) ||
    normalizedBrief.supportingText !== normalized(facts.supportingText)
  ) {
    rejections.push({ code: "TEXT_CHANGED", path: "headline" });
  }
  if (
    !facts.owner.profile.scenes.some(
      (scene) => normalized(scene) === normalizedBrief.backgroundScene,
    )
  ) {
    rejections.push({ code: "SCENE_NOT_APPROVED", path: "backgroundScene" });
  }
  const verified = new Set(facts.verifiedClaims.map(normalized));
  normalizedBrief.factualClaims.forEach((claim, index) => {
    if (!verified.has(claim)) {
      rejections.push({
        code: "FACT_NOT_VERIFIED",
        path: `factualClaims.${index}`,
      });
    }
  });
  const prose = `${normalizedBrief.headline} ${normalizedBrief.supportingText}`;
  if ((SCRIPT[facts.contentLocale] === "arab") !== persian.test(prose)) {
    rejections.push({ code: "LANGUAGE_MISMATCH", path: "headline" });
  }
  return { brief: normalizedBrief, rejections: rejections.slice(0, 12) };
}

function seriesLine(fact: MarketGenerationSeriesFact) {
  if (fact.status === "unavailable") {
    return `${fact.symbol} (${fact.displayName}, ${fact.role}): data unavailable, show no values for it`;
  }
  const color = fact.color ? `, line color ${fact.color}` : "";
  return `${fact.symbol} (${fact.displayName}, ${fact.role}${color}): ${fact.startValue} → ${fact.endValue}, ${fact.changePercent}`;
}

export function buildImagePrompt(
  brief: MarketGenerationBrief,
  facts: MarketGenerationFacts,
  operatorDirection: string,
) {
  const { owner, variant } = facts;
  const { direction } = variant;
  const { frozenStyle, theme } = owner.profile;
  const railPercent = Math.round(variant.footerRailHeightRatio * 100);
  const operator = operatorDirection.trim();
  return [
    `Create one finished ${facts.output.width}x${facts.output.height} premium financial market poster from exactly TWO ordered references.`,
    "REFERENCE 1 is the approved publishing sample and is binding for geometry only: match its camera, crop, device or card silhouette, chart aperture, information hierarchy, spacing, visual rhythm, lighting quality, and premium finish. Do not reinterpret it as a different layout or turn this family into another family.",
    "REFERENCE 1 is non-authoritative for content and for theme: never transcribe, reconstruct, infer, or reuse any sample ticker, asset name, price, percentage, date, chart line, legend, logo, domain, footer, headline, or claim, and do not keep its environment, palette, or atmosphere; the Visual Owner theme below replaces them.",
    "REFERENCE 2 is the authoritative approved factual chart. Use this exact complete chart nicely within the composition from REFERENCE 1. Do not use, copy, trace, or infer any chart, price, date, percentage, axis, legend, or coin identity from REFERENCE 1.",
    "Never invent, redraw, relabel, crop, smooth, distort, translate, or replace chart facts; Reference 2 stays complete and unchanged inside the protected chart area.",
    `TEMPLATE FAMILY: ${facts.family.displayName}. EXACT VARIANT: ${variant.displayName}.`,
    `Composition: ${direction.composition}`,
    `Geometry: ${direction.geometry}`,
    `Hierarchy: ${direction.hierarchy}`,
    `Typography: ${direction.typography}`,
    `Spacing: ${direction.spacing}`,
    `Materials: ${direction.materials}`,
    `Lighting: ${direction.lighting}`,
    `VISUAL OWNER: ${owner.name} (${owner.symbol}). Its theme owns the background, surfaces, palette, materials, and atmosphere; comparison assets keep their own line and marker colors but never control the theme.`,
    `Owner palette: background ${theme.background}, alternate background ${theme.backgroundAlt}, surface ${theme.surface}, alternate surface ${theme.surfaceAlt}, text ${theme.text}, muted text ${theme.muted}, positive ${theme.positive}, negative ${theme.negative}, accent ${theme.accent}, alternate accent ${theme.accentAlt}, border ${theme.border}.`,
    `Owner motifs: ${owner.profile.motifs.join(", ")}.`,
    `Owner art direction: ${owner.profile.artDirection}`,
    `Format: ${frozenStyle.format}`,
    `Palette language: ${frozenStyle.palette}`,
    `Owner materials: ${frozenStyle.materials}`,
    `Rendering: ${frozenStyle.rendering}`,
    `Background vocabulary: ${frozenStyle.backgroundVocab}`,
    `Headline zone: ${frozenStyle.headlineZone}`,
    `Never: ${frozenStyle.never}`,
    `SELECTED OWNER BACKGROUND SCENE: ${brief.backgroundScene} Build this scene as the poster environment while preserving the sample's scene placement, depth, and negative-space behavior; keep it clearly visible around the device or chart, never reduced to a flat field, plain gradient, or generic crypto wallpaper, and keep a quiet local area behind typography and the protected chart.`,
    `BRAND TRANSLATION: ${brief.brandTranslation}`,
    `COMPOSITION NOTES: ${brief.composition}`,
    `CHART INTEGRATION: ${brief.chartTreatment}`,
    `Headline, render exactly: ${facts.headline}`,
    `Supporting text, render exactly: ${facts.supportingText}`,
    imageTextLanguageInstruction(facts.contentLocale),
    "Tickers, symbols, numbers, and dates render exactly as supplied here and inside Reference 2; never translate, transliterate, or reformat them.",
    `VERIFIED SERIES (${facts.period}, ${facts.scale} scale): ${facts.series.map(seriesLine).join("; ")}.`,
    "FACT SOURCE FIREWALL: the only permitted market facts are the headline, the supporting text, the verified series above, and Reference 2. Any optional result label outside the chart must repeat one of those exact values; never add other numbers, dates, claims, assets, or disclaimers.",
    `FOOTER: Reserve the lowest ${railPercent}% of the canvas as a protected footer rail; every device, card, chart, result strip, label, price, and object ends above it. Keep the rail a seamless continuation of the surrounding artwork and leave its center completely empty: no card, strip, text, disclaimer, legal line, domain, logo, wordmark, icon, padlock, lock, shield, seal, badge, ornament, or change of surface. Do not draw any logo, wordmark, emblem, coin mark, verification icon, domain, or brand-footer text anywhere; the application places the official ${owner.name} brand mark in that empty center after generation. ${brief.footerSafeArea}`,
    "EXECUTION ORDER: first reproduce the Reference 1 composition and module proportions; second apply the Visual Owner theme, palette, materials, and selected background scene; third replace the sample headline and supporting text with the exact copy above; fourth replace the sample chart completely with Reference 2 in the same chart area; fifth keep any result labels outside the chart exact and sourced only from the verified series; sixth reserve the protected footer rail and leave its center empty; finally apply premium lighting and finish.",
    ...(operator ? [`Operator direction: ${operator}`] : []),
  ].join("\n");
}
