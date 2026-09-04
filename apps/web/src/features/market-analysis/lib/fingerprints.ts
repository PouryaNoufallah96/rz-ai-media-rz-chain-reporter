import "server-only";

import { createHash } from "node:crypto";
import type {
  ContentLocale,
  MarketChartSpec,
  NormalizedMarketRequest,
} from "@rz-chain-reporter/contracts";
import {
  materialMarketChartSpec,
  normalizeMarketChartSpec,
  renderContractVersion,
} from "@rz-chain-reporter/market-chart";

import { MARKET_FINAL_COMPOSITING_CONTRACT_VERSION } from "../constants";

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  return `{${Object.entries(value)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalize(entry)}`)
    .join(",")}}`;
}

export function hashPayload(value: unknown) {
  return createHash("sha256").update(canonicalize(value), "utf8").digest("hex");
}

export function marketRequestFingerprint(request: NormalizedMarketRequest) {
  return hashPayload(request);
}

export function chartFingerprint(input: {
  snapshotId: string;
  chartSpec: MarketChartSpec;
  contentLocale: ContentLocale;
  attribution: readonly string[];
}) {
  return hashPayload({
    snapshotId: input.snapshotId,
    chartSpec: materialMarketChartSpec(input.chartSpec),
    contentLocale: input.contentLocale,
    attribution: input.attribution,
    renderContractVersion,
  });
}

export function storyFingerprint(input: {
  chartFingerprint: string;
  headline: string;
  supportingText: string;
  contentLocale: ContentLocale;
}) {
  return hashPayload({
    chartFingerprint: input.chartFingerprint,
    headline: input.headline.normalize("NFC").trim(),
    supportingText: input.supportingText.normalize("NFC").trim(),
    contentLocale: input.contentLocale,
  });
}

export function designFingerprint(input: {
  storyFingerprint: string;
  familyKey: string;
  variantKey: string;
  outputFormat: string;
  templateFingerprint: string;
  instrumentProfileFingerprint: string;
}) {
  return hashPayload(input);
}

export function generationFingerprint(input: {
  designFingerprint: string;
  operatorDirection: string;
  imageOptionKey: string;
}) {
  return hashPayload(input);
}

export function finalFingerprint(input: {
  generationFingerprint: string;
  mediaAssetId: string;
  mediaChecksum: string;
}) {
  return hashPayload({
    ...input,
    compositingContractVersion: MARKET_FINAL_COMPOSITING_CONTRACT_VERSION,
  });
}

export { normalizeMarketChartSpec, renderContractVersion };
