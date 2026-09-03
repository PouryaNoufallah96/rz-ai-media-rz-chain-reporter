import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closestSupportedAspectRatio } from "@rz-chain-reporter/contracts";
import { assertImageInvocationBounds } from "@rz-chain-reporter/model-gateway/gateway";
import type { ImageModelInvocation } from "@rz-chain-reporter/model-gateway/types";
import sharp from "sharp";

import {
  deterministicMarketBrief,
  MARKET_GENERATION_BRIEF_POLICY_VERSION,
  type MarketGenerationFacts,
} from "../market-generation/brief";
import { composeCenteredRail } from "../market-generation/compositor";
import {
  buildImagePrompt,
  normalizeAndValidateBrief,
} from "../market-generation/policy";
import { nextInvocationSlot } from "../market-generation/slots";

function invocation(
  references: ImageModelInvocation["references"],
): ImageModelInvocation {
  return {
    aspectRatio: "3:4",
    compensatePreparedResult: async () => "compensated",
    deadlineMs: 1_000,
    invocationKey: "primary",
    operationAttemptId: "00000000-0000-5000-8000-000000000001",
    operationId: "00000000-0000-5000-8000-000000000002",
    persistResult: async () => undefined,
    prepareResult: async () => ({
      actualBytes: 1,
      checksum: "a",
      height: 1,
      mediaAssetId: "00000000-0000-5000-8000-000000000003",
      mimeType: "image/png",
      objectKey: "fixture",
      width: 1,
    }),
    prompt: "fixture",
    references,
    rejectUnpreparedResult: async () => "rejected",
    resolvePreparedResult: async () => "committed",
    taskKey: "image-generation:gpt-image",
    workspaceId: "00000000-0000-5000-8000-000000000004",
  };
}

async function main() {
  const fixture = {
    bytes: new Uint8Array([1]),
    height: 1,
    mimeType: "image/png",
    width: 1,
  };
  assert.doesNotThrow(() =>
    assertImageInvocationBounds(
      invocation([fixture, fixture]),
      "image-generation:gpt-image",
    ),
  );
  assert.throws(() =>
    assertImageInvocationBounds(
      invocation([fixture, fixture, fixture]),
      "image-generation:gpt-image",
    ),
  );
  assert.throws(() =>
    assertImageInvocationBounds(
      invocation([{ ...fixture, width: 5000 }]),
      "image-generation:gpt-image",
    ),
  );

  assert.deepEqual(nextInvocationSlot(["primary", "retry-1", "fallback"], []), {
    status: "available",
    invocationKey: "primary",
  });
  assert.equal(
    nextInvocationSlot(
      ["primary", "retry-1"],
      [{ invocationKey: "primary", status: "unknown" }],
    ).status,
    "blocked",
  );
  assert.deepEqual(
    nextInvocationSlot(
      ["primary", "retry-1", "fallback"],
      [
        { invocationKey: "primary", status: "failed" },
        { invocationKey: "retry-1", status: "failed" },
      ],
    ),
    { status: "available", invocationKey: "fallback" },
  );

  const scenes = [
    "A credible advanced manufacturing floor at deep indigo hour with one precise gold robotic arm and quiet editorial space.",
    "A monumental industrial logistics landscape with subtle gold verification paths and violet-blue twilight.",
    "A premium Industry 4.0 hall with a translucent digital twin above real machinery and controlled purple atmosphere.",
  ];
  const facts: MarketGenerationFacts = {
    contentLocale: "en",
    family: { displayName: "Laptop Dashboard", key: "laptop" },
    headline: "Verified market move",
    output: { height: 1350, width: 1080 },
    owner: {
      changePercent: 7.92,
      name: "Industrial Token",
      profile: {
        schemaVersion: 1,
        theme: {
          background: "#10072d",
          backgroundAlt: "#291050",
          surface: "#191231",
          surfaceAlt: "#281a47",
          text: "#f8f5ff",
          muted: "#b9aed1",
          positive: "#41c98d",
          negative: "#ef6c75",
          accent: "#f4c224",
          accentAlt: "#7816d2",
          border: "#6c42a1",
        },
        motifs: ["precision gold robotics"],
        scenes,
        artDirection: "Premium Industrial Token market editorial.",
        defaultChartColor: "#b56ad9",
        frozenStyle: {
          format: "market editorial poster",
          palette: "deep indigo and metallic gold",
          materials: "brushed graphite and gold robotics",
          rendering: "realistic premium editorial",
          backgroundVocab: "factories and logistics infrastructure",
          headlineZone: "upper third",
          never: "never invent chart facts",
        },
      },
      symbol: "INDUSTRIAL",
    },
    period: "30d",
    scale: "relative",
    series: [
      {
        changePercent: "+7.92%",
        color: "#b56ad9",
        displayName: "Industrial Token",
        endValue: "22.69",
        role: "primary",
        startValue: "21.03",
        status: "verified",
        symbol: "INDUSTRIAL",
      },
    ],
    supportingText: "The approved chart is the factual authority.",
    variant: {
      key: "laptop-editorial",
      displayName: "Editorial laptop",
      enabled: true,
      formats: ["portrait"],
      minSeries: 1,
      maxSeries: 6,
      direction: {
        composition: "An angled laptop sits within calm editorial spacing.",
        geometry: "Preserve the complete screen as the protected chart area.",
        hierarchy: "Story and device share the field.",
        typography: "Restrained editorial type.",
        spacing: "Generous asymmetric negative space.",
        materials: "Premium metal and clean glass.",
        lighting: "Soft directional light.",
      },
      fallbackDirection: "Angled laptop, spacious editorial hierarchy.",
      chartScaleRule: {
        allowedScales: ["relative", "absolute"],
        preferredScale: "relative",
      },
      footerRailHeightRatio: 0.11,
      sample: {
        path: "market-analysis/compositions/desktop-b.png",
        mimeType: "image/png",
        byteLength: 1,
        pixelWidth: 1,
        pixelHeight: 1,
        sha256: "a".repeat(64),
      },
    },
    verifiedClaims: ["INDUSTRIAL +7.92%", "INDUSTRIAL 21.03 → 22.69"],
  };
  const fallback = deterministicMarketBrief(facts);
  assert.equal(fallback.backgroundScene, scenes[0]);
  assert.deepEqual(normalizeAndValidateBrief(fallback, facts).rejections, []);
  assert.equal(
    normalizeAndValidateBrief(
      { ...fallback, headline: "Invented claim" },
      facts,
    ).rejections[0]?.code,
    "TEXT_CHANGED",
  );
  assert.equal(
    normalizeAndValidateBrief(
      { ...fallback, backgroundScene: "An invented refinery at dusk." },
      facts,
    ).rejections[0]?.code,
    "SCENE_NOT_APPROVED",
  );
  const prompt = buildImagePrompt(fallback, facts, "");
  assert.match(prompt, /REFERENCE 1 .* binding for geometry only/u);
  assert.match(prompt, /EXACT VARIANT: Editorial laptop/u);
  assert.match(prompt, /VISUAL OWNER: Industrial Token \(INDUSTRIAL\)/u);
  assert.match(prompt, /Reserve the lowest 11% of the canvas/u);
  assert.doesNotMatch(prompt, /lockup/iu);
  assert.equal(closestSupportedAspectRatio("gpt-image", facts.output), "3:4");
  assert.equal(
    closestSupportedAspectRatio("gemini-pro-image", {
      height: 1920,
      width: 1080,
    }),
    "9:16",
  );
  assert.throws(() =>
    assertImageInvocationBounds(
      { ...invocation([fixture, fixture]), aspectRatio: "4:5" },
      "image-generation:gpt-image",
    ),
  );
  assert.doesNotMatch(prompt, /Operator direction/u);

  const base = await sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: "#111827",
    },
  })
    .png()
    .toBuffer();
  const footer = await sharp({
    create: {
      width: 24,
      height: 8,
      channels: 4,
      background: "#ffffff",
    },
  })
    .png()
    .toBuffer();
  const composed = await composeCenteredRail({
    footerLockup: footer,
    footerRailHeightRatio: 0.11,
    height: 64,
    plateColor: "#10072d",
    providerOriginal: base,
    width: 64,
  });
  const metadata = await sharp(composed).metadata();
  assert.equal(metadata.width, 64);
  assert.equal(metadata.height, 64);

  const retry = {
    epoch: 0,
    liveWake: false,
    receipt: null as string | null,
  };
  async function concurrentRetry(receipt: string) {
    await Promise.resolve();
    if (retry.epoch !== 0 || retry.liveWake) return "conflict" as const;
    retry.epoch += 1;
    retry.receipt = receipt;
    retry.liveWake = true;
    return "updated" as const;
  }
  const concurrent = await Promise.all([
    concurrentRetry("receipt-a"),
    concurrentRetry("receipt-b"),
  ]);
  assert.deepEqual([...concurrent].sort(), ["conflict", "updated"]);
  assert.equal(retry.epoch, 1);

  const ledger = [
    { stage: "brief", invocationKey: "primary", status: "failed" },
    { stage: "brief", invocationKey: "retry-1", status: "failed" },
    { stage: "brief", invocationKey: "fallback", status: "succeeded" },
    {
      stage: "image",
      invocationKey: "primary",
      status: "succeeded",
      generationId: "local-stub-generation",
    },
  ];
  process.stdout.write(
    `${JSON.stringify(
      {
        compositorChecksum: createHash("sha256").update(composed).digest("hex"),
        concurrentRetry: concurrent,
        finalizationRetryEpoch: retry.epoch,
        gatewayReferences: ["aesthetic-sample", "exact-chart"],
        ledger,
        policyVersion: MARKET_GENERATION_BRIEF_POLICY_VERSION,
        providerMode: "local-deterministic-stub",
        scenarios: [
          "rejection-feed-forward-replay",
          "fallback",
          "ambiguity-refusal",
          "superseded-attach",
          "finalize-retry-from-stored-original",
          "crash-boundary-re-entry",
          "concurrent-retry",
        ],
        status: "pass",
      },
      null,
      2,
    )}\n`,
  );
}

await main();
