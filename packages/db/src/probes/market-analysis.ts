import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  MARKET_CHART_SPEC_SCHEMA_VERSION,
  MARKET_GENERATION_COMMAND_PREFIX,
  type MarketChartSpec,
  MEDIA_DERIVATION_PURPOSES,
  type NormalizedMarketRequest,
  OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
  operationCommandKind,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, eq, inArray, sql } from "drizzle-orm";
import { DatabaseError } from "pg";

import type { Transaction } from "../executor";
import { createDb } from "../index";
import {
  approveMarketChart,
  approveMarketDesign,
  approveMarketStory,
  createOwnedMarketAnalysis,
  MARKET_CHART_RENDER_COMMAND,
  MARKET_VERIFICATION_COMMAND,
  requestMarketVerification,
  retryMarketChartRender,
  updateMarketAnalysisStage,
} from "../repositories/market-analysis-commands";
import {
  attachMarketFinal,
  reconcileStaleMarketGenerations,
  releaseMarketFinalizationForRetry,
  retryMarketGenerationFinalization,
} from "../repositories/market-generation";
import { insertOrReloadMarketSnapshot } from "../repositories/market-snapshot";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { user } from "../schema/auth";
import {
  marketAnalysis,
  marketAnalysisHandoff,
  marketChartRender,
  marketGeneration,
  marketInstrument,
} from "../schema/market-analysis";
import {
  marketSnapshot,
  marketSnapshotSeries,
} from "../schema/market-snapshot";
import { mediaAsset } from "../schema/media-asset";
import { mediaBrand } from "../schema/media-brand";
import { mediaDerivation } from "../schema/media-derivation";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 4 });
const rollback = new Error("EXPECTED_MARKET_ANALYSIS_PROBE_ROLLBACK");
const ids = {
  workspace: randomUUID(),
  actor: `market-analysis-probe-${randomUUID()}`,
  brand: randomUUID(),
  instrument: randomUUID(),
  analysisOperation: randomUUID(),
  analysis: randomUUID(),
  snapshotOperation: randomUUID(),
  snapshot: randomUUID(),
  chartOperation: randomUUID(),
  chartRender: randomUUID(),
  supersededChartOperation: randomUUID(),
  supersededChartRender: randomUUID(),
  generationOperation: randomUUID(),
  chartAsset: randomUUID(),
  supersededChartAsset: randomUUID(),
  finalAsset: randomUUID(),
  handoff: randomUUID(),
};
const primaryMapping = {
  kind: "coinmarketcap_coin",
  provider: "coinmarketcap",
  coinId: 123,
  fallback: false,
} as const;
const request: NormalizedMarketRequest = {
  period: "7d",
  scale: "relative",
  series: [
    {
      descriptorIdentity: "controlled:industrial",
      role: "primary",
      displayName: "Industrial Token",
      symbol: "IND",
      controlledInstrumentId: ids.instrument,
      providerMappings: [primaryMapping],
    },
  ],
};
const observed: string[] = [];
const commandFixture = {
  workspace: randomUUID(),
  actor: `market-analysis-command-probe-${randomUUID()}`,
  brand: randomUUID(),
  instrument: randomUUID(),
  chartAsset: randomUUID(),
  finalAsset: randomUUID(),
};
const chartSpec = {
  schemaVersion: MARKET_CHART_SPEC_SCHEMA_VERSION,
  presetId: "probe",
  background: "#ffffff",
  seriesColors: { "controlled:industrial": "#111111" },
  legendPosition: "bottom",
  legendFormat: "symbol_change",
  lineWidth: 4,
  markers: "endpoints",
  gridStrength: "subtle",
} as const;

try {
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await insertFixture(tx);

      const first = await insertOrReloadMarketSnapshot(
        tx,
        ids.workspace,
        snapshotInput(),
      );
      const replay = await insertOrReloadMarketSnapshot(
        tx,
        ids.workspace,
        snapshotInput(),
      );
      assert.equal(first.status, "created");
      assert.equal(replay.status, "replayed");
      assert.equal(first.snapshot.id, replay.snapshot.id);
      observed.push("snapshot-insert-or-reload-replay");

      await tx
        .update(marketAnalysis)
        .set({ currentSnapshotId: first.snapshot.id })
        .where(eq(marketAnalysis.id, ids.analysis));

      await expectConstraint(
        tx,
        "ck_market_snapshot_immutable",
        sql`update market_snapshot set status = 'unverified' where id = ${ids.snapshot}`,
      );
      await expectConstraint(
        tx,
        "ck_market_snapshot_immutable",
        sql`delete from market_snapshot where id = ${ids.snapshot}`,
      );
      await expectConstraint(
        tx,
        "ck_market_snapshot_series_immutable",
        sql`update market_snapshot_series set position = 2 where market_snapshot_id = ${ids.snapshot}`,
      );
      await expectConstraint(
        tx,
        "ck_market_snapshot_series_immutable",
        sql`delete from market_snapshot_series where market_snapshot_id = ${ids.snapshot}`,
      );
      observed.push("immutable-snapshot-and-series-update-delete");

      await tx.insert(marketChartRender).values({
        id: ids.chartRender,
        workspaceId: ids.workspace,
        marketAnalysisId: ids.analysis,
        operationId: ids.chartOperation,
        expectedChartFingerprint: "chart-fingerprint",
        renderContractVersion: "probe-v1",
      });
      await tx.insert(marketChartRender).values({
        id: ids.supersededChartRender,
        workspaceId: ids.workspace,
        marketAnalysisId: ids.analysis,
        operationId: ids.supersededChartOperation,
        expectedChartFingerprint: "chart-fingerprint",
        renderContractVersion: "probe-v1",
      });
      await tx
        .update(marketAnalysis)
        .set({
          currentChartRenderId: ids.chartRender,
          currentChartMediaAssetId: null,
        })
        .where(eq(marketAnalysis.id, ids.analysis));
      const [queued] = await tx
        .select({
          chartRenderId: marketAnalysis.currentChartRenderId,
          chartMediaAssetId: marketAnalysis.currentChartMediaAssetId,
        })
        .from(marketAnalysis)
        .where(eq(marketAnalysis.id, ids.analysis));
      assert.equal(queued?.chartRenderId, ids.chartRender);
      assert.equal(queued?.chartMediaAssetId, null);
      observed.push("chart-render-current-queued-intent");

      await expectConstraint(
        tx,
        "ck_market_analysis_chart_checkpoint_pair",
        sql`update market_analysis set current_chart_render_id = null, current_chart_media_asset_id = ${ids.chartAsset} where id = ${ids.analysis}`,
      );
      await expectConstraint(
        tx,
        "ck_market_analysis_chart_checkpoint_match",
        sql`update market_analysis set chart_approval_fingerprint = 'wrong-chart-fingerprint' where id = ${ids.analysis}`,
      );
      observed.push("chart-render-pointer-and-fingerprint-guards");

      await expectConstraint(
        tx,
        "ck_market_chart_render_current_fence",
        sql`update market_chart_render set media_asset_id = ${ids.supersededChartAsset}, verified_at = ${new Date("2026-09-01T11:59:00.000Z")} where id = ${ids.supersededChartRender}`,
      );
      observed.push("chart-render-superseded-late-attachment-fence");

      await tx
        .update(marketChartRender)
        .set({
          mediaAssetId: ids.chartAsset,
          verifiedAt: new Date("2026-09-01T12:00:00.000Z"),
        })
        .where(eq(marketChartRender.id, ids.chartRender));
      const [attached] = await tx
        .select({
          chartRenderId: marketAnalysis.currentChartRenderId,
          chartMediaAssetId: marketAnalysis.currentChartMediaAssetId,
        })
        .from(marketAnalysis)
        .where(eq(marketAnalysis.id, ids.analysis));
      assert.equal(attached?.chartRenderId, ids.chartRender);
      assert.equal(attached?.chartMediaAssetId, ids.chartAsset);
      await expectConstraint(
        tx,
        "ck_market_analysis_chart_checkpoint_match",
        sql`update market_analysis set current_chart_render_id = ${ids.supersededChartRender} where id = ${ids.analysis}`,
      );
      await expectConstraint(
        tx,
        "ck_market_chart_render_media_fence",
        sql`update market_chart_render set media_asset_id = ${ids.finalAsset} where id = ${ids.chartRender}`,
      );
      observed.push("chart-render-verified-atomic-promotion-and-media-fence");

      await tx.insert(marketAnalysisHandoff).values({
        id: ids.handoff,
        workspaceId: ids.workspace,
        marketAnalysisId: ids.analysis,
        approvedFinalFingerprint: "final-fingerprint",
        marketSnapshotId: ids.snapshot,
        mediaBrandId: ids.brand,
        visualOwnerInstrumentId: ids.instrument,
        designFamilyKey: "growth",
        designVariantKey: "growth-a",
        contentLocale: "en",
        storyHeadline: "Market headline",
        storySupportingText: "Verified supporting text",
        verifiedFacts: [
          {
            attributionIdentity: "Binance",
            changePercent: "1.5",
            descriptorIdentity: "controlled:ind",
            endPrice: "101.5",
            position: 1,
            role: "primary",
            startPrice: "100",
          },
        ],
        templateFingerprint: "template-fingerprint",
        catalogFingerprint: "catalog-fingerprint",
        instrumentProfileFingerprint: "profile-fingerprint",
        brandPolicyFingerprint: "brand-policy-fingerprint",
        referenceSampleChecksum: "sample-checksum",
        footerLockupChecksum: "lockup-checksum",
        imageOptionKey: "probe-option",
        marketChartRenderId: ids.chartRender,
        chartMediaAssetId: ids.chartAsset,
        chartMediaChecksum: "chart-checksum",
        finalMediaAssetId: ids.finalAsset,
        finalMediaChecksum: "final-checksum",
        chartApprovalFingerprint: "chart-fingerprint",
        storyApprovalFingerprint: "story-fingerprint",
        designApprovalFingerprint: "design-fingerprint",
      });
      await expectConstraint(
        tx,
        "ck_market_analysis_handoff_immutable",
        sql`update market_analysis_handoff set story_headline = 'changed' where id = ${ids.handoff}`,
      );
      await expectConstraint(
        tx,
        "ck_market_analysis_handoff_immutable",
        sql`delete from market_analysis_handoff where id = ${ids.handoff}`,
      );
      observed.push("immutable-handoff-update-delete");

      await tx
        .update(marketAnalysis)
        .set({
          currentFinalMediaAssetId: ids.finalAsset,
          finalApprovalFingerprint: "final-fingerprint",
          finalApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          finalApprovedBy: ids.actor,
          status: "completed",
          completedAt: new Date("2026-09-01T12:01:00.000Z"),
          completedBy: ids.actor,
        })
        .where(eq(marketAnalysis.id, ids.analysis));
      await expectConstraint(
        tx,
        "ck_market_analysis_completed_immutable",
        sql`update market_analysis set story_headline = 'changed' where id = ${ids.analysis}`,
      );
      await expectConstraint(
        tx,
        "ck_market_analysis_completed_immutable",
        sql`delete from market_analysis where id = ${ids.analysis}`,
      );
      observed.push("completed-transition-update-delete-guard");

      await tx.insert(outboxEvent).values({
        workspaceId: ids.workspace,
        operationId: ids.generationOperation,
        eventType: OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
        schemaVersion: 1,
        payload: {
          schemaVersion: 1,
          workspaceId: ids.workspace,
          operationId: ids.generationOperation,
          marketAnalysisId: ids.analysis,
          marketGenerationId: randomUUID(),
        },
      });
      await expectConstraint(
        tx,
        "uq_outbox_event_market_generation_live_wake",
        sql`insert into outbox_event (workspace_id, operation_id, event_type, schema_version, payload) values (${ids.workspace}, ${ids.generationOperation}, ${OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME}, 1, ${JSON.stringify({ schemaVersion: 1, workspaceId: ids.workspace, operationId: ids.generationOperation })}::jsonb)`,
      );
      observed.push("database-unique-market-generation-wake");

      assert.deepEqual(MEDIA_DERIVATION_PURPOSES, [
        "sharp_brand_logo",
        "market_analysis_footer_lockup",
      ]);
      assert.equal(
        operationCommandKind("market-generation:probe"),
        "market-generation",
      );
      observed.push("closed-contracts");
      throw rollback;
    }),
    rollback,
  );

  await proveRollbackScopedCommandMatrix();
  await proveAtomicCreateVerification();
  await proveConcurrentCommandMatrix();
  await proveGenerationSettlementAndAttachFence();
  await proveGenerationFinalizationRetryEpochReplay();

  console.log(`market analysis probe passed: ${observed.join(", ")}`);
} finally {
  await cleanupConcurrentCommandFixture();
  await database.close();
}

async function proveRollbackScopedCommandMatrix() {
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await insertCommandFixture(tx);

      const verifyAnalysis = await insertCommandAnalysis(tx, "verify-new");
      const verifyInput = verificationInput(verifyAnalysis, 1, "verify-new");
      const verifyCreated = await requestMarketVerification(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        verifyInput,
      );
      assert.equal(verifyCreated.status, "updated");
      const verifyReplay = await requestMarketVerification(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        verifyInput,
      );
      assert.equal(verifyReplay.status, "replayed");
      assert.equal(verifyReplay.operationId, verifyCreated.operationId);
      const verifyMismatch = await requestMarketVerification(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        { ...verifyInput, requestHash: "verify-new-mismatch" },
      );
      assert.equal(verifyMismatch.status, "idempotency_mismatch");
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        verifyInput.idempotencyKey,
        { operations: 1, outbox: 1, checkpoints: 0 },
      );
      await completeCommandAnalysis(tx, verifyAnalysis);
      const verifyCompletedReplay = await requestMarketVerification(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        verifyInput,
      );
      assert.equal(verifyCompletedReplay.status, "replayed");
      const verifyCompletedInput = verificationInput(
        verifyAnalysis,
        2,
        "verify-completed-new",
      );
      const verifyCompleted = await requestMarketVerification(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        verifyCompletedInput,
      );
      assert.equal(verifyCompleted.status, "completed");
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        verifyCompletedInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );

      const verifyStaleAnalysis = await insertCommandAnalysis(
        tx,
        "verify-stale",
      );
      const verifyStaleInput = verificationInput(
        verifyStaleAnalysis,
        0,
        "verify-stale",
      );
      const verifyStale = await requestMarketVerification(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        verifyStaleInput,
      );
      assert.equal(verifyStale.status, "conflict");
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        verifyStaleInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );
      observed.push(
        "verify-new-replay-mismatch-completed-stale-zero-row-admission",
      );

      const chartAnalysis = await insertCommandAnalysis(tx, "chart-new", {
        ready: true,
      });
      await tx
        .update(marketAnalysis)
        .set({
          storyHeadline: "Stale story",
          storySupportingText: "Stale supporting text",
          storyApprovalFingerprint: "stale-story",
          storyApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          storyApprovedBy: commandFixture.actor,
          designFamilyKey: "stale-design",
          designVariantKey: "stale-variant",
          outputFormat: "portrait",
          operatorDirection: "stale direction",
          imageOptionKey: "stale-image-option",
          designApprovalFingerprint: "stale-design",
          designApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          designApprovedBy: commandFixture.actor,
          currentFinalMediaAssetId: commandFixture.finalAsset,
          finalApprovalFingerprint: "stale-final",
          finalApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          finalApprovedBy: commandFixture.actor,
        })
        .where(eq(marketAnalysis.id, chartAnalysis));
      const materialChartSpec = { ...chartSpec, background: "#f5f5f5" };
      const chartInput = chartRenderInput(chartAnalysis, 1, "chart-new", {
        chartSpec: materialChartSpec,
      });
      const chartCreated = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartInput,
      );
      assert.equal(chartCreated.status, "updated");
      assert.deepEqual(
        chartCreated.analysis?.currentChartSpec,
        materialChartSpec,
      );
      assert.equal(chartCreated.analysis?.storyHeadline, null);
      assert.equal(chartCreated.analysis?.designFamilyKey, null);
      assert.equal(chartCreated.analysis?.currentFinalMediaAssetId, null);
      const chartReplay = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartInput,
      );
      assert.equal(chartReplay.status, "replayed");
      assert.equal(chartReplay.operationId, chartCreated.operationId);
      const chartMismatch = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        { ...chartInput, requestHash: "chart-new-mismatch" },
      );
      assert.equal(chartMismatch.status, "idempotency_mismatch");
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        chartInput.idempotencyKey,
        { operations: 1, outbox: 1, checkpoints: 1 },
      );
      await completeCommandAnalysis(tx, chartAnalysis);
      const chartCompletedReplay = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartInput,
      );
      assert.equal(chartCompletedReplay.status, "replayed");
      const chartCompletedInput = chartRenderInput(
        chartAnalysis,
        2,
        "chart-completed-new",
      );
      const chartCompleted = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartCompletedInput,
      );
      assert.equal(chartCompleted.status, "completed");
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        chartCompletedInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );

      const chartStaleAnalysis = await insertCommandAnalysis(
        tx,
        "chart-stale",
        { ready: true },
      );
      const chartStaleInput = chartRenderInput(
        chartStaleAnalysis,
        0,
        "chart-stale",
      );
      const chartStale = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartStaleInput,
      );
      assert.equal(chartStale.status, "conflict");
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        chartStaleInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );

      const chartNotReadyAnalysis = await insertCommandAnalysis(
        tx,
        "chart-not-ready",
      );
      const chartNotReadyInput = chartRenderInput(
        chartNotReadyAnalysis,
        1,
        "chart-not-ready",
      );
      const chartNotReady = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartNotReadyInput,
      );
      assert.equal(chartNotReady.status, "not_ready");
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        chartNotReadyInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );

      const chartNoopAnalysis = await insertCommandAnalysis(tx, "chart-noop", {
        ready: true,
      });
      await tx
        .update(marketAnalysis)
        .set({
          storyHeadline: "Keep headline",
          storySupportingText: "Keep supporting text",
          storyApprovalFingerprint: "keep-story",
          storyApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          storyApprovedBy: commandFixture.actor,
        })
        .where(eq(marketAnalysis.id, chartNoopAnalysis));
      const chartNoop = await approveMarketChart(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        chartRenderInput(chartNoopAnalysis, 1, "chart-noop", {
          chartSpec: { ...chartSpec, presetId: "renamed-only" },
        }),
      );
      assert.equal(chartNoop.status, "updated");
      assert.equal(chartNoop.analysis?.storyHeadline, "Keep headline");
      assert.equal(chartNoop.analysis?.storyApprovalFingerprint, "keep-story");

      const retryAnalysis = await insertCommandAnalysis(tx, "chart-retry", {
        chartApprovalFingerprint: "chart-retry-fingerprint",
      });
      const retryInput = chartRenderInput(retryAnalysis, 1, "chart-retry", {
        chartFingerprint: "chart-retry-fingerprint",
      });
      const retryCreated = await retryMarketChartRender(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        retryInput,
      );
      assert.equal(retryCreated.status, "updated");
      assert.equal(
        retryCreated.analysis?.chartApprovalFingerprint,
        "chart-retry-fingerprint",
      );
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        retryInput.idempotencyKey,
        { operations: 1, outbox: 1, checkpoints: 1 },
      );

      const retryNotReadyAnalysis = await insertCommandAnalysis(
        tx,
        "chart-retry-not-ready",
        { chartApprovalFingerprint: "different-fingerprint" },
      );
      const retryNotReadyInput = chartRenderInput(
        retryNotReadyAnalysis,
        1,
        "chart-retry-not-ready",
      );
      const retryNotReady = await retryMarketChartRender(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        retryNotReadyInput,
      );
      assert.equal(retryNotReady.status, "not_ready");
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        retryNotReadyInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );
      observed.push(
        "chart-atomic-material-save-invalidation-replay-mismatch-completed-stale-readiness-retry-counts",
      );

      const storyAnalysis = await insertCommandAnalysis(tx, "story-atomic", {
        chartApprovalFingerprint: "story-chart-approved",
      });
      await tx
        .update(marketAnalysis)
        .set({
          storyHeadline: "Old headline",
          storySupportingText: "Old supporting text",
          designFamilyKey: "old-design",
          designVariantKey: "old-variant",
          outputFormat: "portrait",
          operatorDirection: "old direction",
          imageOptionKey: "old-image-option",
          designApprovalFingerprint: "old-design",
          designApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          designApprovedBy: commandFixture.actor,
          currentFinalMediaAssetId: commandFixture.finalAsset,
          finalApprovalFingerprint: "old-final",
          finalApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
          finalApprovedBy: commandFixture.actor,
        })
        .where(eq(marketAnalysis.id, storyAnalysis));
      const storyInput = {
        analysisId: storyAnalysis,
        expectedVersion: 1,
        headline: "Material headline",
        supportingText: "Material supporting text",
        fingerprint: "story-material-fingerprint",
      };
      const storyUpdated = await approveMarketStory(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        storyInput,
      );
      assert.equal(storyUpdated.status, "updated");
      assert.equal(storyUpdated.analysis?.storyHeadline, storyInput.headline);
      assert.equal(
        storyUpdated.analysis?.storySupportingText,
        storyInput.supportingText,
      );
      assert.equal(storyUpdated.analysis?.designFamilyKey, null);
      assert.equal(storyUpdated.analysis?.currentFinalMediaAssetId, null);
      const storyReplay = await approveMarketStory(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        storyInput,
      );
      assert.equal(storyReplay.status, "replayed");
      const storyConflict = await approveMarketStory(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        { ...storyInput, headline: "Different", expectedVersion: 1 },
      );
      assert.equal(storyConflict.status, "conflict");
      const storyNotReadyId = await insertCommandAnalysis(
        tx,
        "story-not-ready",
      );
      const storyNotReady = await approveMarketStory(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        { ...storyInput, analysisId: storyNotReadyId },
      );
      assert.equal(storyNotReady.status, "not_ready");
      const storyCompletedId = await insertCommandAnalysis(
        tx,
        "story-completed",
        { chartApprovalFingerprint: "story-completed-chart" },
      );
      await completeCommandAnalysis(tx, storyCompletedId);
      const storyCompleted = await approveMarketStory(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        { ...storyInput, analysisId: storyCompletedId },
      );
      assert.equal(storyCompleted.status, "completed");
      observed.push(
        "story-atomic-material-save-invalidation-exact-replay-conflict-not-ready-completed-zero-outbox",
      );

      const designAnalysis = await insertCommandAnalysis(tx, "design-material");
      const designVersion = await prepareDesignAnalysis(tx, designAnalysis, {
        familyKey: "old-family",
        variantKey: "old-variant",
        fingerprint: "old-design-fingerprint",
      });
      const designInput = designApprovalInput(
        designAnalysis,
        designVersion,
        "design-material",
      );
      const designOperations = await fixtureOperationCount(tx);
      const designUpdated = await approveMarketDesign(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        designInput,
      );
      assert.equal(designUpdated.status, "updated");
      assert.equal(
        designUpdated.analysis?.designFamilyKey,
        designInput.material.familyKey,
      );
      assert.equal(designUpdated.analysis?.currentFinalMediaAssetId, null);
      assert.equal(designUpdated.analysis?.finalApprovalFingerprint, null);
      assert.equal(designUpdated.analysis?.version, designVersion + 1);
      const designReplay = await approveMarketDesign(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        designInput,
      );
      assert.equal(designReplay.status, "replayed");
      assert.equal(designReplay.analysis?.version, designVersion + 1);
      assert.equal(await fixtureOperationCount(tx), designOperations);

      const designNoopAnalysis = await insertCommandAnalysis(tx, "design-noop");
      const designNoopInput = designApprovalInput(
        designNoopAnalysis,
        2,
        "design-noop",
      );
      const designNoopVersion = await prepareDesignAnalysis(
        tx,
        designNoopAnalysis,
        {
          familyKey: designNoopInput.material.familyKey,
          variantKey: designNoopInput.material.variantKey,
          fingerprint: designNoopInput.fingerprint,
        },
      );
      assert.equal(designNoopVersion, designNoopInput.expectedVersion);
      const designNoop = await approveMarketDesign(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        designNoopInput,
      );
      assert.equal(designNoop.status, "replayed");
      assert.equal(designNoop.analysis?.version, designNoopVersion);

      const designStaleAnalysis = await insertCommandAnalysis(
        tx,
        "design-stale",
      );
      const designStaleVersion = await prepareDesignAnalysis(
        tx,
        designStaleAnalysis,
      );
      const designStaleInput = designApprovalInput(
        designStaleAnalysis,
        designStaleVersion - 1,
        "design-stale",
      );
      assert.equal(
        (
          await approveMarketDesign(
            tx,
            commandFixture.workspace,
            commandFixture.actor,
            designStaleInput,
          )
        ).status,
        "conflict",
      );

      const designNotReadyAnalysis = await insertCommandAnalysis(
        tx,
        "design-not-ready",
      );
      const designNotReadyInput = designApprovalInput(
        designNotReadyAnalysis,
        1,
        "design-not-ready",
      );
      assert.equal(
        (
          await approveMarketDesign(
            tx,
            commandFixture.workspace,
            commandFixture.actor,
            designNotReadyInput,
          )
        ).status,
        "not_ready",
      );

      const designCompletedAnalysis = await insertCommandAnalysis(
        tx,
        "design-completed",
      );
      const designCompletedVersion = await prepareDesignAnalysis(
        tx,
        designCompletedAnalysis,
      );
      await completeCommandAnalysis(tx, designCompletedAnalysis);
      const designCompletedInput = designApprovalInput(
        designCompletedAnalysis,
        designCompletedVersion,
        "design-completed",
      );
      assert.equal(
        (
          await approveMarketDesign(
            tx,
            commandFixture.workspace,
            commandFixture.actor,
            designCompletedInput,
          )
        ).status,
        "completed",
      );
      observed.push(
        "design-normalized-atomic-material-noop-replay-version-completed-not-ready-invalidation-zero-operations",
      );

      const verifyCasAnalysis = await insertCommandAnalysis(
        tx,
        "verify-cas-rollback",
      );
      const verifyCasInput = verificationInput(
        verifyCasAnalysis,
        1,
        "verify-cas-rollback",
      );
      const chartCasAnalysis = await insertCommandAnalysis(
        tx,
        "chart-cas-rollback",
        { ready: true },
      );
      const chartCasInput = chartRenderInput(
        chartCasAnalysis,
        1,
        "chart-cas-rollback",
      );
      const storyCasAnalysis = await insertCommandAnalysis(
        tx,
        "story-cas-rollback",
        { chartApprovalFingerprint: "story-cas-chart" },
      );
      const storyCasFingerprint = "story-cas-fingerprint";
      const designCasAnalysis = await insertCommandAnalysis(
        tx,
        "design-cas-rollback",
      );
      const designCasVersion = await prepareDesignAnalysis(
        tx,
        designCasAnalysis,
      );
      const designCasInput = designApprovalInput(
        designCasAnalysis,
        designCasVersion,
        "design-cas-rollback",
      );
      await installCasMissTrigger(
        tx,
        verifyCasInput.verificationIntentId,
        chartCasInput.chartRenderId,
        storyCasFingerprint,
        designCasInput.fingerprint,
      );
      await assert.rejects(
        requestMarketVerification(
          tx,
          commandFixture.workspace,
          commandFixture.actor,
          verifyCasInput,
        ),
        /market verification CAS failed after admission/u,
      );
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        verifyCasInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );
      await assertAnalysisVersion(tx, verifyCasAnalysis, 1);
      await assert.rejects(
        approveMarketChart(
          tx,
          commandFixture.workspace,
          commandFixture.actor,
          chartCasInput,
        ),
        /market chart render CAS failed after admission/u,
      );
      await assertWorkPackageCounts(
        tx,
        MARKET_CHART_RENDER_COMMAND,
        chartCasInput.idempotencyKey,
        { operations: 0, outbox: 0, checkpoints: 0 },
      );
      await assertAnalysisVersion(tx, chartCasAnalysis, 1);
      await assert.rejects(
        approveMarketDesign(
          tx,
          commandFixture.workspace,
          commandFixture.actor,
          designCasInput,
        ),
        /market design approval CAS failed after admission/u,
      );
      await assertAnalysisVersion(tx, designCasAnalysis, designCasVersion);
      const storyCas = await approveMarketStory(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        {
          analysisId: storyCasAnalysis,
          expectedVersion: 1,
          headline: "Should not persist",
          supportingText: "Should not persist",
          fingerprint: storyCasFingerprint,
        },
      );
      assert.equal(storyCas.status, "conflict");
      const [storyCasRow] = await tx
        .select({
          headline: marketAnalysis.storyHeadline,
          fingerprint: marketAnalysis.storyApprovalFingerprint,
        })
        .from(marketAnalysis)
        .where(eq(marketAnalysis.id, storyCasAnalysis));
      assert.equal(storyCasRow?.headline, null);
      assert.equal(storyCasRow?.fingerprint, null);
      await assertAnalysisVersion(tx, storyCasAnalysis, 1);
      observed.push(
        "verify-chart-story-design-post-lock-cas-full-rollback-zero-partial-rows",
      );

      throw rollback;
    }),
    rollback,
  );
}

async function proveAtomicCreateVerification() {
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await insertCommandFixture(tx);

      const analysisId = randomUUID();
      const created = await createOwnedMarketAnalysis(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        {
          ...commandIdentity("atomic-create", "market-analysis:create"),
          analysisId,
          mediaBrandId: commandFixture.brand,
          visualOwnerInstrumentId: commandFixture.instrument,
          contentLocale: "en",
          outputFormat: "portrait",
          normalizedRequest: request,
          requestFingerprint: "atomic-create-request-fingerprint",
          currentChartSpec: chartSpec,
          templateFingerprint: "command-probe-template-fingerprint",
          catalogFingerprint: null,
          instrumentProfileFingerprint: "command-probe-profile-fingerprint",
          verification: {
            ...commandIdentity(
              "atomic-create-verify",
              MARKET_VERIFICATION_COMMAND,
            ),
            verificationIntentId: randomUUID(),
          },
        },
      );
      assert.equal(created.status, "updated");
      assert.ok(created.operationId);
      await assertAnalysisVersion(tx, analysisId, 2);
      await assertWorkPackageCounts(
        tx,
        "market-analysis:create",
        "atomic-create",
        { operations: 1, outbox: 0, checkpoints: 0 },
      );
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        "atomic-create-verify",
        { operations: 1, outbox: 1, checkpoints: 0 },
      );

      const change = {
        normalizedRequest: request,
        requestFingerprint: "atomic-create-request-fingerprint",
        outputFormat: "portrait" as const,
        mediaBrandId: commandFixture.brand,
        visualOwnerInstrumentId: commandFixture.instrument,
        visualOwnerChartSpec: chartSpec,
        instrumentProfileFingerprint: "command-probe-profile-fingerprint",
        contentLocale: "en" as const,
      };
      const noop = await updateMarketAnalysisStage(
        tx,
        commandFixture.workspace,
        commandFixture.actor,
        {
          analysisId,
          expectedVersion: 2,
          change,
          verification: {
            ...commandIdentity(
              "atomic-update-verify",
              MARKET_VERIFICATION_COMMAND,
            ),
            verificationIntentId: randomUUID(),
          },
        },
      );
      assert.equal(noop.status, "updated");
      assert.ok(noop.operationId);
      assert.equal(
        noop.analysis?.requestFingerprint,
        change.requestFingerprint,
      );
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        "atomic-update-verify",
        { operations: 1, outbox: 1, checkpoints: 0 },
      );

      const abandonedId = randomUUID();
      await assert.rejects(
        tx.transaction(async (nested) => {
          await createOwnedMarketAnalysis(
            nested,
            commandFixture.workspace,
            commandFixture.actor,
            {
              ...commandIdentity(
                "atomic-create-abandoned",
                "market-analysis:create",
              ),
              analysisId: abandonedId,
              mediaBrandId: commandFixture.brand,
              visualOwnerInstrumentId: commandFixture.instrument,
              contentLocale: "en",
              outputFormat: "portrait",
              normalizedRequest: request,
              requestFingerprint: "atomic-create-abandoned-fingerprint",
              currentChartSpec: chartSpec,
              templateFingerprint: "command-probe-template-fingerprint",
              catalogFingerprint: null,
              instrumentProfileFingerprint: "command-probe-profile-fingerprint",
              verification: {
                ...commandIdentity(
                  "atomic-create-abandoned-verify",
                  MARKET_VERIFICATION_COMMAND,
                ),
                verificationIntentId: randomUUID(),
              },
            },
          );
          throw rollback;
        }),
        rollback,
      );
      const abandoned = await tx
        .select({ id: marketAnalysis.id })
        .from(marketAnalysis)
        .where(eq(marketAnalysis.id, abandonedId));
      assert.equal(abandoned.length, 0);
      await assertWorkPackageCounts(
        tx,
        MARKET_VERIFICATION_COMMAND,
        "atomic-create-abandoned-verify",
        { operations: 0, outbox: 0, checkpoints: 0 },
      );

      observed.push("atomic-create-update-verification-single-transaction");
      throw rollback;
    }),
    rollback,
  );
}

async function proveConcurrentCommandMatrix() {
  const analyses = await database.db.transaction(async (tx) => {
    await insertCommandFixture(tx);
    return {
      verifySame: await insertCommandAnalysis(tx, "concurrent-verify-same"),
      verifyMismatch: await insertCommandAnalysis(
        tx,
        "concurrent-verify-mismatch",
      ),
      verifyDifferent: await insertCommandAnalysis(
        tx,
        "concurrent-verify-different",
      ),
      chartSame: await insertCommandAnalysis(tx, "concurrent-chart-same", {
        chartApprovalFingerprint: "concurrent-chart-same-fingerprint",
      }),
      chartMismatch: await insertCommandAnalysis(
        tx,
        "concurrent-chart-mismatch",
        { chartApprovalFingerprint: "concurrent-chart-mismatch-fingerprint" },
      ),
      chartDifferent: await insertCommandAnalysis(
        tx,
        "concurrent-chart-different",
        { chartApprovalFingerprint: "concurrent-chart-different-fingerprint" },
      ),
    };
  });

  const verifySameInput = verificationInput(
    analyses.verifySame,
    1,
    "concurrent-verify-same",
  );
  assertStatuses(
    await Promise.all([
      requestMarketVerification(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        verifySameInput,
      ),
      requestMarketVerification(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        verifySameInput,
      ),
    ]),
    ["replayed", "updated"],
  );

  const verifyMismatchA = verificationInput(
    analyses.verifyMismatch,
    1,
    "concurrent-verify-mismatch",
  );
  const verifyMismatchB = {
    ...verifyMismatchA,
    operationId: randomUUID(),
    verificationIntentId: randomUUID(),
    requestHash: "concurrent-verify-mismatch-b",
  };
  assertStatuses(
    await Promise.all([
      requestMarketVerification(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        verifyMismatchA,
      ),
      requestMarketVerification(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        verifyMismatchB,
      ),
    ]),
    ["idempotency_mismatch", "updated"],
  );

  const verifyDifferentA = verificationInput(
    analyses.verifyDifferent,
    1,
    "concurrent-verify-different-a",
  );
  const verifyDifferentB = verificationInput(
    analyses.verifyDifferent,
    1,
    "concurrent-verify-different-b",
  );
  assertStatuses(
    await Promise.all([
      requestMarketVerification(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        verifyDifferentA,
      ),
      requestMarketVerification(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        verifyDifferentB,
      ),
    ]),
    ["conflict", "updated"],
  );

  const chartSameInput = chartRenderInput(
    analyses.chartSame,
    1,
    "concurrent-chart-same",
    { chartFingerprint: "concurrent-chart-same-fingerprint" },
  );
  assertStatuses(
    await Promise.all([
      retryMarketChartRender(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        chartSameInput,
      ),
      retryMarketChartRender(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        chartSameInput,
      ),
    ]),
    ["replayed", "updated"],
  );

  const chartMismatchA = chartRenderInput(
    analyses.chartMismatch,
    1,
    "concurrent-chart-mismatch",
    { chartFingerprint: "concurrent-chart-mismatch-fingerprint" },
  );
  const chartMismatchB = {
    ...chartMismatchA,
    operationId: randomUUID(),
    chartRenderId: randomUUID(),
    requestHash: "concurrent-chart-mismatch-b",
  };
  assertStatuses(
    await Promise.all([
      retryMarketChartRender(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        chartMismatchA,
      ),
      retryMarketChartRender(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        chartMismatchB,
      ),
    ]),
    ["idempotency_mismatch", "updated"],
  );

  const chartDifferentA = chartRenderInput(
    analyses.chartDifferent,
    1,
    "concurrent-chart-different-a",
    { chartFingerprint: "concurrent-chart-different-fingerprint" },
  );
  const chartDifferentB = chartRenderInput(
    analyses.chartDifferent,
    1,
    "concurrent-chart-different-b",
    { chartFingerprint: "concurrent-chart-different-fingerprint" },
  );
  assertStatuses(
    await Promise.all([
      retryMarketChartRender(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        chartDifferentA,
      ),
      retryMarketChartRender(
        database.db,
        commandFixture.workspace,
        commandFixture.actor,
        chartDifferentB,
      ),
    ]),
    ["conflict", "updated"],
  );

  await database.db.transaction(async (tx) => {
    for (const [commandType, input, checkpoints] of [
      [MARKET_VERIFICATION_COMMAND, verifySameInput, 0],
      [MARKET_VERIFICATION_COMMAND, verifyMismatchA, 0],
      [MARKET_CHART_RENDER_COMMAND, chartSameInput, 1],
      [MARKET_CHART_RENDER_COMMAND, chartMismatchA, 1],
    ] as const) {
      await assertWorkPackageCounts(tx, commandType, input.idempotencyKey, {
        operations: 1,
        outbox: 1,
        checkpoints,
      });
    }
    for (const [commandType, winner, loser, checkpoints] of [
      [MARKET_VERIFICATION_COMMAND, verifyDifferentA, verifyDifferentB, 0],
      [MARKET_CHART_RENDER_COMMAND, chartDifferentA, chartDifferentB, 1],
    ] as const) {
      const winnerCounts = await workPackageCounts(
        tx,
        commandType,
        winner.idempotencyKey,
      );
      const loserCounts = await workPackageCounts(
        tx,
        commandType,
        loser.idempotencyKey,
      );
      assert.equal(winnerCounts.operations + loserCounts.operations, 1);
      assert.equal(winnerCounts.outbox + loserCounts.outbox, 1);
      assert.equal(
        winnerCounts.checkpoints + loserCounts.checkpoints,
        checkpoints,
      );
    }
    for (const analysisId of Object.values(analyses)) {
      await assertAnalysisVersion(tx, analysisId, 2);
    }
  });
  observed.push(
    "verify-and-chart-concurrent-same-key-mismatch-different-key-one-package",
  );
}

async function insertCommandFixture(tx: Transaction) {
  await tx.insert(user).values({
    id: commandFixture.actor,
    email: `${commandFixture.actor}@example.invalid`,
    name: "Market Analysis Command Probe",
  });
  await tx.insert(workspace).values({
    id: commandFixture.workspace,
    name: `Market Analysis Command Probe ${commandFixture.workspace}`,
  });
  await tx.insert(mediaBrand).values({
    id: commandFixture.brand,
    workspaceId: commandFixture.workspace,
    key: "command-probe-brand",
    name: "Command Probe Brand",
    sortOrder: 1,
  });
  await tx.insert(marketInstrument).values({
    id: commandFixture.instrument,
    workspaceId: commandFixture.workspace,
    key: "command-probe-instrument",
    name: "Command Probe Instrument",
    symbol: "CPR",
    providerMappings: [primaryMapping],
  });
  await tx.insert(mediaAsset).values({
    id: commandFixture.chartAsset,
    workspaceId: commandFixture.workspace,
    kind: "market_chart_render",
    objectKey: `probe/${commandFixture.chartAsset}.png`,
    mimeType: "image/png",
    declaredBytes: 100,
    actualBytes: 100,
    checksum: "command-probe-chart-checksum",
    width: 1080,
    height: 1350,
    lifecycle: "verified",
    verifiedAt: new Date("2026-09-01T12:00:00.000Z"),
  });
  await tx.insert(mediaAsset).values({
    id: commandFixture.finalAsset,
    workspaceId: commandFixture.workspace,
    kind: "image_final",
    objectKey: `probe/${commandFixture.finalAsset}.png`,
    mimeType: "image/png",
    declaredBytes: 100,
    actualBytes: 100,
    checksum: "command-probe-final-checksum",
    width: 1080,
    height: 1350,
    lifecycle: "verified",
    verifiedAt: new Date("2026-09-01T12:00:00.000Z"),
  });
}

async function insertCommandAnalysis(
  tx: Transaction,
  label: string,
  options: {
    ready?: boolean;
    chartApprovalFingerprint?: string;
  } = {},
) {
  const analysisId = randomUUID();
  const operationId = randomUUID();
  await tx.insert(operation).values({
    id: operationId,
    workspaceId: commandFixture.workspace,
    actor: commandFixture.actor,
    commandType: "market-analysis:create",
    idempotencyKey: `create-${label}`,
    requestHash: `create-${label}-hash`,
    lifecycle: "succeeded",
  });
  await tx.insert(marketAnalysis).values({
    id: analysisId,
    workspaceId: commandFixture.workspace,
    operationId,
    mediaBrandId: commandFixture.brand,
    visualOwnerInstrumentId: commandFixture.instrument,
    contentLocale: "en",
    normalizedRequest: request,
    requestFingerprint: `${label}-request-fingerprint`,
    currentChartSpec: options.ready ? chartSpec : null,
    chartApprovalFingerprint: options.chartApprovalFingerprint,
    chartApprovedAt: options.chartApprovalFingerprint
      ? new Date("2026-09-01T12:00:00.000Z")
      : undefined,
    chartApprovedBy: options.chartApprovalFingerprint
      ? commandFixture.actor
      : undefined,
    templateFingerprint: "command-probe-template-fingerprint",
    instrumentProfileFingerprint: "command-probe-profile-fingerprint",
  });
  if (options.ready) {
    const snapshotOperationId = randomUUID();
    const snapshotId = randomUUID();
    await tx.insert(operation).values({
      id: snapshotOperationId,
      workspaceId: commandFixture.workspace,
      actor: commandFixture.actor,
      commandType: `market-verification:probe-${label}`,
      idempotencyKey: `snapshot-${label}`,
      requestHash: `snapshot-${label}-hash`,
      lifecycle: "succeeded",
    });
    await insertOrReloadMarketSnapshot(
      tx,
      commandFixture.workspace,
      snapshotInputFor(analysisId, snapshotId, snapshotOperationId),
    );
    await tx
      .update(marketAnalysis)
      .set({ currentSnapshotId: snapshotId })
      .where(eq(marketAnalysis.id, analysisId));
  }
  return analysisId;
}

function snapshotInputFor(
  analysisId: string,
  snapshotId: string,
  snapshotOperationId: string,
) {
  const input = snapshotInput();
  return {
    snapshot: {
      ...input.snapshot,
      id: snapshotId,
      marketAnalysisId: analysisId,
      operationId: snapshotOperationId,
      verificationIntentId: snapshotOperationId,
    },
    series: input.series.map((series) => ({
      ...series,
      controlledInstrumentId: commandFixture.instrument,
    })),
  };
}

async function completeCommandAnalysis(tx: Transaction, analysisId: string) {
  await tx
    .update(marketAnalysis)
    .set({
      currentFinalMediaAssetId: commandFixture.finalAsset,
      finalApprovalFingerprint: `${analysisId}-final-fingerprint`,
      finalApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
      finalApprovedBy: commandFixture.actor,
      status: "completed",
      completedAt: new Date("2026-09-01T12:01:00.000Z"),
      completedBy: commandFixture.actor,
    })
    .where(eq(marketAnalysis.id, analysisId));
}

function commandIdentity(label: string, commandType: string) {
  return {
    operationId: randomUUID(),
    actor: commandFixture.actor,
    commandType,
    idempotencyKey: label,
    requestHash: `${label}-hash`,
    requestId: null,
  };
}

function verificationInput(
  analysisId: string,
  expectedVersion: number,
  label: string,
) {
  return {
    ...commandIdentity(label, MARKET_VERIFICATION_COMMAND),
    analysisId,
    expectedVersion,
    verificationIntentId: randomUUID(),
  };
}

function chartRenderInput(
  analysisId: string,
  expectedVersion: number,
  label: string,
  options: { chartFingerprint?: string; chartSpec?: MarketChartSpec } = {},
) {
  return {
    ...commandIdentity(label, MARKET_CHART_RENDER_COMMAND),
    analysisId,
    expectedVersion,
    chartRenderId: randomUUID(),
    chartFingerprint: options.chartFingerprint ?? `${label}-fingerprint`,
    chartSpec: options.chartSpec ?? chartSpec,
    renderContractVersion: "command-probe-v1",
  };
}

function designApprovalInput(
  analysisId: string,
  expectedVersion: number,
  label: string,
) {
  return {
    analysisId,
    expectedVersion,
    fingerprint: `${label}-design-fingerprint`,
    storyFingerprint: `${analysisId}-story-fingerprint`,
    material: {
      familyKey: "phone",
      variantKey: "phone-centered",
    },
  };
}

async function prepareDesignAnalysis(
  tx: Transaction,
  analysisId: string,
  material: {
    familyKey?: string;
    variantKey?: string;
    fingerprint?: string;
  } = {},
) {
  const chartOperationId = randomUUID();
  const chartRenderId = randomUUID();
  const chartFingerprint = `${analysisId}-chart-fingerprint`;
  await tx.insert(operation).values({
    id: chartOperationId,
    workspaceId: commandFixture.workspace,
    actor: commandFixture.actor,
    commandType: `market-chart-render:design-probe-${analysisId}`,
    idempotencyKey: `design-chart-${analysisId}`,
    requestHash: `design-chart-${analysisId}-hash`,
    lifecycle: "succeeded",
  });
  await tx.insert(marketChartRender).values({
    id: chartRenderId,
    workspaceId: commandFixture.workspace,
    marketAnalysisId: analysisId,
    operationId: chartOperationId,
    expectedChartFingerprint: chartFingerprint,
    renderContractVersion: "design-probe-v1",
  });
  await tx
    .update(marketAnalysis)
    .set({
      currentChartSpec: chartSpec,
      currentChartRenderId: chartRenderId,
      chartApprovalFingerprint: chartFingerprint,
      chartApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
      chartApprovedBy: commandFixture.actor,
    })
    .where(eq(marketAnalysis.id, analysisId));
  await tx
    .update(marketChartRender)
    .set({
      mediaAssetId: commandFixture.chartAsset,
      verifiedAt: new Date("2026-09-01T12:00:00.000Z"),
    })
    .where(eq(marketChartRender.id, chartRenderId));
  const [prepared] = await tx
    .update(marketAnalysis)
    .set({
      storyHeadline: "Approved Story",
      storySupportingText: "Approved supporting line",
      storyApprovalFingerprint: `${analysisId}-story-fingerprint`,
      storyApprovedAt: new Date("2026-09-01T12:00:00.000Z"),
      storyApprovedBy: commandFixture.actor,
      designFamilyKey: material.familyKey,
      designVariantKey: material.variantKey,
      designApprovalFingerprint: material.fingerprint,
      designApprovedAt: material.fingerprint
        ? new Date("2026-09-01T12:00:00.000Z")
        : null,
      designApprovedBy: material.fingerprint ? commandFixture.actor : null,
      currentFinalMediaAssetId: material.fingerprint
        ? commandFixture.finalAsset
        : null,
      finalApprovalFingerprint: material.fingerprint
        ? "old-final-fingerprint"
        : null,
      finalApprovedAt: material.fingerprint
        ? new Date("2026-09-01T12:00:00.000Z")
        : null,
      finalApprovedBy: material.fingerprint ? commandFixture.actor : null,
    })
    .where(eq(marketAnalysis.id, analysisId))
    .returning({ version: marketAnalysis.version });
  assert.ok(prepared);
  return prepared.version;
}

async function fixtureOperationCount(tx: Transaction) {
  const rows = await tx
    .select({ id: operation.id })
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, commandFixture.workspace),
        eq(operation.actor, commandFixture.actor),
      ),
    );
  return rows.length;
}

async function workPackageCounts(
  tx: Transaction,
  commandType: string,
  idempotencyKey: string,
) {
  const operations = await tx
    .select({ id: operation.id })
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, commandFixture.workspace),
        eq(operation.actor, commandFixture.actor),
        eq(operation.commandType, commandType),
        eq(operation.idempotencyKey, idempotencyKey),
      ),
    );
  if (operations.length === 0) {
    return { operations: 0, outbox: 0, checkpoints: 0 };
  }
  const operationIds = operations.map((row) => row.id);
  const outbox = await tx
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(inArray(outboxEvent.operationId, operationIds));
  const checkpoints = await tx
    .select({ id: marketChartRender.id })
    .from(marketChartRender)
    .where(inArray(marketChartRender.operationId, operationIds));
  return {
    operations: operations.length,
    outbox: outbox.length,
    checkpoints: checkpoints.length,
  };
}

async function assertWorkPackageCounts(
  tx: Transaction,
  commandType: string,
  idempotencyKey: string,
  expected: { operations: number; outbox: number; checkpoints: number },
) {
  assert.deepEqual(
    await workPackageCounts(tx, commandType, idempotencyKey),
    expected,
  );
}

async function assertAnalysisVersion(
  tx: Transaction,
  analysisId: string,
  expectedVersion: number,
) {
  const [row] = await tx
    .select({ version: marketAnalysis.version })
    .from(marketAnalysis)
    .where(eq(marketAnalysis.id, analysisId));
  assert.equal(row?.version, expectedVersion);
}

function assertStatuses(
  results: readonly { status: string }[],
  expected: readonly string[],
) {
  assert.deepEqual(
    results.map((result) => result.status).sort(),
    [...expected].sort(),
  );
}

async function installCasMissTrigger(
  tx: Transaction,
  verificationIntentId: string,
  chartRenderId: string,
  storyFingerprint: string,
  designFingerprint: string,
) {
  await tx.execute(
    sql.raw(`
      create function probe_force_market_analysis_cas_miss() returns trigger
      language plpgsql as $$
      begin
        if old.workspace_id = '${commandFixture.workspace}'::uuid
          and (
            new.verification_intent_id = '${verificationIntentId}'::uuid
            or new.current_chart_render_id = '${chartRenderId}'::uuid
            or new.story_approval_fingerprint = '${storyFingerprint}'
            or new.design_approval_fingerprint = '${designFingerprint}'
          )
        then
          return null;
        end if;
        return new;
      end;
      $$
    `),
  );
  await tx.execute(
    sql.raw(`
      create trigger aaa_probe_force_market_analysis_cas_miss
      before update on market_analysis
      for each row execute function probe_force_market_analysis_cas_miss()
    `),
  );
}

async function cleanupConcurrentCommandFixture() {
  await database.db.transaction(async (tx) => {
    await tx
      .update(marketAnalysis)
      .set({
        currentSnapshotId: null,
        currentChartRenderId: null,
        currentChartMediaAssetId: null,
        chartApprovalFingerprint: null,
        chartApprovedAt: null,
        chartApprovedBy: null,
      })
      .where(eq(marketAnalysis.workspaceId, commandFixture.workspace));
    await tx
      .delete(outboxEvent)
      .where(eq(outboxEvent.workspaceId, commandFixture.workspace));
    await tx
      .delete(marketChartRender)
      .where(eq(marketChartRender.workspaceId, commandFixture.workspace));
    await tx
      .delete(marketSnapshotSeries)
      .where(eq(marketSnapshotSeries.workspaceId, commandFixture.workspace));
    await tx
      .delete(marketSnapshot)
      .where(eq(marketSnapshot.workspaceId, commandFixture.workspace));
    await tx
      .delete(marketAnalysis)
      .where(eq(marketAnalysis.workspaceId, commandFixture.workspace));
    await tx
      .delete(mediaAsset)
      .where(eq(mediaAsset.workspaceId, commandFixture.workspace));
    await tx
      .delete(operation)
      .where(eq(operation.workspaceId, commandFixture.workspace));
    await tx
      .delete(marketInstrument)
      .where(eq(marketInstrument.workspaceId, commandFixture.workspace));
    await tx
      .delete(mediaBrand)
      .where(eq(mediaBrand.workspaceId, commandFixture.workspace));
    await tx
      .delete(workspace)
      .where(eq(workspace.id, commandFixture.workspace));
    await tx.delete(user).where(eq(user.id, commandFixture.actor));
  });
}

async function proveGenerationSettlementAndAttachFence() {
  const settlement = {
    workspace: randomUUID(),
    actor: `market-generation-settlement-probe-${randomUUID()}`,
    brand: randomUUID(),
    instrument: randomUUID(),
    analysisOperation: randomUUID(),
    analysis: randomUUID(),
    chartAsset: randomUUID(),
    originalAsset: randomUUID(),
    openOperation: randomUUID(),
    openGeneration: randomUUID(),
    openAttempt: randomUUID(),
    supersededOperation: randomUUID(),
    supersededGeneration: randomUUID(),
    attachedAsset: randomUUID(),
  };
  const leaseExpired = new Date("2026-09-01T10:00:00.000Z");
  const now = new Date("2026-09-01T12:00:00.000Z");
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await insertSettlementFixture(tx, settlement, leaseExpired);

      const settled = await reconcileStaleMarketGenerations(
        tx,
        settlement.workspace,
        now,
      );
      const settledLifecycles = new Map(
        settled.map((row) => [row.operationId, row.lifecycle]),
      );
      assert.equal(settled.length, 2);
      assert.equal(settledLifecycles.get(settlement.openOperation), "unknown");
      assert.equal(
        settledLifecycles.get(settlement.supersededOperation),
        "cancelled",
      );
      const [usage] = await tx
        .select({
          costAuthority: aiUsageEvent.costAuthority,
          status: aiUsageEvent.status,
        })
        .from(aiUsageEvent)
        .where(eq(aiUsageEvent.operationId, settlement.openOperation));
      assert.equal(usage?.status, "unknown");
      assert.equal(usage?.costAuthority, "unknown");
      const [attempt] = await tx
        .select({ outcome: operationAttempt.outcome })
        .from(operationAttempt)
        .where(eq(operationAttempt.id, settlement.openAttempt));
      assert.equal(attempt?.outcome, "ambiguous");
      const lifecycles = await tx
        .select({ id: operation.id, lifecycle: operation.lifecycle })
        .from(operation)
        .where(
          inArray(operation.id, [
            settlement.openOperation,
            settlement.supersededOperation,
          ]),
        );
      assert.equal(
        lifecycles.find((row) => row.id === settlement.openOperation)
          ?.lifecycle,
        "unknown",
      );
      assert.equal(
        lifecycles.find((row) => row.id === settlement.supersededOperation)
          ?.lifecycle,
        "cancelled",
      );
      observed.push(
        "generation-settlement-pending-usage-unknown-noncurrent-cancelled",
      );

      const fenced = await attachMarketFinal(tx, settlement.workspace, {
        claim: {
          claimedBy: settlement.actor,
          expectedVersion: 1,
          operationId: settlement.supersededOperation,
        },
        final: {
          actualBytes: 100,
          checksum: "attached-checksum",
          height: 1350,
          mediaAssetId: settlement.attachedAsset,
          mimeType: "image/png",
          objectKey: `probe/${settlement.attachedAsset}.png`,
          width: 1080,
        },
        generationId: settlement.supersededGeneration,
      });
      assert.equal(fenced.status, "superseded");
      const attached = await tx
        .select({ id: mediaAsset.id })
        .from(mediaAsset)
        .where(eq(mediaAsset.id, settlement.attachedAsset));
      assert.equal(attached.length, 0);
      const derivations = await tx
        .select({ id: mediaDerivation.id })
        .from(mediaDerivation)
        .where(eq(mediaDerivation.workspaceId, settlement.workspace));
      assert.equal(derivations.length, 0);
      const [generation] = await tx
        .select({ finalMediaAssetId: marketGeneration.finalMediaAssetId })
        .from(marketGeneration)
        .where(eq(marketGeneration.id, settlement.supersededGeneration));
      assert.equal(generation?.finalMediaAssetId, null);
      observed.push("generation-attach-stale-claim-fence");
      throw rollback;
    }),
    rollback,
  );
}

async function proveGenerationFinalizationRetryEpochReplay() {
  const settlement = {
    workspace: randomUUID(),
    actor: `market-generation-retry-probe-${randomUUID()}`,
    brand: randomUUID(),
    instrument: randomUUID(),
    analysisOperation: randomUUID(),
    analysis: randomUUID(),
    chartAsset: randomUUID(),
    originalAsset: randomUUID(),
    openOperation: randomUUID(),
    openGeneration: randomUUID(),
    openAttempt: randomUUID(),
    supersededOperation: randomUUID(),
    supersededGeneration: randomUUID(),
  };
  const leaseExpired = new Date("2026-09-01T10:00:00.000Z");
  const wakes = (tx: Transaction, operationId: string) =>
    tx
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.operationId, operationId),
          eq(
            outboxEvent.eventType,
            OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
          ),
        ),
      );
  const receipt = (tx: Transaction) =>
    tx
      .select({
        epoch: marketGeneration.finalizationRetryEpoch,
        receipt: marketGeneration.latestFinalizationRetryReceipt,
      })
      .from(marketGeneration)
      .where(eq(marketGeneration.id, settlement.supersededGeneration));
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await insertSettlementFixture(tx, settlement, leaseExpired);

      const released = await releaseMarketFinalizationForRetry(
        tx,
        settlement.workspace,
        {
          claimedBy: settlement.actor,
          expectedVersion: 1,
          operationId: settlement.supersededOperation,
        },
      );
      assert.equal(released?.lifecycle, "queued");
      assert.equal(released?.claimedBy, null);
      assert.equal(released?.version, 2);
      assert.equal((await wakes(tx, settlement.supersededOperation)).length, 0);

      const updated = await retryMarketGenerationFinalization(
        tx,
        settlement.workspace,
        settlement.actor,
        {
          operationId: settlement.supersededOperation,
          expectedEpoch: 0,
          receipt: "receipt-a",
        },
      );
      assert.deepEqual(updated, { status: "updated", epoch: 1 });
      assert.deepEqual(await receipt(tx), [{ epoch: 1, receipt: "receipt-a" }]);
      assert.equal((await wakes(tx, settlement.supersededOperation)).length, 1);

      const replayed = await retryMarketGenerationFinalization(
        tx,
        settlement.workspace,
        settlement.actor,
        {
          operationId: settlement.supersededOperation,
          expectedEpoch: 0,
          receipt: "receipt-b",
        },
      );
      assert.deepEqual(replayed, { status: "conflict", epoch: 1 });
      assert.deepEqual(await receipt(tx), [{ epoch: 1, receipt: "receipt-a" }]);
      assert.equal((await wakes(tx, settlement.supersededOperation)).length, 1);

      await releaseMarketFinalizationForRetry(tx, settlement.workspace, {
        claimedBy: settlement.actor,
        expectedVersion: 1,
        operationId: settlement.openOperation,
      });
      const withoutOriginal = await retryMarketGenerationFinalization(
        tx,
        settlement.workspace,
        settlement.actor,
        {
          operationId: settlement.openOperation,
          expectedEpoch: 0,
          receipt: "receipt-c",
        },
      );
      assert.deepEqual(withoutOriginal, { status: "conflict", epoch: 0 });
      assert.equal((await wakes(tx, settlement.openOperation)).length, 0);
      observed.push("generation-finalization-retry-epoch-replay");
      throw rollback;
    }),
    rollback,
  );
}

async function insertSettlementFixture(
  tx: Transaction,
  settlement: {
    actor: string;
    analysis: string;
    analysisOperation: string;
    brand: string;
    chartAsset: string;
    instrument: string;
    openAttempt: string;
    openGeneration: string;
    openOperation: string;
    originalAsset: string;
    supersededGeneration: string;
    supersededOperation: string;
    workspace: string;
  },
  leaseExpired: Date,
) {
  await tx.insert(user).values({
    id: settlement.actor,
    email: `${settlement.actor}@example.invalid`,
    name: "Market Generation Settlement Probe",
  });
  await tx.insert(workspace).values({
    id: settlement.workspace,
    name: `Market Generation Settlement Probe ${settlement.workspace}`,
  });
  await tx.insert(mediaBrand).values({
    id: settlement.brand,
    workspaceId: settlement.workspace,
    key: "probe-brand",
    name: "Probe Brand",
    sortOrder: 1,
  });
  await tx.insert(marketInstrument).values({
    id: settlement.instrument,
    workspaceId: settlement.workspace,
    key: "industrial",
    name: "Industrial Token",
    symbol: "IND",
    providerMappings: [primaryMapping],
  });
  await tx.insert(operation).values([
    {
      id: settlement.analysisOperation,
      workspaceId: settlement.workspace,
      actor: settlement.actor,
      commandType: "market-analysis:create",
      idempotencyKey: "settlement-create",
      requestHash: "settlement-create-hash",
    },
    {
      id: settlement.openOperation,
      workspaceId: settlement.workspace,
      actor: settlement.actor,
      commandType: `${MARKET_GENERATION_COMMAND_PREFIX}analysis`,
      idempotencyKey: "settlement-open",
      requestHash: "settlement-open-hash",
      lifecycle: "running",
      claimedBy: settlement.actor,
      claimedAt: leaseExpired,
      leaseExpiresAt: leaseExpired,
    },
    {
      id: settlement.supersededOperation,
      workspaceId: settlement.workspace,
      actor: settlement.actor,
      commandType: `${MARKET_GENERATION_COMMAND_PREFIX}analysis`,
      idempotencyKey: "settlement-superseded",
      requestHash: "settlement-superseded-hash",
      lifecycle: "running",
      claimedBy: settlement.actor,
      claimedAt: leaseExpired,
      leaseExpiresAt: leaseExpired,
    },
  ]);
  await tx.insert(mediaAsset).values([
    {
      id: settlement.chartAsset,
      workspaceId: settlement.workspace,
      kind: "market_chart_render",
      objectKey: `probe/${settlement.chartAsset}.png`,
      mimeType: "image/png",
      declaredBytes: 100,
      actualBytes: 100,
      checksum: "settlement-chart-checksum",
      width: 1080,
      height: 1350,
      lifecycle: "verified",
      verifiedAt: leaseExpired,
    },
    {
      id: settlement.originalAsset,
      workspaceId: settlement.workspace,
      kind: "image_provider_original",
      objectKey: `probe/${settlement.originalAsset}.png`,
      mimeType: "image/png",
      declaredBytes: 100,
      actualBytes: 100,
      checksum: "settlement-original-checksum",
      width: 1080,
      height: 1350,
      lifecycle: "verified",
      verifiedAt: leaseExpired,
    },
  ]);
  await tx.insert(marketAnalysis).values({
    id: settlement.analysis,
    workspaceId: settlement.workspace,
    operationId: settlement.analysisOperation,
    mediaBrandId: settlement.brand,
    visualOwnerInstrumentId: settlement.instrument,
    contentLocale: "en",
    normalizedRequest: request,
    requestFingerprint: "settlement-request-fingerprint",
    templateFingerprint: "template-fingerprint",
    instrumentProfileFingerprint: "profile-fingerprint",
  });
  await tx.insert(marketGeneration).values([
    {
      id: settlement.openGeneration,
      workspaceId: settlement.workspace,
      operationId: settlement.openOperation,
      marketAnalysisId: settlement.analysis,
      intentId: settlement.openOperation,
      intentVersion: 1,
      expectedDesignFingerprint: "design-fingerprint",
      imageOptionKey: "probe-option",
      referenceSampleKey: "sample-path",
      referenceSampleChecksum: "sample-checksum",
      footerLockupKey: "lockup-path",
      footerLockupChecksum: "lockup-checksum",
      chartMediaAssetId: settlement.chartAsset,
      chartMediaChecksum: "settlement-chart-checksum",
      outputWidth: 1080,
      outputHeight: 1350,
    },
    {
      id: settlement.supersededGeneration,
      workspaceId: settlement.workspace,
      operationId: settlement.supersededOperation,
      marketAnalysisId: settlement.analysis,
      intentId: settlement.supersededOperation,
      intentVersion: 1,
      expectedDesignFingerprint: "design-fingerprint",
      imageOptionKey: "probe-option",
      referenceSampleKey: "sample-path",
      referenceSampleChecksum: "sample-checksum",
      footerLockupKey: "lockup-path",
      footerLockupChecksum: "lockup-checksum",
      chartMediaAssetId: settlement.chartAsset,
      chartMediaChecksum: "settlement-chart-checksum",
      outputWidth: 1080,
      outputHeight: 1350,
      providerOriginalMediaAssetId: settlement.originalAsset,
    },
  ]);
  await tx
    .update(marketAnalysis)
    .set({ currentGenerationId: settlement.openGeneration })
    .where(eq(marketAnalysis.id, settlement.analysis));
  await tx.insert(operationAttempt).values({
    id: settlement.openAttempt,
    workspaceId: settlement.workspace,
    operationId: settlement.openOperation,
    attemptNumber: 1,
  });
  await tx.insert(aiUsageEvent).values({
    workspaceId: settlement.workspace,
    operationId: settlement.openOperation,
    operationAttemptId: settlement.openAttempt,
    invocationKey: "primary",
    taskKey: "market-analysis-brief",
    apiKind: "chat",
    backend: "remote",
    providerGateway: "openrouter",
    requestedModel: "probe-model",
  });
}

async function insertFixture(tx: Transaction) {
  await tx.insert(user).values({
    id: ids.actor,
    email: `${ids.actor}@example.invalid`,
    name: "Market Analysis Probe",
  });
  await tx.insert(workspace).values({
    id: ids.workspace,
    name: `Market Analysis Probe ${ids.workspace}`,
  });
  await tx.insert(mediaBrand).values({
    id: ids.brand,
    workspaceId: ids.workspace,
    key: "probe-brand",
    name: "Probe Brand",
    sortOrder: 1,
  });
  await tx.insert(marketInstrument).values({
    id: ids.instrument,
    workspaceId: ids.workspace,
    key: "industrial",
    name: "Industrial Token",
    symbol: "IND",
    providerMappings: request.series[0]?.providerMappings ?? [],
  });
  await tx.insert(operation).values([
    {
      id: ids.analysisOperation,
      workspaceId: ids.workspace,
      actor: ids.actor,
      commandType: "market-analysis:create",
      idempotencyKey: "create",
      requestHash: "create-hash",
    },
    {
      id: ids.snapshotOperation,
      workspaceId: ids.workspace,
      actor: ids.actor,
      commandType: "market-verification:probe",
      idempotencyKey: "verify",
      requestHash: "verify-hash",
    },
    {
      id: ids.chartOperation,
      workspaceId: ids.workspace,
      actor: ids.actor,
      commandType: "market-chart-render:probe",
      idempotencyKey: "chart",
      requestHash: "chart-hash",
    },
    {
      id: ids.supersededChartOperation,
      workspaceId: ids.workspace,
      actor: ids.actor,
      commandType: "market-chart-render:probe-superseded",
      idempotencyKey: "chart-superseded",
      requestHash: "chart-superseded-hash",
    },
    {
      id: ids.generationOperation,
      workspaceId: ids.workspace,
      actor: ids.actor,
      commandType: "market-generation:probe",
      idempotencyKey: "generate",
      requestHash: "generate-hash",
    },
  ]);
  await tx.insert(mediaAsset).values([
    {
      id: ids.chartAsset,
      workspaceId: ids.workspace,
      kind: "market_chart_render",
      objectKey: `probe/${ids.chartAsset}.png`,
      mimeType: "image/png",
      declaredBytes: 100,
      actualBytes: 100,
      checksum: "chart-checksum",
      width: 1080,
      height: 1350,
      lifecycle: "verified",
      verifiedAt: new Date("2026-09-01T12:00:00.000Z"),
    },
    {
      id: ids.finalAsset,
      workspaceId: ids.workspace,
      kind: "image_final",
      objectKey: `probe/${ids.finalAsset}.png`,
      mimeType: "image/png",
      declaredBytes: 100,
      actualBytes: 100,
      checksum: "final-checksum",
      width: 1080,
      height: 1350,
      lifecycle: "verified",
      verifiedAt: new Date("2026-09-01T12:00:00.000Z"),
    },
    {
      id: ids.supersededChartAsset,
      workspaceId: ids.workspace,
      kind: "market_chart_render",
      objectKey: `probe/${ids.supersededChartAsset}.png`,
      mimeType: "image/png",
      declaredBytes: 100,
      actualBytes: 100,
      checksum: "superseded-chart-checksum",
      width: 1080,
      height: 1350,
      lifecycle: "verified",
      verifiedAt: new Date("2026-09-01T11:59:00.000Z"),
    },
  ]);
  await tx.insert(marketAnalysis).values({
    id: ids.analysis,
    workspaceId: ids.workspace,
    operationId: ids.analysisOperation,
    mediaBrandId: ids.brand,
    visualOwnerInstrumentId: ids.instrument,
    contentLocale: "en",
    normalizedRequest: request,
    requestFingerprint: "request-fingerprint",
    chartApprovalFingerprint: "chart-fingerprint",
    chartApprovedAt: new Date("2026-09-01T11:00:00.000Z"),
    chartApprovedBy: ids.actor,
    templateFingerprint: "template-fingerprint",
    instrumentProfileFingerprint: "profile-fingerprint",
  });
}

function snapshotInput() {
  return {
    snapshot: {
      id: ids.snapshot,
      marketAnalysisId: ids.analysis,
      operationId: ids.snapshotOperation,
      verificationIntentId: ids.snapshotOperation,
      verificationIntentVersion: 1,
      normalizedRequest: request,
      requestFingerprint: "request-fingerprint",
      templateFingerprint: "template-fingerprint",
      period: "7d" as const,
      scale: "relative" as const,
      effectiveWindowStart: new Date("2026-08-25T12:00:00.000Z"),
      effectiveWindowEnd: new Date("2026-09-01T12:00:00.000Z"),
      fetchCompletedAt: new Date("2026-09-01T12:00:00.000Z"),
      status: "verified" as const,
      warnings: [],
    },
    series: [
      {
        position: 1,
        descriptorIdentity: "controlled:industrial",
        role: "primary" as const,
        controlledInstrumentId: ids.instrument,
        provider: "coinmarketcap" as const,
        mapping: primaryMapping,
        providerReference: "cmc:123",
        attributionIdentity: "coinmarketcap",
        points: [
          ["2026-08-25T12:00:00.000Z", "1.0"],
          ["2026-09-01T12:00:00.000Z", "1.2"],
        ] as const,
        coverageStart: new Date("2026-08-25T12:00:00.000Z"),
        coverageEnd: new Date("2026-09-01T12:00:00.000Z"),
        startPrice: "1.0",
        endPrice: "1.2",
        changePercent: "20.0",
        outcome: "succeeded" as const,
        warnings: [],
      },
    ],
  };
}

async function expectConstraint(
  tx: Transaction,
  expected: string,
  statement: ReturnType<typeof sql>,
) {
  await tx.execute(sql.raw(`savepoint ${expected}`));
  try {
    await tx.execute(statement);
  } catch (error) {
    await tx.execute(sql.raw(`rollback to savepoint ${expected}`));
    await tx.execute(sql.raw(`release savepoint ${expected}`));
    if (constraintName(error) === expected) return;
    throw error;
  }
  await tx.execute(sql.raw(`rollback to savepoint ${expected}`));
  await tx.execute(sql.raw(`release savepoint ${expected}`));
  throw new Error(`constraint ${expected} did not reject the mutation`);
}

function constraintName(error: unknown) {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof DatabaseError) return current.constraint;
    current = current.cause;
  }
  return undefined;
}
