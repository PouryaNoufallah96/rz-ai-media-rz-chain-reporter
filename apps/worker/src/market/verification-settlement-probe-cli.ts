import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  MARKET_CHART_OUTPUT_DIMENSIONS,
  MARKET_CHART_RENDER_CONTRACT_VERSION,
  MARKET_CHART_SPEC_SCHEMA_VERSION,
  MARKET_VERIFICATION_COMMAND_PREFIX,
  type MarketChartRenderInput,
  type MarketChartSpec,
  type NormalizedMarketRequest,
} from "@rz-chain-reporter/contracts";
import { createDb } from "@rz-chain-reporter/db";
import type { Transaction } from "@rz-chain-reporter/db/executor";
import { getMarketSnapshotWithSeries } from "@rz-chain-reporter/db/repositories/market-snapshot";
import { claimOperationExecution } from "@rz-chain-reporter/db/repositories/operation";
import { user } from "@rz-chain-reporter/db/schema/auth";
import {
  marketAnalysis,
  marketChartRender,
  marketGeneration,
  marketInstrument,
} from "@rz-chain-reporter/db/schema/market-analysis";
import {
  marketSnapshot,
  marketSnapshotSeries,
} from "@rz-chain-reporter/db/schema/market-snapshot";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { workspace } from "@rz-chain-reporter/db/schema/workspace";
import {
  createMarketChartScene,
  MARKET_CHART_PRESETS,
  MarketChartError,
  normalizeMarketChartSpec,
} from "@rz-chain-reporter/market-chart";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { Inngest, RetryAfterError } from "inngest";
import { SafeHttpError } from "../fetch/safe-http";
import { createMarketChartRenderFunctions } from "../inngest/market-chart-render";
import {
  createMarketVerificationFunctions,
  loadMarketVerificationRequest,
  persistMarketVerification,
  settleFetchAttempt,
  settleOwnedMarketVerification,
} from "../inngest/market-verification";
import { scheduleDetachedMarketMediaCleanup } from "../inngest/media-storage";
import { workerEnv } from "../runtime/env";
import {
  classifyFetchFailure,
  createMarketAdapters,
  fetchMarketSeries,
} from "./fetcher";
import {
  type MarketPoint,
  type MarketProviderBindings,
  MarketProviderError,
  type MarketSeriesOutcome,
  type MarketTransport,
} from "./types";
import { summarizeObservedSeries } from "./window";

const databaseUrl = new URL(workerEnv.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== "/rz-chain-reporter"
) {
  throw new Error("LOCAL_DATABASE_REQUIRED");
}

const database = createDb(workerEnv.DATABASE_URL);
const workspaceId = randomUUID();
const analysisId = randomUUID();
const mixedGranularityWorkspaceId = randomUUID();
const mixedGranularityAnalysisId = randomUUID();
const rateLimitedWorkspaceId = randomUUID();
const rateLimitedAnalysisId = randomUUID();
const chartMediaAssetId = randomUUID();
const finalMediaAssetId = randomUUID();
const providerOriginalMediaAssetId = randomUUID();
const mediaAssetIds = [
  chartMediaAssetId,
  finalMediaAssetId,
  providerOriginalMediaAssetId,
];
const chartRenderId = randomUUID();
const generationId = randomUUID();
const requestFingerprint = `request:${randomUUID()}`;
const templateFingerprint = `template:${randomUUID()}`;
const approvedAt = new Date("2026-08-31T00:00:00.000Z");
const chartSpec = {
  schemaVersion: MARKET_CHART_SPEC_SCHEMA_VERSION,
  presetId: "probe",
  background: "#ffffff",
  seriesColors: { "controlled:probe": "#111111" },
  legendPosition: "bottom",
  legendFormat: "symbol_change",
  lineWidth: 4,
  markers: "endpoints",
  gridStrength: "subtle",
} satisfies MarketChartSpec;
type ProbeDatabase = Transaction;

function commandOwner(operationId: string) {
  return `${MARKET_VERIFICATION_COMMAND_PREFIX}${operationId}`;
}

function downstreamState(row: typeof marketAnalysis.$inferSelect) {
  return {
    chartApprovalFingerprint: row.chartApprovalFingerprint,
    chartApprovedAt: row.chartApprovedAt?.toISOString() ?? null,
    chartApprovedBy: row.chartApprovedBy,
    currentChartMediaAssetId: row.currentChartMediaAssetId,
    currentChartRenderId: row.currentChartRenderId,
    currentChartSpec: row.currentChartSpec,
    currentFinalMediaAssetId: row.currentFinalMediaAssetId,
    currentGenerationId: row.currentGenerationId,
    designApprovalFingerprint: row.designApprovalFingerprint,
    designApprovedAt: row.designApprovedAt?.toISOString() ?? null,
    designApprovedBy: row.designApprovedBy,
    designFamilyKey: row.designFamilyKey,
    designVariantKey: row.designVariantKey,
    finalApprovalFingerprint: row.finalApprovalFingerprint,
    finalApprovedAt: row.finalApprovedAt?.toISOString() ?? null,
    finalApprovedBy: row.finalApprovedBy,
    imageOptionKey: row.imageOptionKey,
    operatorDirection: row.operatorDirection,
    outputFormat: row.outputFormat,
    storyApprovalFingerprint: row.storyApprovalFingerprint,
    storyApprovedAt: row.storyApprovedAt?.toISOString() ?? null,
    storyApprovedBy: row.storyApprovedBy,
    storyHeadline: row.storyHeadline,
    storySupportingText: row.storySupportingText,
  };
}

async function readAnalysis(probeDatabase: ProbeDatabase) {
  const [row] = await probeDatabase
    .select()
    .from(marketAnalysis)
    .where(eq(marketAnalysis.id, analysisId));
  if (!row) throw new Error("PROBE_ANALYSIS_MISSING");
  return row;
}

async function readOperation(
  probeDatabase: ProbeDatabase,
  operationId: string,
) {
  const [row] = await probeDatabase
    .select()
    .from(operation)
    .where(eq(operation.id, operationId));
  if (!row) throw new Error("PROBE_OPERATION_MISSING");
  return row;
}

async function createVerificationOperation(
  probeDatabase: ProbeDatabase,
  actorId: string,
  intentId: string,
  intentVersion: number,
) {
  const operationId = intentId;
  await probeDatabase.insert(operation).values({
    id: operationId,
    workspaceId,
    actor: actorId,
    commandType: `${MARKET_VERIFICATION_COMMAND_PREFIX}${analysisId}`,
    idempotencyKey: `probe:${operationId}`,
    requestHash: `probe:${operationId}`,
  });
  await probeDatabase
    .update(marketAnalysis)
    .set({
      requestFingerprint,
      verificationIntentId: intentId,
      verificationIntentVersion: intentVersion,
    })
    .where(eq(marketAnalysis.id, analysisId));
  const claimed = await claimOperationExecution(probeDatabase, workspaceId, {
    id: operationId,
    claimedBy: commandOwner(operationId),
    now: new Date(),
    leaseExpiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") throw new Error("PROBE_CLAIM_FAILED");
  return claimed.operation;
}

async function settleInput(
  probeDatabase: ProbeDatabase,
  claimed: typeof operation.$inferSelect,
  intentId: string,
  intentVersion: number,
  request: NormalizedMarketRequest,
  outcomes: readonly MarketSeriesOutcome[],
) {
  return persistMarketVerification(probeDatabase, {
    workspaceId,
    operationId: claimed.id,
    marketAnalysisId: analysisId,
    claimedBy: commandOwner(claimed.id),
    operationVersion: claimed.version,
    request,
    requestFingerprint,
    templateFingerprint,
    verificationIntentId: intentId,
    verificationIntentVersion: intentVersion,
    outcomes,
  });
}

async function executeProbeTransaction() {
  return database.db.transaction(async (probeDatabase) => {
    const [actor] = await probeDatabase
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt))
      .limit(1);
    if (!actor) throw new Error("MARKET_SETTLEMENT_PROBE_ACTOR_REQUIRED");

    const analysisOperationId = randomUUID();
    const renderOperationId = randomUUID();
    const generationOperationId = randomUUID();
    const mediaBrandId = randomUUID();
    const instrumentId = randomUUID();
    const request: NormalizedMarketRequest = {
      period: "24h",
      scale: "relative",
      series: [
        {
          controlledInstrumentId: instrumentId,
          descriptorIdentity: "controlled:probe",
          displayName: "Probe Asset",
          providerMappings: [
            {
              fallback: false,
              kind: "binance_pair",
              pair: "BTCUSDT",
              provider: "binance",
            },
          ],
          role: "primary",
          symbol: "PRB",
        },
      ],
    };
    const outcomes: readonly MarketSeriesOutcome[] = [
      {
        attemptedMappings: request.series[0]?.providerMappings ?? [],
        attributionIdentity: "Binance",
        changePercent: "10.0000",
        coverageEnd: new Date("2026-08-31T01:00:00.000Z"),
        coverageStart: new Date("2026-08-31T00:00:00.000Z"),
        endPrice: "110.00000000",
        mapping: request.series[0]?.providerMappings[0] ?? {
          fallback: false,
          kind: "binance_pair",
          pair: "BTCUSDT",
          provider: "binance",
        },
        outcome: "succeeded",
        points: [
          ["2026-08-31T00:00:00.000Z", "100.00000000"],
          ["2026-08-31T01:00:00.000Z", "110.00000000"],
        ],
        provider: "binance",
        providerReference: "fixture:BTCUSDT",
        startPrice: "100.00000000",
        warnings: [],
      },
    ];
    const failedOutcomes: readonly MarketSeriesOutcome[] = [
      {
        attemptedMappings: request.series[0]?.providerMappings ?? [],
        failureCode: "MARKET_SERIES_UNAVAILABLE",
        outcome: "failed",
        retryClassification: "retryable",
        warnings: ["provider_unavailable"],
      },
    ];

    await probeDatabase.insert(workspace).values({
      id: workspaceId,
      name: `Market settlement probe ${workspaceId}`,
    });
    await probeDatabase.insert(mediaBrand).values({
      id: mediaBrandId,
      workspaceId,
      key: `probe-${workspaceId}`,
      name: "Market settlement probe",
      sortOrder: 1,
    });
    await probeDatabase.insert(marketInstrument).values({
      id: instrumentId,
      workspaceId,
      key: `probe-${workspaceId}`,
      name: "Probe Asset",
      symbol: "PRB",
      providerMappings: request.series[0]?.providerMappings ?? [],
    });
    await probeDatabase.insert(operation).values(
      [analysisOperationId, renderOperationId, generationOperationId].map(
        (id) => ({
          id,
          workspaceId,
          actor: actor.id,
          commandType: `market-settlement-probe:${id}`,
          idempotencyKey: id,
          requestHash: id,
          lifecycle: "succeeded" as const,
        }),
      ),
    );
    await probeDatabase.insert(mediaAsset).values(
      mediaAssetIds.map((id, index) => ({
        id,
        workspaceId,
        kind: index === 0 ? "market_chart_render" : `market-probe-${index}`,
        objectKey: `market-settlement-probe/${workspaceId}/${index}.png`,
        mimeType: "image/png",
        declaredBytes: 8,
        actualBytes: 8,
        checksum: `checksum-${index}`,
        width: 1,
        height: 1,
        lifecycle: "verified" as const,
        verifiedAt: approvedAt,
      })),
    );
    await probeDatabase.insert(marketAnalysis).values({
      id: analysisId,
      workspaceId,
      operationId: analysisOperationId,
      mediaBrandId,
      visualOwnerInstrumentId: instrumentId,
      contentLocale: "en",
      normalizedRequest: request,
      requestFingerprint,
      templateFingerprint,
      instrumentProfileFingerprint: "instrument-profile:probe",
    });

    const initialFailureIntentId = randomUUID();
    const initialFailure = await createVerificationOperation(
      probeDatabase,
      actor.id,
      initialFailureIntentId,
      1,
    );
    const initialFailureResult = await settleInput(
      probeDatabase,
      initialFailure,
      initialFailureIntentId,
      1,
      request,
      failedOutcomes,
    );
    assert.equal(initialFailureResult.status, "unverified");
    assert.equal(
      (await readOperation(probeDatabase, initialFailure.id)).lifecycle,
      "failed",
    );
    assert.equal((await readAnalysis(probeDatabase)).currentSnapshotId, null);
    const [initialFailureSnapshot] = await probeDatabase
      .select()
      .from(marketSnapshot)
      .where(eq(marketSnapshot.operationId, initialFailure.id));
    assert.equal(initialFailureSnapshot?.status, "unverified");
    assert.equal(
      await probeDatabase.$count(
        marketSnapshotSeries,
        eq(
          marketSnapshotSeries.marketSnapshotId,
          initialFailureResult.snapshotId,
        ),
      ),
      1,
    );

    const acceptedIntentId = randomUUID();
    const accepted = await createVerificationOperation(
      probeDatabase,
      actor.id,
      acceptedIntentId,
      1,
    );
    const acceptedResult = await settleInput(
      probeDatabase,
      accepted,
      acceptedIntentId,
      1,
      request,
      outcomes,
    );
    assert.equal(acceptedResult.status, "verified");
    assert.equal(
      (await readAnalysis(probeDatabase)).currentSnapshotId,
      acceptedResult.snapshotId,
    );

    await probeDatabase.insert(marketChartRender).values({
      id: chartRenderId,
      workspaceId,
      marketAnalysisId: analysisId,
      operationId: renderOperationId,
      expectedChartFingerprint: "chart:approved",
      renderContractVersion: "probe-v1",
    });
    await probeDatabase
      .update(marketAnalysis)
      .set({
        chartApprovalFingerprint: "chart:approved",
        chartApprovedAt: approvedAt,
        chartApprovedBy: actor.id,
        currentChartMediaAssetId: null,
        currentChartRenderId: chartRenderId,
      })
      .where(eq(marketAnalysis.id, analysisId));
    await probeDatabase
      .update(marketChartRender)
      .set({ mediaAssetId: chartMediaAssetId, verifiedAt: approvedAt })
      .where(eq(marketChartRender.id, chartRenderId));
    await probeDatabase.insert(marketGeneration).values({
      id: generationId,
      workspaceId,
      operationId: generationOperationId,
      marketAnalysisId: analysisId,
      intentId: randomUUID(),
      intentVersion: 1,
      expectedDesignFingerprint: "design:approved",
      imageOptionKey: "probe-image",
      operatorDirection: "ltr",
      referenceSampleKey: "probe-reference",
      referenceSampleChecksum: "reference-checksum",
      footerLockupKey: "probe-lockup",
      footerLockupChecksum: "lockup-checksum",
      chartMediaAssetId,
      chartMediaChecksum: "checksum-0",
      outputWidth: 1080,
      outputHeight: 1350,
      providerOriginalMediaAssetId,
      finalMediaAssetId,
    });
    await probeDatabase
      .update(marketAnalysis)
      .set({
        currentChartSpec: chartSpec,
        currentChartRenderId: chartRenderId,
        currentChartMediaAssetId: chartMediaAssetId,
        storyHeadline: "Accepted headline",
        storySupportingText: "Accepted supporting text",
        designFamilyKey: "probe-family",
        designVariantKey: "probe-variant",
        outputFormat: "portrait",
        operatorDirection: "ltr",
        imageOptionKey: "probe-image",
        currentGenerationId: generationId,
        currentFinalMediaAssetId: finalMediaAssetId,
        chartApprovalFingerprint: "chart:approved",
        chartApprovedAt: approvedAt,
        chartApprovedBy: actor.id,
        storyApprovalFingerprint: "story:approved",
        storyApprovedAt: approvedAt,
        storyApprovedBy: actor.id,
        designApprovalFingerprint: "design:approved",
        designApprovedAt: approvedAt,
        designApprovedBy: actor.id,
        finalApprovalFingerprint: "final:approved",
        finalApprovedAt: approvedAt,
        finalApprovedBy: actor.id,
      })
      .where(eq(marketAnalysis.id, analysisId));

    const acceptedChain = downstreamState(await readAnalysis(probeDatabase));

    const failedRefreshIntentId = randomUUID();
    const failedRefresh = await createVerificationOperation(
      probeDatabase,
      actor.id,
      failedRefreshIntentId,
      1,
    );
    const failedRefreshResult = await settleInput(
      probeDatabase,
      failedRefresh,
      failedRefreshIntentId,
      1,
      request,
      failedOutcomes,
    );
    assert.equal(failedRefreshResult.status, "unverified");
    assert.notEqual(failedRefreshResult.snapshotId, acceptedResult.snapshotId);
    assert.equal(
      (await readOperation(probeDatabase, failedRefresh.id)).lifecycle,
      "failed",
    );
    assert.equal(
      (await readAnalysis(probeDatabase)).currentSnapshotId,
      acceptedResult.snapshotId,
    );
    assert.deepEqual(
      downstreamState(await readAnalysis(probeDatabase)),
      acceptedChain,
    );
    const [failedRefreshSnapshot] = await probeDatabase
      .select()
      .from(marketSnapshot)
      .where(eq(marketSnapshot.operationId, failedRefresh.id));
    assert.equal(failedRefreshSnapshot?.status, "unverified");
    assert.equal(
      await probeDatabase.$count(
        marketSnapshotSeries,
        eq(
          marketSnapshotSeries.marketSnapshotId,
          failedRefreshResult.snapshotId,
        ),
      ),
      1,
    );

    for (const lifecycle of ["failed", "cancelled"] as const) {
      const intentId = randomUUID();
      const claimed = await createVerificationOperation(
        probeDatabase,
        actor.id,
        intentId,
        1,
      );
      assert.deepEqual(
        downstreamState(await readAnalysis(probeDatabase)),
        acceptedChain,
      );
      const settled = await settleOwnedMarketVerification(
        probeDatabase,
        workspaceId,
        claimed.id,
        commandOwner(claimed.id),
        lifecycle,
      );
      assert.equal(settled?.lifecycle, lifecycle);
      assert.deepEqual(
        downstreamState(await readAnalysis(probeDatabase)),
        acceptedChain,
      );
    }

    const staleIntentId = randomUUID();
    const stale = await createVerificationOperation(
      probeDatabase,
      actor.id,
      staleIntentId,
      1,
    );
    await probeDatabase
      .update(operation)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(operation.id, stale.id));
    await assert.rejects(() =>
      settleInput(probeDatabase, stale, staleIntentId, 1, request, outcomes),
    );
    assert.deepEqual(
      downstreamState(await readAnalysis(probeDatabase)),
      acceptedChain,
    );
    assert.equal(
      await probeDatabase.$count(
        marketSnapshot,
        eq(marketSnapshot.operationId, stale.id),
      ),
      0,
    );

    const supersededIntentId = randomUUID();
    const superseded = await createVerificationOperation(
      probeDatabase,
      actor.id,
      supersededIntentId,
      1,
    );
    await probeDatabase
      .update(marketAnalysis)
      .set({ verificationIntentId: randomUUID(), verificationIntentVersion: 1 })
      .where(eq(marketAnalysis.id, analysisId));
    const supersededResult = await settleInput(
      probeDatabase,
      superseded,
      supersededIntentId,
      1,
      request,
      outcomes,
    );
    assert.equal(supersededResult.status, "superseded");
    assert.equal(
      (await readOperation(probeDatabase, superseded.id)).lifecycle,
      "cancelled",
    );
    assert.deepEqual(
      downstreamState(await readAnalysis(probeDatabase)),
      acceptedChain,
    );

    const supersededBeforeLoadIntentId = randomUUID();
    const supersededBeforeLoad = await createVerificationOperation(
      probeDatabase,
      actor.id,
      supersededBeforeLoadIntentId,
      1,
    );
    await probeDatabase
      .update(marketAnalysis)
      .set({ verificationIntentId: randomUUID(), verificationIntentVersion: 1 })
      .where(eq(marketAnalysis.id, analysisId));
    const supersededBeforeLoadState = await loadMarketVerificationRequest(
      probeDatabase,
      workspaceId,
      analysisId,
      supersededBeforeLoad.id,
    );
    assert.equal(supersededBeforeLoadState.status, "superseded");
    const supersededBeforeLoadSettled = await settleOwnedMarketVerification(
      probeDatabase,
      workspaceId,
      supersededBeforeLoad.id,
      commandOwner(supersededBeforeLoad.id),
      "cancelled",
    );
    assert.equal(supersededBeforeLoadSettled?.lifecycle, "cancelled");
    assert.equal(
      await probeDatabase.$count(
        marketSnapshot,
        eq(marketSnapshot.operationId, supersededBeforeLoad.id),
      ),
      0,
    );
    assert.deepEqual(
      downstreamState(await readAnalysis(probeDatabase)),
      acceptedChain,
    );

    const lateIntentId = randomUUID();
    const late = await createVerificationOperation(
      probeDatabase,
      actor.id,
      lateIntentId,
      1,
    );
    await probeDatabase
      .update(marketAnalysis)
      .set({ verificationIntentVersion: 2 })
      .where(eq(marketAnalysis.id, analysisId));
    const lateResult = await settleInput(
      probeDatabase,
      late,
      lateIntentId,
      1,
      request,
      outcomes,
    );
    assert.equal(lateResult.status, "superseded");
    assert.equal(
      (await readOperation(probeDatabase, late.id)).lifecycle,
      "cancelled",
    );
    assert.deepEqual(
      downstreamState(await readAnalysis(probeDatabase)),
      acceptedChain,
    );

    const winningIntentId = randomUUID();
    const winning = await createVerificationOperation(
      probeDatabase,
      actor.id,
      winningIntentId,
      1,
    );
    assert.deepEqual(
      downstreamState(await readAnalysis(probeDatabase)),
      acceptedChain,
    );
    assert.equal(
      (
        await loadMarketVerificationRequest(
          probeDatabase,
          workspaceId,
          analysisId,
          winning.id,
        )
      ).status,
      "current",
    );
    const won = await settleInput(
      probeDatabase,
      winning,
      winningIntentId,
      1,
      request,
      outcomes,
    );
    assert.equal(won.status, "verified");
    assert.equal(
      (await readOperation(probeDatabase, winning.id)).lifecycle,
      "succeeded",
    );
    assert.deepEqual(
      new Set(won.detachedMediaAssetIds),
      new Set(mediaAssetIds),
    );
    const installed = await readAnalysis(probeDatabase);
    assert.equal(installed.currentSnapshotId, won.snapshotId);
    assert.deepEqual(downstreamState(installed), {
      chartApprovalFingerprint: null,
      chartApprovedAt: null,
      chartApprovedBy: null,
      currentChartMediaAssetId: null,
      currentChartRenderId: null,
      currentChartSpec: chartSpec,
      currentFinalMediaAssetId: null,
      currentGenerationId: null,
      designApprovalFingerprint: null,
      designApprovedAt: null,
      designApprovedBy: null,
      designFamilyKey: null,
      designVariantKey: null,
      finalApprovalFingerprint: null,
      finalApprovedAt: null,
      finalApprovedBy: null,
      imageOptionKey: null,
      operatorDirection: null,
      outputFormat: "portrait",
      storyApprovalFingerprint: null,
      storyApprovedAt: null,
      storyApprovedBy: null,
      storyHeadline: null,
      storySupportingText: null,
    });
    const beforeCleanup = await probeDatabase
      .select({ cleanupAfter: mediaAsset.cleanupAfter })
      .from(mediaAsset)
      .where(inArray(mediaAsset.id, mediaAssetIds));
    assert.equal(
      beforeCleanup.every((asset) => asset.cleanupAfter === null),
      true,
    );
    const scheduled = await scheduleDetachedMarketMediaCleanup(
      probeDatabase,
      workspaceId,
      won.detachedMediaAssetIds,
      new Date("2026-09-01T00:00:00.000Z"),
    );
    assert.deepEqual(new Set(scheduled), new Set(mediaAssetIds));
    const afterCleanup = await probeDatabase
      .select({ cleanupAfter: mediaAsset.cleanupAfter })
      .from(mediaAsset)
      .where(inArray(mediaAsset.id, mediaAssetIds));
    assert.equal(
      afterCleanup.every((asset) => asset.cleanupAfter !== null),
      true,
    );

    await assert.rejects(() =>
      settleInput(
        probeDatabase,
        winning,
        winningIntentId,
        1,
        request,
        outcomes,
      ),
    );
    assert.equal(
      await probeDatabase.$count(
        marketSnapshot,
        eq(marketSnapshot.operationId, winning.id),
      ),
      1,
    );
    assert.equal(
      (await readAnalysis(probeDatabase)).currentSnapshotId,
      won.snapshotId,
    );
    throw rollbackFixture;
  });
}

function observedGrid(
  startIso: string,
  stepHours: number,
  count: number,
): MarketPoint[] {
  const start = Date.parse(startIso);
  return Array.from({ length: count }, (_, index) => [
    start + index * stepHours * 3_600_000,
    100 + index,
  ]);
}

function pointsInsideWindow(
  points: readonly MarketPoint[],
  start: Date,
  end: Date,
) {
  return points
    .filter(
      ([timestamp]) =>
        timestamp >= start.getTime() && timestamp <= end.getTime(),
    )
    .map(([timestamp, price]) => [
      new Date(timestamp).toISOString(),
      price.toString(),
    ]);
}

function chartSceneOutcome(input: MarketChartRenderInput) {
  try {
    const scene = createMarketChartScene(input);
    return `rendered:${scene.series.length}-series`;
  } catch (error) {
    return `threw:${error instanceof MarketChartError ? error.code : "UNKNOWN"}`;
  }
}

async function executeMixedGranularityTransaction() {
  return database.db.transaction(async (probeDatabase) => {
    const [actor] = await probeDatabase
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt))
      .limit(1);
    if (!actor) throw new Error("MARKET_SETTLEMENT_PROBE_ACTOR_REQUIRED");

    const analysisOperationId = randomUUID();
    const verificationOperationId = randomUUID();
    const mediaBrandId = randomUUID();
    const instrumentId = randomUUID();
    const mixedRequestFingerprint = `request:${randomUUID()}`;
    const publicMapping = {
      address: "0xmixedgranularity",
      fallback: false,
      kind: "coinmarketcap_public_kline",
      platform: "bsc",
      provider: "coinmarketcap_public",
    } as const;
    const binanceMapping = {
      fallback: false,
      kind: "binance_pair",
      pair: "XRPUSDT",
      provider: "binance",
    } as const;
    const request: NormalizedMarketRequest = {
      period: "7d",
      scale: "relative",
      series: [
        {
          controlledInstrumentId: instrumentId,
          descriptorIdentity: "controlled:mixed-granularity",
          displayName: "Mixed Granularity Asset",
          providerMappings: [publicMapping],
          role: "primary",
          symbol: "MGX",
        },
        {
          controlledInstrumentId: null,
          descriptorIdentity: "binance:XRPUSDT",
          displayName: "XRP",
          providerMappings: [binanceMapping],
          role: "comparison",
          symbol: "XRP",
        },
      ],
    };
    const eightHourPoints = observedGrid("2026-08-30T12:00:00.000Z", 8, 9);
    const dailyPoints = observedGrid("2026-08-30T00:00:00.000Z", 24, 4);
    const rawPoints = new Map([
      ["controlled:mixed-granularity", eightHourPoints],
      ["binance:XRPUSDT", dailyPoints],
    ]);
    const outcomes: readonly MarketSeriesOutcome[] = [
      summarizeObservedSeries(eightHourPoints, {
        attemptedMappings: [publicMapping],
        attributionIdentity: "CoinMarketCap",
        mapping: publicMapping,
        provider: "coinmarketcap_public",
        providerReference: "fixture:mixed-granularity-8h",
        warnings: [],
      }),
      summarizeObservedSeries(dailyPoints, {
        attemptedMappings: [binanceMapping],
        attributionIdentity: "Binance",
        mapping: binanceMapping,
        provider: "binance",
        providerReference: "fixture:XRPUSDT-1d",
        warnings: [],
      }),
    ];
    assert.ok(outcomes.every((outcome) => outcome.outcome === "succeeded"));

    await probeDatabase.insert(workspace).values({
      id: mixedGranularityWorkspaceId,
      name: `Market mixed granularity probe ${mixedGranularityWorkspaceId}`,
    });
    await probeDatabase.insert(mediaBrand).values({
      id: mediaBrandId,
      workspaceId: mixedGranularityWorkspaceId,
      key: `mixed-granularity-${mixedGranularityWorkspaceId}`,
      name: "Market mixed granularity probe",
      sortOrder: 1,
    });
    await probeDatabase.insert(marketInstrument).values({
      id: instrumentId,
      workspaceId: mixedGranularityWorkspaceId,
      key: `mixed-granularity-${mixedGranularityWorkspaceId}`,
      name: "Mixed Granularity Asset",
      symbol: "MGX",
      providerMappings: [publicMapping],
    });
    await probeDatabase.insert(operation).values([
      {
        id: analysisOperationId,
        workspaceId: mixedGranularityWorkspaceId,
        actor: actor.id,
        commandType: `market-mixed-granularity-probe:${analysisOperationId}`,
        idempotencyKey: analysisOperationId,
        requestHash: analysisOperationId,
        lifecycle: "succeeded" as const,
      },
      {
        id: verificationOperationId,
        workspaceId: mixedGranularityWorkspaceId,
        actor: actor.id,
        commandType: `${MARKET_VERIFICATION_COMMAND_PREFIX}${mixedGranularityAnalysisId}`,
        idempotencyKey: `probe:${verificationOperationId}`,
        requestHash: `probe:${verificationOperationId}`,
      },
    ]);
    await probeDatabase.insert(marketAnalysis).values({
      id: mixedGranularityAnalysisId,
      workspaceId: mixedGranularityWorkspaceId,
      operationId: analysisOperationId,
      mediaBrandId,
      visualOwnerInstrumentId: instrumentId,
      contentLocale: "en",
      normalizedRequest: request,
      requestFingerprint: mixedRequestFingerprint,
      templateFingerprint,
      instrumentProfileFingerprint: "instrument-profile:mixed-granularity",
      verificationIntentId: verificationOperationId,
      verificationIntentVersion: 1,
    });
    const claimed = await claimOperationExecution(
      probeDatabase,
      mixedGranularityWorkspaceId,
      {
        id: verificationOperationId,
        claimedBy: commandOwner(verificationOperationId),
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    );
    if (claimed.status !== "claimed") throw new Error("PROBE_CLAIM_FAILED");

    const settled = await persistMarketVerification(probeDatabase, {
      workspaceId: mixedGranularityWorkspaceId,
      operationId: verificationOperationId,
      marketAnalysisId: mixedGranularityAnalysisId,
      claimedBy: commandOwner(verificationOperationId),
      operationVersion: claimed.operation.version,
      request,
      requestFingerprint: mixedRequestFingerprint,
      templateFingerprint,
      verificationIntentId: verificationOperationId,
      verificationIntentVersion: 1,
      outcomes,
    });
    const persisted = await getMarketSnapshotWithSeries(
      probeDatabase,
      mixedGranularityWorkspaceId,
      settled.snapshotId,
    );
    const windowStart = persisted?.snapshot.effectiveWindowStart;
    const windowEnd = persisted?.snapshot.effectiveWindowEnd;
    if (!persisted || !windowStart || !windowEnd) {
      throw new Error("PROBE_MIXED_GRANULARITY_WINDOW_MISSING");
    }

    const audit = await probeDatabase.execute(sql`
      select series.descriptor_identity as identity,
             count(*)::int as points,
             min((point ->> 0)::timestamptz) as first_point,
             max((point ->> 0)::timestamptz) as last_point,
             snapshot.effective_window_start as window_start,
             snapshot.effective_window_end as window_end,
             bool_and((point ->> 0)::timestamptz >= snapshot.effective_window_start
                      and (point ->> 0)::timestamptz <= snapshot.effective_window_end) as inside_window
        from market_snapshot_series series
        join market_snapshot snapshot on snapshot.id = series.market_snapshot_id
        cross join lateral jsonb_array_elements(series.points) as point
       where series.market_snapshot_id = ${settled.snapshotId}::uuid
         and series.outcome = 'succeeded'
       group by series.descriptor_identity,
                snapshot.effective_window_start,
                snapshot.effective_window_end
       order by series.descriptor_identity
    `);
    const chartInput: MarketChartRenderInput = {
      renderContractVersion: MARKET_CHART_RENDER_CONTRACT_VERSION,
      contentLocale: "en",
      dimensions: MARKET_CHART_OUTPUT_DIMENSIONS.landscape,
      snapshot: {
        id: persisted.snapshot.id,
        checksum: createHash("sha256")
          .update(JSON.stringify(persisted.series))
          .digest("hex"),
        period: persisted.snapshot.period,
        scale: persisted.snapshot.scale,
        effectiveWindowStart: windowStart.toISOString(),
        effectiveWindowEnd: windowEnd.toISOString(),
        series: persisted.series.map((entry) => {
          const descriptor = request.series.find(
            (candidate) =>
              candidate.descriptorIdentity === entry.descriptorIdentity,
          );
          if (!descriptor) throw new Error("PROBE_DESCRIPTOR_MISSING");
          return entry.outcome === "succeeded"
            ? {
                outcome: "succeeded" as const,
                id: entry.descriptorIdentity,
                label: descriptor.displayName,
                symbol: descriptor.symbol,
                role: entry.role,
                points: (entry.points ?? []).map((point) => [...point]),
                changePercent: entry.changePercent ?? "0",
                warnings: [...entry.warnings],
                attributionIdentity: entry.attributionIdentity,
              }
            : {
                outcome: "failed" as const,
                id: entry.descriptorIdentity,
                label: descriptor.displayName,
                symbol: descriptor.symbol,
                role: entry.role,
                warnings: [...entry.warnings],
                failureCode: entry.failureCode ?? "MARKET_PROVIDER_UNAVAILABLE",
              };
        }),
      },
      spec: normalizeMarketChartSpec({
        schemaVersion: MARKET_CHART_SPEC_SCHEMA_VERSION,
        presetId: "custom",
        background: MARKET_CHART_PRESETS["color-blind-safe"].background,
        seriesColors: Object.fromEntries(
          request.series.map((series, index) => [
            series.descriptorIdentity,
            MARKET_CHART_PRESETS["color-blind-safe"].colors[index] ?? "#000000",
          ]),
        ),
        legendPosition: "bottom",
        legendFormat: "symbol_change",
        lineWidth: 4,
        markers: "endpoints",
        gridStrength: "subtle",
      }),
      attribution: ["Binance", "CoinMarketCap"].map((identity) => ({
        required: true,
        chartLevel: true,
        identity,
        text: identity,
        hyperlinkRequired: false,
      })),
    };
    const scene = chartSceneOutcome(chartInput);
    console.log(
      `market mixed granularity settlement window=[${windowStart.toISOString()},${windowEnd.toISOString()}] status=${persisted.snapshot.status} scene=${scene} audit=${JSON.stringify(audit.rows)}`,
    );

    assert.equal(settled.status, "verified");
    assert.equal(persisted.snapshot.status, "verified");
    assert.equal(windowStart.toISOString(), "2026-08-30T12:00:00.000Z");
    assert.equal(windowEnd.toISOString(), "2026-09-02T00:00:00.000Z");
    for (const entry of persisted.series) {
      const raw = rawPoints.get(entry.descriptorIdentity);
      if (!raw) throw new Error("PROBE_RAW_POINTS_MISSING");
      assert.equal(entry.outcome, "succeeded", entry.descriptorIdentity);
      assert.deepEqual(
        entry.points?.map((point) => [...point]),
        pointsInsideWindow(raw, windowStart, windowEnd),
        `${entry.descriptorIdentity} must keep every observation inside the settled window`,
      );
      const timestamps = (entry.points ?? []).map(([timestamp]) =>
        Date.parse(timestamp),
      );
      assert.ok(
        Math.min(...timestamps) >= windowStart.getTime() &&
          Math.max(...timestamps) <= windowEnd.getTime(),
        `${entry.descriptorIdentity} points [${new Date(Math.min(...timestamps)).toISOString()},${new Date(Math.max(...timestamps)).toISOString()}] must sit inside the persisted window [${windowStart.toISOString()},${windowEnd.toISOString()}]`,
      );
    }
    assert.equal(scene, "rendered:2-series");
    throw rollbackFixture;
  });
}

const RATE_LIMIT_RETRY_AFTER_SECONDS = 45;
const rateLimitedBindings: MarketProviderBindings = {
  binance: { attributionIdentity: "Binance", enabled: true },
  binanceGeoAllowed: true,
  coingecko: {
    apiKey: "fixture",
    attributionIdentity: "CoinGecko",
    enabled: true,
  },
  coingecko_onchain: {
    apiKey: "fixture",
    attributionIdentity: "CoinGecko Onchain",
    enabled: true,
  },
  coinmarketcap: {
    apiKey: "fixture",
    attributionIdentity: "CoinMarketCap",
    enabled: true,
  },
  coinmarketcap_public: {
    attributionIdentity: "CoinMarketCap Public Market Data",
    enabled: true,
  },
};

const rateLimitedTransport: MarketTransport = async (request) => {
  const url = new URL(request.url);
  if (url.pathname.includes("/public-api/v1/k-line/points")) {
    throw new SafeHttpError(
      "retry_after",
      url.hostname,
      RATE_LIMIT_RETRY_AFTER_SECONDS,
    );
  }
  if (!url.pathname.endsWith("/klines")) {
    throw new Error(`unexpected fixture request ${url.pathname}`);
  }
  return {
    status: 200,
    text: JSON.stringify(
      observedGrid("2026-08-31T12:00:00.000Z", 1, 25).map(
        ([timestamp, price]) => [timestamp, "0", "0", "0", price.toString()],
      ),
    ),
    url: request.url,
  };
};

async function executeRateLimitedTransaction() {
  return database.db.transaction(async (probeDatabase) => {
    const [actor] = await probeDatabase
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt))
      .limit(1);
    if (!actor) throw new Error("MARKET_SETTLEMENT_PROBE_ACTOR_REQUIRED");

    const analysisOperationId = randomUUID();
    const verificationOperationId = randomUUID();
    const mediaBrandId = randomUUID();
    const instrumentId = randomUUID();
    const rateLimitedRequestFingerprint = `request:${randomUUID()}`;
    const publicMapping = {
      address: "0xratelimited",
      fallback: false,
      kind: "coinmarketcap_public_kline",
      platform: "bsc",
      provider: "coinmarketcap_public",
    } as const;
    const binanceMapping = {
      fallback: false,
      kind: "binance_pair",
      pair: "BTCUSDT",
      provider: "binance",
    } as const;
    const request: NormalizedMarketRequest = {
      period: "24h",
      scale: "relative",
      series: [
        {
          controlledInstrumentId: instrumentId,
          descriptorIdentity: "controlled:rate-limited",
          displayName: "Rate Limited Asset",
          providerMappings: [publicMapping],
          role: "primary",
          symbol: "RLX",
        },
        {
          controlledInstrumentId: null,
          descriptorIdentity: "binance:BTCUSDT",
          displayName: "Bitcoin",
          providerMappings: [binanceMapping],
          role: "comparison",
          symbol: "BTC",
        },
      ],
    };
    const adapters = createMarketAdapters(
      rateLimitedBindings,
      rateLimitedTransport,
    ).adapters;
    const requestedAt = new Date("2026-09-01T12:00:00.000Z");
    const outcomes = await Promise.all(
      request.series.map((series) =>
        fetchMarketSeries(adapters, series, request.period, requestedAt),
      ),
    );
    const [rateLimited, comparison] = outcomes;
    if (!rateLimited || !comparison) throw new Error("PROBE_OUTCOMES_MISSING");
    assert.equal(rateLimited.outcome, "failed");
    assert.equal(comparison.outcome, "succeeded");
    if (rateLimited.outcome !== "failed") throw new Error("PROBE_UNREACHABLE");
    assert.equal(rateLimited.failureCode, "MARKET_SERIES_UNAVAILABLE");
    assert.equal(rateLimited.retryClassification, "retryable");
    assert.ok(rateLimited.warnings.includes("provider_rate_limited"));
    assert.equal(rateLimited.retryAfterSeconds, RATE_LIMIT_RETRY_AFTER_SECONDS);

    const transportClassification = (
      [
        "deadline",
        "fetch_failed",
        "redirect_blocked",
        "retry_after",
        "ssrf_blocked",
        "too_large",
        "unsupported_mime",
      ] as const
    ).map((reason) => {
      const classified = classifyFetchFailure(
        new SafeHttpError(
          reason,
          "pro-api.coinmarketcap.com",
          reason === "retry_after" ? RATE_LIMIT_RETRY_AFTER_SECONDS : null,
        ),
      );
      const cause = classified.error.cause;
      assert.ok(cause instanceof SafeHttpError);
      assert.equal(cause.reason, reason);
      return `${reason}=${classified.error.failureCode}/${classified.error.retryClassification}/retryAfter=${classified.error.retryAfterSeconds}/warnings=${classified.warnings.join("|")}`;
    });
    const unknownFailure = classifyFetchFailure(new Error("boom"));
    assert.equal(unknownFailure.error.failureCode, "TRANSIENT_CONFLICT");
    assert.equal(unknownFailure.error.retryClassification, "retryable");
    assert.ok(unknownFailure.error.cause instanceof Error);

    const ladder = [0, 1, 2, 3].map((attempt) => {
      try {
        const settledAttempt = settleFetchAttempt(rateLimited, attempt, 4);
        return `attempt${attempt}=returned:${settledAttempt.outcome === "failed" ? settledAttempt.failureCode : "succeeded"}`;
      } catch (error) {
        if (error instanceof RetryAfterError) {
          return `attempt${attempt}=RetryAfterError:${error.retryAfter}s`;
        }
        if (error instanceof MarketProviderError) {
          return `attempt${attempt}=retry:${error.failureCode}`;
        }
        throw error;
      }
    });
    let cappedRetryAfter = "not-thrown";
    try {
      settleFetchAttempt({ ...rateLimited, retryAfterSeconds: 3_600 }, 0, 4);
    } catch (error) {
      cappedRetryAfter =
        error instanceof RetryAfterError
          ? `capped:${error.retryAfter}s`
          : "unexpected";
    }
    console.log(
      `market transport classification ${transportClassification.join(" ")} unknown=${unknownFailure.error.failureCode}/${unknownFailure.error.retryClassification}`,
    );
    console.log(
      `market rate-limited retry ladder ${ladder.join(" ")} cap=${cappedRetryAfter}`,
    );
    assert.deepEqual(ladder, [
      `attempt0=RetryAfterError:${RATE_LIMIT_RETRY_AFTER_SECONDS}s`,
      `attempt1=RetryAfterError:${RATE_LIMIT_RETRY_AFTER_SECONDS}s`,
      "attempt2=retry:MARKET_SERIES_UNAVAILABLE",
      "attempt3=returned:MARKET_SERIES_UNAVAILABLE",
    ]);
    assert.equal(cappedRetryAfter, "capped:60s");

    await probeDatabase.insert(workspace).values({
      id: rateLimitedWorkspaceId,
      name: `Market rate limited probe ${rateLimitedWorkspaceId}`,
    });
    await probeDatabase.insert(mediaBrand).values({
      id: mediaBrandId,
      workspaceId: rateLimitedWorkspaceId,
      key: `rate-limited-${rateLimitedWorkspaceId}`,
      name: "Market rate limited probe",
      sortOrder: 1,
    });
    await probeDatabase.insert(marketInstrument).values({
      id: instrumentId,
      workspaceId: rateLimitedWorkspaceId,
      key: `rate-limited-${rateLimitedWorkspaceId}`,
      name: "Rate Limited Asset",
      symbol: "RLX",
      providerMappings: [publicMapping],
    });
    await probeDatabase.insert(operation).values([
      {
        id: analysisOperationId,
        workspaceId: rateLimitedWorkspaceId,
        actor: actor.id,
        commandType: `market-rate-limited-probe:${analysisOperationId}`,
        idempotencyKey: analysisOperationId,
        requestHash: analysisOperationId,
        lifecycle: "succeeded" as const,
      },
      {
        id: verificationOperationId,
        workspaceId: rateLimitedWorkspaceId,
        actor: actor.id,
        commandType: `${MARKET_VERIFICATION_COMMAND_PREFIX}${rateLimitedAnalysisId}`,
        idempotencyKey: `probe:${verificationOperationId}`,
        requestHash: `probe:${verificationOperationId}`,
      },
    ]);
    await probeDatabase.insert(marketAnalysis).values({
      id: rateLimitedAnalysisId,
      workspaceId: rateLimitedWorkspaceId,
      operationId: analysisOperationId,
      mediaBrandId,
      visualOwnerInstrumentId: instrumentId,
      contentLocale: "en",
      normalizedRequest: request,
      requestFingerprint: rateLimitedRequestFingerprint,
      templateFingerprint,
      instrumentProfileFingerprint: "instrument-profile:rate-limited",
      verificationIntentId: verificationOperationId,
      verificationIntentVersion: 1,
    });
    const claimed = await claimOperationExecution(
      probeDatabase,
      rateLimitedWorkspaceId,
      {
        id: verificationOperationId,
        claimedBy: commandOwner(verificationOperationId),
        now: new Date(),
        leaseExpiresAt: new Date(Date.now() + 60_000),
      },
    );
    if (claimed.status !== "claimed") throw new Error("PROBE_CLAIM_FAILED");

    const settled = await persistMarketVerification(probeDatabase, {
      workspaceId: rateLimitedWorkspaceId,
      operationId: verificationOperationId,
      marketAnalysisId: rateLimitedAnalysisId,
      claimedBy: commandOwner(verificationOperationId),
      operationVersion: claimed.operation.version,
      request,
      requestFingerprint: rateLimitedRequestFingerprint,
      templateFingerprint,
      verificationIntentId: verificationOperationId,
      verificationIntentVersion: 1,
      outcomes,
    });
    const persisted = await getMarketSnapshotWithSeries(
      probeDatabase,
      rateLimitedWorkspaceId,
      settled.snapshotId,
    );
    if (!persisted) throw new Error("PROBE_RATE_LIMITED_SNAPSHOT_MISSING");
    const [settledOperation] = await probeDatabase
      .select({ lifecycle: operation.lifecycle })
      .from(operation)
      .where(eq(operation.id, verificationOperationId));
    const audit = await probeDatabase.execute(sql`
      select series.descriptor_identity as identity,
             series.outcome,
             series.failure_code,
             series.retry_classification,
             series.warnings,
             snapshot.status as snapshot_status
        from market_snapshot_series series
        join market_snapshot snapshot on snapshot.id = series.market_snapshot_id
       where series.market_snapshot_id = ${settled.snapshotId}::uuid
       order by series.position
    `);
    console.log(
      `market rate-limited settlement snapshot=${persisted.snapshot.status} operation=${settledOperation?.lifecycle} audit=${JSON.stringify(audit.rows)}`,
    );

    assert.equal(settled.status, "unverified");
    assert.equal(persisted.snapshot.status, "unverified");
    assert.equal(settledOperation?.lifecycle, "failed");
    const failedSeries = persisted.series.find(
      (entry) => entry.descriptorIdentity === "controlled:rate-limited",
    );
    assert.equal(failedSeries?.outcome, "failed");
    assert.equal(failedSeries?.failureCode, "MARKET_SERIES_UNAVAILABLE");
    assert.equal(failedSeries?.retryClassification, "retryable");
    assert.ok(failedSeries?.warnings.includes("provider_rate_limited"));
    assert.equal(
      persisted.series.find(
        (entry) => entry.descriptorIdentity === "binance:BTCUSDT",
      )?.outcome,
      "succeeded",
    );
    throw rollbackFixture;
  });
}

function boundedStepProbe() {
  const stepIds: string[] = [];
  const realtimeIds: string[] = [];
  const step = {
    realtime: {
      publish: async (id: string, _channel: unknown, message: unknown) => {
        realtimeIds.push(id);
        assert.ok(JSON.stringify(message).length < 1_024);
      },
    },
    run: async (id: string, execute: () => Promise<unknown>) => {
      stepIds.push(id);
      const result = id.startsWith("claim-market-")
        ? { operationVersion: 2, status: "claimed" as const }
        : id.startsWith("notify-market-analysis-cache-")
          ? "accepted"
          : await execute();
      const serialized = JSON.stringify(result);
      assert.ok(serialized.length < 4_096, `${id} returned unbounded metadata`);
      assert.doesNotMatch(
        serialized,
        /"(?:analysis|bytes|points|rows)"|base64/iu,
      );
      return result;
    },
    sleep: async (id: string) => {
      stepIds.push(id);
    },
  };
  return { realtimeIds, step, stepIds };
}

async function proveConsolidatedHandlerBoundaries() {
  const client = new Inngest({ id: `market-boundary-${randomUUID()}` });
  const eventTimestamp = new Date("2026-09-09T12:00:00.000Z").getTime();
  const handlerEvent = {
    data: {
      marketAnalysisId: randomUUID(),
      operationId: randomUUID(),
      schemaVersion: 1 as const,
      workspaceId: randomUUID(),
    },
    ts: eventTimestamp,
  };

  for (const scenario of [
    {
      expectedNotifications: 1,
      result: {
        detachedMediaAssetIds: [] as string[],
        replay: false,
        settled: true,
        snapshotId: randomUUID(),
        status: "verified" as const,
      },
    },
    {
      expectedNotifications: 0,
      result: {
        detachedMediaAssetIds: [] as string[],
        replay: false,
        settled: false,
        snapshotId: null,
        status: "superseded" as const,
      },
    },
  ]) {
    let observedTimestamp = 0;
    const [registered] = createMarketVerificationFunctions(
      client,
      undefined as never,
      async (_runtime, input) => {
        observedTimestamp = input.eventTimestamp;
        return scenario.result;
      },
    );
    if (!registered) throw new Error("MARKET_VERIFICATION_HANDLER_MISSING");
    const handler = (
      registered as unknown as { fn: (input: never) => Promise<unknown> }
    ).fn;
    const probe = boundedStepProbe();
    await handler({
      attempt: 0,
      event: handlerEvent,
      maxAttempts: 4,
      step: probe.step,
    } as never);
    assert.equal(observedTimestamp, eventTimestamp);
    assert.equal(
      probe.stepIds.filter((id) =>
        id.startsWith("notify-market-analysis-cache-"),
      ).length,
      scenario.expectedNotifications,
    );
    assert.equal(
      probe.stepIds.filter((id) => id === "verify-market-series-and-settle")
        .length,
      1,
    );
    assert.equal(
      probe.stepIds.some((id) => id.startsWith("fetch-market-series-")),
      false,
    );
  }

  const chartScenarios = [
    { expectedNotifications: 1, result: { status: "rendered" as const } },
    { expectedNotifications: 1, result: { status: "replayed" as const } },
    {
      expectedNotifications: 1,
      result: { settled: true, status: "superseded" as const },
    },
    {
      expectedNotifications: 0,
      result: { settled: false, status: "superseded" as const },
    },
    { expectedNotifications: 0, result: { status: "lost" as const } },
  ];
  for (const scenario of chartScenarios) {
    const [registered] = createMarketChartRenderFunctions(
      client,
      undefined as never,
      (async () => scenario.result) as never,
    );
    if (!registered) throw new Error("MARKET_CHART_HANDLER_MISSING");
    const handler = (
      registered as unknown as { fn: (input: never) => Promise<unknown> }
    ).fn;
    const probe = boundedStepProbe();
    await handler({
      event: {
        data: {
          ...handlerEvent.data,
          marketChartRenderId: randomUUID(),
        },
      },
      step: probe.step,
    } as never);
    assert.equal(
      probe.stepIds.filter((id) =>
        id.startsWith("notify-market-analysis-cache-"),
      ).length,
      scenario.expectedNotifications,
    );
    assert.equal(
      probe.stepIds.filter(
        (id) => id === "render-store-and-attach-market-chart",
      ).length,
      1,
    );
    assert.equal(
      probe.stepIds.some((id) =>
        [
          "load-market-chart-render-input",
          "render-market-chart-png",
          "store-market-chart-png",
          "cleanup-losing-market-chart-render",
        ].includes(id),
      ),
      false,
    );
  }
}

const rollbackFixture = new Error("ROLLBACK_MARKET_SETTLEMENT_PROBE_FIXTURE");

try {
  await proveConsolidatedHandlerBoundaries();
  for (const scenario of [
    executeProbeTransaction,
    executeMixedGranularityTransaction,
    executeRateLimitedTransaction,
  ]) {
    try {
      await scenario();
    } catch (error) {
      if (error !== rollbackFixture) throw error;
    }
  }
  assert.equal(
    await database.db.$count(
      workspace,
      inArray(workspace.id, [
        workspaceId,
        mixedGranularityWorkspaceId,
        rateLimitedWorkspaceId,
      ]),
    ),
    0,
  );
  console.log(
    "market verification settlement probe handler-boundaries=bounded committed-notify=true chart-replay-supersession-cleanup-contained=true local-db=true fixture-rollback=true initial-unverified-not-current=true failed-refresh-preserves-current=true failed-refresh-evidence=true admission-preserves=true failure-preserves=true cancellation-preserves=true success-atomic=true chart-spec-and-output-format-preserved=true downstream-artifacts-cleared=true detached-media-postcommit=true cleanup-scheduled=3 replay-safe=true stale-lease-safe=true supersession-safe=true supersession-before-load-safe=true late-settlement-safe=true mixed-granularity-window-owns-points=true mixed-granularity-chart-renderable=true rate-limited-series-settled=true rate-limited-snapshot-persisted=true rate-limited-retry-after-bounded=true status=pass",
  );
} finally {
  await database.close();
}
