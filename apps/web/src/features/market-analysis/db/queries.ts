import "server-only";

import {
  MARKET_CHART_OUTPUT_DIMENSIONS,
  MARKET_CHART_RENDER_CONTRACT_VERSION,
  type MarketChartRenderInput,
  persistedMarketChartSpecSchema,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { getCurrentMarketComparisonCatalog } from "@rz-chain-reporter/db/repositories/market-comparison-catalog";
import {
  marketAnalysis,
  marketAnalysisHandoff,
  marketChartDefault,
  marketChartRender,
  marketComparisonCatalog,
  marketComparisonCatalogState,
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
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import {
  decodeKeysetCursor,
  keysetPageOf,
} from "@/features/shared/lib/keyset-cursor";
import { customerEditorial } from "@/lib/customer-template.server";
import { MARKET_ANALYSIS_HISTORY_PAGE_SIZE } from "../constants";
import { hashPayload } from "../lib/fingerprints";
import { suggestMarketStories } from "../lib/story-suggestions";
import {
  defaultChartSpec,
  marketCompositionCatalog,
  marketTemplate,
  requireMarketTemplate,
} from "../lib/template";
import type {
  MarketAnalysisCoreProjection,
  MarketAnalysisDynamicOverlay,
  MarketAnalysisHistoryBaseRow,
  MarketAnalysisHistoryPage,
  MarketAnalysisReportCore,
  MarketAnalysisReportLive,
  MarketComparisonSearchInput,
  MarketComparisonSearchResult,
  MarketSeriesProjection,
  MarketSnapshotProjection,
  ReportMedia,
} from "../schemas/reads";
import { MARKET_COMPARISON_SEARCH_LIMIT } from "../schemas/reads";
import type { MarketAnalysisHistoryQuery } from "../schemas/search";

const marketAnalysisHistoryCursorSchema = z.strictObject({
  direction: z.enum(["older", "newer"]),
  updatedAt: z.iso.datetime(),
  id: z.uuid(),
});

async function ownedAnalysis(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisId: string,
) {
  const [row] = await executor
    .select({
      analysis: marketAnalysis,
      mediaBrandKey: mediaBrand.key,
      mediaBrandName: mediaBrand.name,
      visualOwnerKey: marketInstrument.key,
      visualOwnerName: marketInstrument.name,
      visualOwnerSymbol: marketInstrument.symbol,
    })
    .from(marketAnalysis)
    .innerJoin(operation, eq(operation.id, marketAnalysis.operationId))
    .innerJoin(mediaBrand, eq(mediaBrand.id, marketAnalysis.mediaBrandId))
    .innerJoin(
      marketInstrument,
      eq(marketInstrument.id, marketAnalysis.visualOwnerInstrumentId),
    )
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        eq(marketAnalysis.id, analysisId),
        eq(operation.actor, userId),
      ),
    );
  return row ?? null;
}

async function readMarketSnapshot(
  executor: Executor,
  workspaceId: string,
  snapshotId: string,
) {
  const [snapshot] = await executor
    .select()
    .from(marketSnapshot)
    .where(
      and(
        inWorkspace(marketSnapshot, workspaceId),
        eq(marketSnapshot.id, snapshotId),
      ),
    );
  if (!snapshot) return null;
  const series = await executor
    .select()
    .from(marketSnapshotSeries)
    .where(
      and(
        inWorkspace(marketSnapshotSeries, workspaceId),
        eq(marketSnapshotSeries.marketSnapshotId, snapshot.id),
      ),
    )
    .orderBy(asc(marketSnapshotSeries.position));
  const seriesProjection: MarketSeriesProjection[] = series.map((item) => ({
    descriptorIdentity: item.descriptorIdentity,
    role: item.role,
    outcome: item.outcome,
    startPrice: item.startPrice,
    endPrice: item.endPrice,
    changePercent: item.changePercent,
    failureCode: item.failureCode,
    warnings: item.warnings,
  }));
  const projection: MarketSnapshotProjection = {
    id: snapshot.id,
    status: snapshot.status,
    period: snapshot.period,
    scale: snapshot.scale,
    warnings: snapshot.warnings,
    series: seriesProjection,
  };
  return { projection, series, snapshot };
}

export async function readMarketAnalysisProjection(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisId: string,
): Promise<MarketAnalysisCoreProjection | null> {
  const owned = await ownedAnalysis(executor, workspaceId, userId, analysisId);
  if (!owned) return null;
  const analysis = owned.analysis;
  const [[generation], [verification], [chartRender], [chartDefault]] =
    await Promise.all([
      analysis.currentGenerationId
        ? executor
            .select({ generation: marketGeneration, operation })
            .from(marketGeneration)
            .innerJoin(
              operation,
              eq(operation.id, marketGeneration.operationId),
            )
            .where(
              and(
                inWorkspace(marketGeneration, workspaceId),
                eq(marketGeneration.id, analysis.currentGenerationId),
              ),
            )
        : Promise.resolve([]),
      analysis.verificationIntentId
        ? executor
            .select({
              id: operation.id,
              lifecycle: operation.lifecycle,
              snapshotId: marketSnapshot.id,
            })
            .from(operation)
            .leftJoin(
              marketSnapshot,
              and(
                inWorkspace(marketSnapshot, workspaceId),
                eq(marketSnapshot.operationId, operation.id),
                eq(marketSnapshot.marketAnalysisId, analysis.id),
              ),
            )
            .where(
              and(
                inWorkspace(operation, workspaceId),
                eq(operation.id, analysis.verificationIntentId),
              ),
            )
        : Promise.resolve([]),
      analysis.currentChartRenderId
        ? executor
            .select({ id: operation.id, lifecycle: operation.lifecycle })
            .from(marketChartRender)
            .innerJoin(
              operation,
              eq(operation.id, marketChartRender.operationId),
            )
            .where(
              and(
                inWorkspace(marketChartRender, workspaceId),
                eq(marketChartRender.id, analysis.currentChartRenderId),
              ),
            )
        : Promise.resolve([]),
      executor
        .select({ version: marketChartDefault.version })
        .from(marketChartDefault)
        .where(
          and(
            inWorkspace(marketChartDefault, workspaceId),
            eq(marketChartDefault.actorId, userId),
            eq(
              marketChartDefault.marketInstrumentId,
              analysis.visualOwnerInstrumentId,
            ),
          ),
        ),
    ]);
  const persistedChartSpec = persistedMarketChartSpecSchema.safeParse(
    analysis.currentChartSpec,
  );
  const effectiveChartSpec = persistedChartSpec.success
    ? persistedChartSpec.data
    : (defaultChartSpec(
        owned.visualOwnerKey,
        analysis.normalizedRequest.series.map(
          (item) => item.descriptorIdentity,
        ),
      )?.chartSpec ?? null);
  let snapshotProjection: MarketAnalysisCoreProjection["currentSnapshot"] =
    null;
  let chartRenderInput: MarketChartRenderInput | null = null;
  let seriesProjection: MarketSeriesProjection[] = [];
  if (analysis.currentSnapshotId) {
    const currentSnapshot = await readMarketSnapshot(
      executor,
      workspaceId,
      analysis.currentSnapshotId,
    );
    if (currentSnapshot) {
      const { projection, series, snapshot } = currentSnapshot;
      seriesProjection = [...projection.series];
      snapshotProjection = projection;
      if (
        effectiveChartSpec &&
        snapshot.effectiveWindowStart &&
        snapshot.effectiveWindowEnd
      ) {
        const byIdentity = new Map(
          analysis.normalizedRequest.series.map((item) => [
            item.descriptorIdentity,
            item,
          ]),
        );
        const renderSeries = series.flatMap((item) => {
          const descriptor = byIdentity.get(item.descriptorIdentity);
          if (!descriptor) return [];
          return [
            item.outcome === "succeeded"
              ? {
                  outcome: "succeeded" as const,
                  id: item.descriptorIdentity,
                  label: descriptor.displayName,
                  symbol: descriptor.symbol,
                  role: item.role,
                  points: (item.points ?? []).map(
                    (point) => [point[0], point[1]] as [string, string],
                  ),
                  changePercent: item.changePercent ?? "0",
                  warnings: [...item.warnings],
                  attributionIdentity: item.attributionIdentity,
                }
              : {
                  outcome: "failed" as const,
                  id: item.descriptorIdentity,
                  label: descriptor.displayName,
                  symbol: descriptor.symbol,
                  role: item.role,
                  warnings: [...item.warnings],
                  failureCode:
                    item.failureCode ?? "MARKET_PROVIDER_UNAVAILABLE",
                },
          ];
        });
        const effectiveWindowStart =
          snapshot.effectiveWindowStart.toISOString();
        const effectiveWindowEnd = snapshot.effectiveWindowEnd.toISOString();
        const checksum = hashPayload({
          effectiveWindowEnd,
          effectiveWindowStart,
          id: snapshot.id,
          period: snapshot.period,
          scale: snapshot.scale,
          series: renderSeries,
        });
        if (!marketTemplate.enabled) {
          throw new Error("MARKET_ANALYSIS_DISABLED");
        }
        const outputFormat =
          analysis.outputFormat ?? marketTemplate.defaults.outputFormat;
        const attributionIdentities = [
          ...new Set(
            series.flatMap((item) =>
              item.outcome === "succeeded" && item.attributionIdentity
                ? [item.attributionIdentity]
                : [],
            ),
          ),
        ].sort((left, right) => left.localeCompare(right, "en"));
        chartRenderInput = {
          renderContractVersion: MARKET_CHART_RENDER_CONTRACT_VERSION,
          contentLocale: analysis.contentLocale,
          outputFormat,
          dimensions: MARKET_CHART_OUTPUT_DIMENSIONS[outputFormat],
          snapshot: {
            id: snapshot.id,
            checksum,
            period: snapshot.period,
            scale: snapshot.scale,
            effectiveWindowStart,
            effectiveWindowEnd,
            series: renderSeries,
          },
          spec: effectiveChartSpec,
          attribution: attributionIdentities.map((identity) => ({
            required: true,
            chartLevel: true,
            identity,
            text: identity,
            hyperlinkRequired: false,
          })),
        };
      }
    }
  }
  const verificationResultSnapshot = verification?.snapshotId
    ? verification.snapshotId === snapshotProjection?.id
      ? snapshotProjection
      : ((
          await readMarketSnapshot(
            executor,
            workspaceId,
            verification.snapshotId,
          )
        )?.projection ?? null)
    : null;
  const facts = seriesProjection.flatMap((item) => {
    const requestSeries = analysis.normalizedRequest.series.find(
      (candidate) => candidate.descriptorIdentity === item.descriptorIdentity,
    );
    return item.outcome === "succeeded" &&
      item.startPrice &&
      item.endPrice &&
      item.changePercent &&
      requestSeries
      ? [
          {
            displayName: requestSeries.displayName,
            symbol: requestSeries.symbol,
            startPrice: item.startPrice,
            endPrice: item.endPrice,
            changePercent: item.changePercent,
          },
        ]
      : [];
  });
  return {
    id: analysis.id,
    status: analysis.status,
    version: analysis.version,
    mediaBrandId: analysis.mediaBrandId,
    mediaBrandKey: owned.mediaBrandKey,
    mediaBrandName: owned.mediaBrandName,
    visualOwnerInstrumentId: analysis.visualOwnerInstrumentId,
    visualOwnerKey: owned.visualOwnerKey,
    visualOwnerName: owned.visualOwnerName,
    visualOwnerSymbol: owned.visualOwnerSymbol,
    contentLocale: analysis.contentLocale,
    normalizedRequest: analysis.normalizedRequest,
    requestFingerprint: analysis.requestFingerprint,
    currentSnapshot: snapshotProjection,
    chartRenderInput,
    verification: verification
      ? {
          operationId: verification.id,
          lifecycle: verification.lifecycle,
          resultSnapshot: verificationResultSnapshot,
        }
      : null,
    chartRender: chartRender
      ? { operationId: chartRender.id, lifecycle: chartRender.lifecycle }
      : null,
    chartDefaultVersion: chartDefault?.version ?? null,
    currentChartSpec: effectiveChartSpec,
    currentChartRenderId: analysis.currentChartRenderId,
    currentChartMediaAssetId: analysis.currentChartMediaAssetId,
    storyHeadline: analysis.storyHeadline,
    storySupportingText: analysis.storySupportingText,
    designFamilyKey: analysis.designFamilyKey,
    designVariantKey: analysis.designVariantKey,
    outputFormat: analysis.outputFormat,
    operatorDirection: analysis.operatorDirection,
    imageOptionKey: analysis.imageOptionKey,
    currentFinalMediaAssetId: analysis.currentFinalMediaAssetId,
    generation: generation
      ? {
          briefSource: generation.generation.briefSource,
          canRetryFinalization:
            generation.operation.lifecycle === "queued" &&
            generation.generation.providerOriginalMediaAssetId !== null &&
            generation.generation.finalMediaAssetId === null,
          fallbackCode:
            generation.generation.fallbackCode === "MODEL_INVOCATION_FAILED" ||
            generation.generation.fallbackCode === "STRUCTURED_OUTPUT_INVALID"
              ? generation.generation.fallbackCode
              : null,
          finalMediaAssetId:
            generation.generation.finalMediaAssetId ===
            analysis.currentFinalMediaAssetId
              ? generation.generation.finalMediaAssetId
              : null,
          finalizationRetryEpoch: generation.generation.finalizationRetryEpoch,
          operationId: generation.operation.id,
          phase: generationPhase(generation),
          providerOriginalMediaAssetId:
            generation.generation.providerOriginalMediaAssetId,
        }
      : null,
    approvals: {
      chart: {
        fingerprint: analysis.chartApprovalFingerprint,
        approvedAt: analysis.chartApprovedAt,
        approvedBy: analysis.chartApprovedBy,
      },
      story: {
        fingerprint: analysis.storyApprovalFingerprint,
        approvedAt: analysis.storyApprovedAt,
        approvedBy: analysis.storyApprovedBy,
      },
      design: {
        fingerprint: analysis.designApprovalFingerprint,
        approvedAt: analysis.designApprovedAt,
        approvedBy: analysis.designApprovedBy,
      },
      final: {
        fingerprint: analysis.finalApprovalFingerprint,
        approvedAt: analysis.finalApprovedAt,
        approvedBy: analysis.finalApprovedBy,
      },
    },
    completedAt: analysis.completedAt,
    storySuggestions: snapshotProjection
      ? suggestMarketStories(
          analysis.contentLocale,
          analysis.normalizedRequest.scale,
          analysis.normalizedRequest.period,
          facts,
        )
      : [],
    eligiblePlatforms: customerEditorial.drafting.copy.platforms.map(
      ({ platform }) => platform,
    ),
    linkedDrafts: await executor
      .select({ draftId: platformDraft.id, platform: platformDraft.platform })
      .from(platformDraft)
      .innerJoin(
        marketAnalysisHandoff,
        eq(marketAnalysisHandoff.id, platformDraft.marketAnalysisHandoffId),
      )
      .where(
        and(
          inWorkspace(platformDraft, workspaceId),
          eq(marketAnalysisHandoff.marketAnalysisId, analysis.id),
          isNull(platformDraft.deletedAt),
        ),
      )
      .orderBy(asc(platformDraft.createdAt)),
  };
}

export async function readMarketAnalysisReportCore(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisId: string,
): Promise<MarketAnalysisReportCore | null> {
  const owned = await ownedAnalysis(executor, workspaceId, userId, analysisId);
  const analysis = owned?.analysis;
  if (
    !owned ||
    !analysis ||
    analysis.status !== "completed" ||
    !analysis.completedAt ||
    !analysis.completedBy ||
    !analysis.currentSnapshotId ||
    !analysis.currentChartRenderId ||
    !analysis.currentChartMediaAssetId ||
    !analysis.currentGenerationId ||
    !analysis.currentFinalMediaAssetId ||
    !analysis.chartApprovalFingerprint ||
    !analysis.chartApprovedAt ||
    !analysis.chartApprovedBy ||
    !analysis.storyHeadline ||
    !analysis.storySupportingText ||
    !analysis.storyApprovalFingerprint ||
    !analysis.storyApprovedAt ||
    !analysis.storyApprovedBy ||
    !analysis.designFamilyKey ||
    !analysis.designVariantKey ||
    !analysis.outputFormat ||
    !analysis.imageOptionKey ||
    !analysis.designApprovalFingerprint ||
    !analysis.designApprovedAt ||
    !analysis.designApprovedBy ||
    !analysis.finalApprovalFingerprint ||
    !analysis.finalApprovedAt ||
    !analysis.finalApprovedBy
  ) {
    return null;
  }
  const chartSpec = persistedMarketChartSpecSchema.safeParse(
    analysis.currentChartSpec,
  );
  if (!chartSpec.success) return null;
  const [snapshotRows, seriesRows, renderRows, generationRows, assets] =
    await Promise.all([
      executor
        .select()
        .from(marketSnapshot)
        .where(
          and(
            inWorkspace(marketSnapshot, workspaceId),
            eq(marketSnapshot.id, analysis.currentSnapshotId),
          ),
        ),
      executor
        .select()
        .from(marketSnapshotSeries)
        .where(
          and(
            inWorkspace(marketSnapshotSeries, workspaceId),
            eq(
              marketSnapshotSeries.marketSnapshotId,
              analysis.currentSnapshotId,
            ),
          ),
        )
        .orderBy(asc(marketSnapshotSeries.position)),
      executor
        .select()
        .from(marketChartRender)
        .where(
          and(
            inWorkspace(marketChartRender, workspaceId),
            eq(marketChartRender.id, analysis.currentChartRenderId),
          ),
        ),
      executor
        .select()
        .from(marketGeneration)
        .where(
          and(
            inWorkspace(marketGeneration, workspaceId),
            eq(marketGeneration.id, analysis.currentGenerationId),
          ),
        ),
      executor
        .select({
          id: mediaAsset.id,
          checksum: mediaAsset.checksum,
          mimeType: mediaAsset.mimeType,
          width: mediaAsset.width,
          height: mediaAsset.height,
        })
        .from(mediaAsset)
        .where(
          and(
            inWorkspace(mediaAsset, workspaceId),
            inArray(mediaAsset.id, [
              analysis.currentChartMediaAssetId,
              analysis.currentFinalMediaAssetId,
            ]),
          ),
        ),
    ]);
  const snapshot = snapshotRows[0];
  const render = renderRows[0];
  const generation = generationRows[0];
  const chartMedia = reportMedia(
    assets.find((asset) => asset.id === analysis.currentChartMediaAssetId),
  );
  const finalMedia = reportMedia(
    assets.find((asset) => asset.id === analysis.currentFinalMediaAssetId),
  );
  if (
    !snapshot ||
    !render ||
    render.mediaAssetId !== chartMedia?.id ||
    !generation ||
    generation.finalMediaAssetId !== finalMedia?.id ||
    !chartMedia ||
    !finalMedia
  ) {
    return null;
  }
  const family = marketCompositionCatalog.families.find(
    (candidate) => candidate.key === analysis.designFamilyKey,
  );
  const variant = family?.variants.find(
    (candidate) => candidate.key === analysis.designVariantKey,
  );
  const sampleMatches =
    variant?.sample.path === generation.referenceSampleKey &&
    variant.sample.sha256 === generation.referenceSampleChecksum;
  return {
    id: analysis.id,
    createdAt: analysis.createdAt,
    completedAt: analysis.completedAt,
    completedBy: analysis.completedBy,
    contentLocale: analysis.contentLocale,
    mediaBrand: {
      id: analysis.mediaBrandId,
      key: owned.mediaBrandKey,
      name: owned.mediaBrandName,
    },
    visualOwner: {
      id: analysis.visualOwnerInstrumentId,
      key: owned.visualOwnerKey,
      name: owned.visualOwnerName,
      symbol: owned.visualOwnerSymbol,
    },
    normalizedRequest: analysis.normalizedRequest,
    requestFingerprint: analysis.requestFingerprint,
    snapshot: {
      id: snapshot.id,
      status: snapshot.status,
      period: snapshot.period,
      scale: snapshot.scale,
      effectiveWindowStart: snapshot.effectiveWindowStart,
      effectiveWindowEnd: snapshot.effectiveWindowEnd,
      fetchCompletedAt: snapshot.fetchCompletedAt,
      warnings: snapshot.warnings,
      series: seriesRows.map((series) => ({
        descriptorIdentity: series.descriptorIdentity,
        role: series.role,
        outcome: series.outcome,
        startPrice: series.startPrice,
        endPrice: series.endPrice,
        changePercent: series.changePercent,
        failureCode: series.failureCode,
        warnings: series.warnings,
        provider: series.provider,
        providerReference: series.providerReference,
        attributionIdentity: series.attributionIdentity,
        coverageStart: series.coverageStart,
        coverageEnd: series.coverageEnd,
      })),
    },
    chart: {
      spec: chartSpec.data,
      fingerprint: analysis.chartApprovalFingerprint,
      approvedAt: analysis.chartApprovedAt,
      approvedBy: analysis.chartApprovedBy,
      renderContractVersion: render.renderContractVersion,
      media: chartMedia,
      attribution: [
        ...new Set(
          seriesRows.flatMap((series) =>
            series.attributionIdentity ? [series.attributionIdentity] : [],
          ),
        ),
      ].sort((left, right) => left.localeCompare(right, "en")),
    },
    story: {
      headline: analysis.storyHeadline,
      supportingText: analysis.storySupportingText,
      fingerprint: analysis.storyApprovalFingerprint,
      approvedAt: analysis.storyApprovedAt,
      approvedBy: analysis.storyApprovedBy,
    },
    design: {
      familyKey: analysis.designFamilyKey,
      familyLabel: family?.displayName ?? null,
      variantKey: analysis.designVariantKey,
      variantLabel: variant?.displayName ?? null,
      outputFormat: analysis.outputFormat,
      imageOptionKey: analysis.imageOptionKey,
      referenceSampleKey: generation.referenceSampleKey,
      referenceSampleChecksum: generation.referenceSampleChecksum,
      referenceSampleLabel: sampleMatches ? variant.displayName : null,
      fingerprint: analysis.designApprovalFingerprint,
      approvedAt: analysis.designApprovedAt,
      approvedBy: analysis.designApprovedBy,
    },
    final: {
      fingerprint: analysis.finalApprovalFingerprint,
      approvedAt: analysis.finalApprovedAt,
      approvedBy: analysis.finalApprovedBy,
      media: finalMedia,
      operationId: generation.operationId,
      briefSource: generation.briefSource,
      fallbackCode: generation.fallbackCode,
    },
    fingerprints: {
      template: analysis.templateFingerprint,
      catalog: analysis.catalogFingerprint,
      instrumentProfile: analysis.instrumentProfileFingerprint,
    },
  };
}

function reportMedia(
  asset:
    | {
        id: string;
        checksum: string | null;
        mimeType: string;
        width: number | null;
        height: number | null;
      }
    | undefined,
): ReportMedia | null {
  return asset?.checksum && asset.width && asset.height
    ? {
        id: asset.id,
        checksum: asset.checksum,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
      }
    : null;
}

type RawReportLive = {
  media: MarketAnalysisReportLive["media"];
  handoffs: Array<
    Omit<
      MarketAnalysisReportLive["handoffs"][number],
      "createdAt" | "drafts"
    > & {
      createdAt: string;
      drafts: Array<
        Omit<
          MarketAnalysisReportLive["handoffs"][number]["drafts"][number],
          "updatedAt"
        > & { updatedAt: string }
      >;
    }
  >;
};

export async function readMarketAnalysisReportLive(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisId: string,
): Promise<MarketAnalysisReportLive | null> {
  const result = await executor.execute<RawReportLive>(sql`
    with owned as (
      select analysis.*
      from market_analysis analysis
      join operation owner_operation
        on owner_operation.workspace_id = analysis.workspace_id
        and owner_operation.id = analysis.operation_id
        and owner_operation.actor = ${userId}
      where analysis.workspace_id = ${workspaceId}::uuid
        and analysis.id = ${analysisId}::uuid
        and analysis.status = 'completed'
    ), media_refs as (
      select current_chart_media_asset_id as id, 'chart'::text as role from owned
      union
      select current_final_media_asset_id, 'final'::text from owned
    )
    select
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', asset.id,
          'role', ref.role,
          'integrity', case
            when asset.object_removed_at is not null then 'bytes_removed'
            when asset.delete_failed_at is not null
              or (asset.lifecycle = 'verified' and (asset.actual_bytes is null or asset.checksum is null))
              then 'reconciliation_required'
            when asset.lifecycle = 'rejected' then 'integrity_mismatch'
            when asset.lifecycle = 'verified' and asset.checksum is not null then 'available'
            else 'temporarily_unavailable'
          end
        ) order by ref.role, asset.id)
        from media_refs ref
        join media_asset asset
          on asset.workspace_id = ${workspaceId}::uuid and asset.id = ref.id
      ), '[]'::jsonb) as media,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', handoff.id,
          'classification', case
            when handoff.approved_final_fingerprint = owned.final_approval_fingerprint
              then 'final_completed_chain'
            else 'earlier_approved_chain'
          end,
          'createdAt', handoff.created_at,
          'drafts', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', draft.id,
              'platform', draft.platform,
              'revisionNumber', revision.revision_number,
              'saved', exists(
                select 1 from saved_card saved
                where saved.workspace_id = draft.workspace_id
                  and saved.platform_draft_id = draft.id
                  and saved.saved_by = ${userId}
                  and saved.discarded_at is null
              ),
              'destinationReady', exists(
                select 1
                from media_brand_destination_account mapping
                join destination_account destination
                  on destination.workspace_id = mapping.workspace_id
                  and destination.id = mapping.destination_account_id
                  and destination.platform = draft.platform
                  and destination.enabled = true
                  and destination.binding_present = true
                  and destination.deleted_at is null
                where mapping.workspace_id = draft.workspace_id
                  and mapping.media_brand_id = draft.media_brand_id
              ),
              'scheduleLifecycle', latest_schedule.lifecycle,
              'publicationLifecycle', publication.lifecycle,
              'deliveryUnknown', publication.lifecycle = 'delivery_unknown',
              'updatedAt', greatest(
                draft.updated_at,
                coalesce(latest_schedule.updated_at, draft.updated_at),
                coalesce(publication.updated_at, draft.updated_at)
              )
            ) order by draft.created_at, draft.id)
            from platform_draft draft
            left join draft_revision revision
              on revision.workspace_id = draft.workspace_id
              and revision.id = draft.active_revision_id
            left join publication
              on publication.workspace_id = draft.workspace_id
              and publication.draft_revision_id = revision.id
              and publication.platform = draft.platform
            left join lateral (
              select schedule.lifecycle, schedule.updated_at
              from schedule
              where schedule.workspace_id = draft.workspace_id
                and schedule.draft_revision_id = revision.id
              order by schedule.created_at desc, schedule.id desc
              limit 1
            ) latest_schedule on true
            where draft.workspace_id = handoff.workspace_id
              and draft.market_analysis_handoff_id = handoff.id
              and draft.deleted_at is null
          ), '[]'::jsonb)
        ) order by handoff.created_at, handoff.id)
        from owned
        join market_analysis_handoff handoff
          on handoff.workspace_id = owned.workspace_id
          and handoff.market_analysis_id = owned.id
      ), '[]'::jsonb) as handoffs
    from owned
  `);
  const row = result.rows[0];
  if (!row) return null;
  return {
    media: row.media,
    handoffs: row.handoffs.map((handoff) => ({
      ...handoff,
      createdAt: new Date(handoff.createdAt),
      drafts: handoff.drafts.map((draft) => ({
        ...draft,
        updatedAt: new Date(draft.updatedAt),
      })),
    })),
  };
}

function generationPhase(input: {
  generation: typeof marketGeneration.$inferSelect;
  operation: typeof operation.$inferSelect;
}): NonNullable<MarketAnalysisCoreProjection["generation"]>["phase"] {
  if (input.generation.finalMediaAssetId) return "ready";
  if (input.operation.lifecycle === "cancelled") return "cancelled";
  if (input.operation.lifecycle === "failed") return "failed";
  if (input.operation.lifecycle === "unknown") return "unknown";
  if (input.operation.lifecycle === "succeeded") return "superseded";
  if (input.operation.lifecycle === "queued") return "queued";
  if (input.generation.providerOriginalMediaAssetId) return "finalizing";
  if (input.generation.acceptedBrief) return "generating";
  return "briefing";
}

export async function readMarketAnalysisHistoryBase(
  executor: Executor,
  workspaceId: string,
  userId: string,
  query: MarketAnalysisHistoryQuery,
): Promise<MarketAnalysisHistoryPage> {
  const cursor = decodeKeysetCursor(
    marketAnalysisHistoryCursorSchema,
    query.cursor,
  );
  const direction = cursor?.direction ?? "older";
  const bound = cursor
    ? direction === "older"
      ? sql`and (analysis.updated_at, analysis.id) < (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
      : sql`and (analysis.updated_at, analysis.id) > (${cursor.updatedAt}::timestamptz, ${cursor.id}::uuid)`
    : sql``;
  const status = query.status
    ? sql`and analysis.status = ${query.status}`
    : sql``;
  const brand = query.brand
    ? sql`and analysis.media_brand_id = ${query.brand}::uuid`
    : sql``;
  const title = query.q
    ? sql`and coalesce(analysis.story_headline, owner.name) ilike ${`%${query.q}%`}`
    : sql``;
  const ordering =
    direction === "older"
      ? sql`analysis.updated_at desc, analysis.id desc`
      : sql`analysis.updated_at asc, analysis.id asc`;
  type HistoryRow = Omit<
    MarketAnalysisHistoryBaseRow,
    "completedAt" | "updatedAt"
  > & {
    completedAt: Date | string | null;
    cursorUpdatedAt: string;
    updatedAt: Date | string;
  };
  const result = await executor.execute<HistoryRow>(sql`
    select analysis.id,
      analysis.status,
      analysis.version,
      coalesce(analysis.story_headline, owner.name) as title,
      analysis.media_brand_id as "mediaBrandId",
      brand.name as "mediaBrandName",
      owner.name as "visualOwnerName",
      analysis.content_locale as "contentLocale",
      analysis.updated_at as "updatedAt",
      to_char(analysis.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorUpdatedAt",
      analysis.completed_at as "completedAt",
      analysis.normalized_request->>'period' as period,
      analysis.normalized_request->>'scale' as scale,
      case
        when analysis.status = 'completed' then 'publish'
        when analysis.final_approval_fingerprint is not null then 'publish'
        when analysis.current_final_media_asset_id is not null then 'generate'
        when analysis.design_approval_fingerprint is not null then 'generate'
        when analysis.story_approval_fingerprint is not null then 'design'
        when analysis.chart_approval_fingerprint is not null then 'story'
        when analysis.current_snapshot_id is not null then 'chart'
        else 'market'
      end as stage,
      analysis.current_final_media_asset_id as "currentFinalMediaAssetId",
      array_remove(array[
        analysis.verification_intent_id,
        chart.operation_id,
        generation.operation_id
      ], null)::text[] as "currentOperationIds"
    from market_analysis analysis
    join operation owner_operation
      on owner_operation.id = analysis.operation_id
      and owner_operation.workspace_id = analysis.workspace_id
    join media_brand brand
      on brand.id = analysis.media_brand_id
      and brand.workspace_id = analysis.workspace_id
    join market_instrument owner
      on owner.id = analysis.visual_owner_instrument_id
      and owner.workspace_id = analysis.workspace_id
    left join market_chart_render chart
      on chart.id = analysis.current_chart_render_id
      and chart.workspace_id = analysis.workspace_id
    left join market_generation generation
      on generation.id = analysis.current_generation_id
      and generation.workspace_id = analysis.workspace_id
    where analysis.workspace_id = ${workspaceId}::uuid
      and owner_operation.actor = ${userId}
      ${status}
      ${brand}
      ${title}
      ${bound}
    order by ${ordering}
    limit ${MARKET_ANALYSIS_HISTORY_PAGE_SIZE + 1}
  `);
  const { ordered, ...page } = keysetPageOf({
    raw: result.rows,
    pageSize: MARKET_ANALYSIS_HISTORY_PAGE_SIZE,
    cursor,
    toCursor: (row, nextDirection) => ({
      direction: nextDirection,
      updatedAt: row.cursorUpdatedAt,
      id: row.id,
    }),
  });
  const rows = ordered.map((row) => {
    const {
      completedAt,
      cursorUpdatedAt: _cursorUpdatedAt,
      updatedAt,
      ...rest
    } = row;
    return {
      ...rest,
      completedAt: completedAt ? new Date(completedAt) : null,
      updatedAt: new Date(updatedAt),
    };
  });
  return { ...page, rows };
}

export async function readMarketAnalysisDynamicOverlay(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisIds: readonly string[],
): Promise<MarketAnalysisDynamicOverlay[]> {
  if (analysisIds.length === 0) return [];
  const analysisIdList = sql.join(
    analysisIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  const result = await executor.execute<MarketAnalysisDynamicOverlay>(sql`
    select analysis.id as "analysisId",
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', active.id,
          'lifecycle', active.lifecycle,
          'version', active.version
        ) order by active.created_at, active.id)
        from operation active
        where active.workspace_id = analysis.workspace_id
          and active.id in (
            select analysis.verification_intent_id
            union all
            select chart.operation_id
            from market_chart_render chart
            where chart.workspace_id = analysis.workspace_id
              and chart.id = analysis.current_chart_render_id
            union all
            select generation.operation_id
            from market_generation generation
            where generation.workspace_id = analysis.workspace_id
              and generation.id = analysis.current_generation_id
          )
      ), '[]'::jsonb) as operations,
      coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', asset.id,
          'lifecycle', asset.lifecycle,
          'checksum', asset.checksum,
          'available', asset.lifecycle = 'verified'
            and asset.object_removed_at is null
            and asset.actual_bytes is not null
            and asset.checksum is not null,
          'integrity', case
            when asset.object_removed_at is not null then 'bytes_removed'
            when asset.delete_failed_at is not null
              or (asset.lifecycle = 'verified' and (asset.actual_bytes is null or asset.checksum is null))
              then 'reconciliation_required'
            when asset.lifecycle = 'rejected' then 'integrity_mismatch'
            when asset.lifecycle = 'verified' and asset.checksum is not null then 'available'
            else 'temporarily_unavailable'
          end
        ) order by asset.created_at, asset.id)
        from media_asset asset
        where asset.workspace_id = analysis.workspace_id
          and asset.id = analysis.current_final_media_asset_id
      ), '[]'::jsonb) as media
    from market_analysis analysis
    join operation owner_operation
      on owner_operation.workspace_id = analysis.workspace_id
      and owner_operation.id = analysis.operation_id
    where analysis.workspace_id = ${workspaceId}::uuid
      and owner_operation.actor = ${userId}
      and analysis.id in (${analysisIdList})
    order by analysis.updated_at desc, analysis.id desc
  `);
  return result.rows;
}

export async function readMarketAnalysisCatalog(
  executor: Executor,
  workspaceId: string,
  userId: string,
) {
  void userId;
  const [instruments, comparison] = await Promise.all([
    executor
      .select()
      .from(marketInstrument)
      .where(
        and(
          inWorkspace(marketInstrument, workspaceId),
          eq(marketInstrument.enabled, true),
        ),
      )
      .orderBy(asc(marketInstrument.name)),
    getCurrentMarketComparisonCatalog(executor, workspaceId),
  ]);
  return { instruments, comparison };
}

const comparisonProjection = {
  canonicalIdentity: marketComparisonCatalog.canonicalIdentity,
  symbol: marketComparisonCatalog.symbol,
  displayName: marketComparisonCatalog.displayName,
  baseAsset: marketComparisonCatalog.baseAsset,
  quoteAsset: marketComparisonCatalog.quoteAsset,
};

function currentComparisonUsdtCatalog(workspaceId: string) {
  return and(
    inWorkspace(marketComparisonCatalog, workspaceId),
    eq(
      marketComparisonCatalog.provider,
      requireMarketTemplate().comparisonProvider,
    ),
    eq(marketComparisonCatalog.quoteAsset, "USDT"),
    eq(marketComparisonCatalog.tradingStatus, "TRADING"),
  );
}

export async function readFeaturedMarketComparisons(
  executor: Executor,
  workspaceId: string,
  userId: string,
  baseAssets: readonly string[],
) {
  void userId;
  const [stateRows, rows] = await Promise.all([
    executor
      .select({
        currentBatchId: marketComparisonCatalogState.currentBatchId,
        lastSuccessAt: marketComparisonCatalogState.lastSuccessAt,
      })
      .from(marketComparisonCatalogState)
      .where(inWorkspace(marketComparisonCatalogState, workspaceId))
      .limit(1),
    baseAssets.length === 0
      ? Promise.resolve([])
      : executor
          .select(comparisonProjection)
          .from(marketComparisonCatalog)
          .innerJoin(
            marketComparisonCatalogState,
            and(
              inWorkspace(marketComparisonCatalogState, workspaceId),
              eq(
                marketComparisonCatalog.batchId,
                marketComparisonCatalogState.currentBatchId,
              ),
            ),
          )
          .where(
            and(
              currentComparisonUsdtCatalog(workspaceId),
              inArray(marketComparisonCatalog.baseAsset, [...baseAssets]),
            ),
          )
          .orderBy(asc(marketComparisonCatalog.symbol)),
  ]);
  const state = stateRows[0] ?? null;
  const order = new Map(baseAssets.map((symbol, index) => [symbol, index]));
  rows.sort(
    (left, right) =>
      (order.get(left.baseAsset) ?? Number.MAX_SAFE_INTEGER) -
      (order.get(right.baseAsset) ?? Number.MAX_SAFE_INTEGER),
  );
  return { state, rows };
}

export async function searchMarketComparisons(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: MarketComparisonSearchInput,
): Promise<MarketComparisonSearchResult> {
  void userId;
  const entries = await executor
    .select(comparisonProjection)
    .from(marketComparisonCatalog)
    .innerJoin(
      marketComparisonCatalogState,
      and(
        inWorkspace(marketComparisonCatalogState, workspaceId),
        eq(
          marketComparisonCatalog.batchId,
          marketComparisonCatalogState.currentBatchId,
        ),
      ),
    )
    .where(
      and(
        currentComparisonUsdtCatalog(workspaceId),
        or(
          sql`position(lower(${input.q}) in lower(${marketComparisonCatalog.baseAsset})) > 0`,
          sql`position(lower(${input.q}) in lower(${marketComparisonCatalog.symbol})) > 0`,
          sql`position(lower(${input.q}) in lower(${marketComparisonCatalog.displayName})) > 0`,
        ),
      ),
    )
    .orderBy(
      sql`case
        when lower(${marketComparisonCatalog.baseAsset}) = lower(${input.q}) then 0
        when lower(${marketComparisonCatalog.symbol}) = lower(${input.q}) then 1
        when position(lower(${input.q}) in lower(${marketComparisonCatalog.baseAsset})) = 1 then 2
        when position(lower(${input.q}) in lower(${marketComparisonCatalog.symbol})) = 1 then 3
        else 4
      end`,
      asc(marketComparisonCatalog.baseAsset),
      asc(marketComparisonCatalog.symbol),
    )
    .limit(Math.min(input.limit, MARKET_COMPARISON_SEARCH_LIMIT));
  return { entries };
}

export async function readMarketAnalysisOptions(
  executor: Executor,
  workspaceId: string,
  userId: string,
) {
  const [brands, instruments, defaults] = await Promise.all([
    executor
      .select({ id: mediaBrand.id, key: mediaBrand.key, name: mediaBrand.name })
      .from(mediaBrand)
      .where(
        and(inWorkspace(mediaBrand, workspaceId), isNull(mediaBrand.deletedAt)),
      )
      .orderBy(asc(mediaBrand.sortOrder)),
    executor
      .select({
        id: marketInstrument.id,
        key: marketInstrument.key,
        name: marketInstrument.name,
        symbol: marketInstrument.symbol,
      })
      .from(marketInstrument)
      .where(
        and(
          inWorkspace(marketInstrument, workspaceId),
          eq(marketInstrument.enabled, true),
          isNull(marketInstrument.deletedAt),
        ),
      )
      .orderBy(asc(marketInstrument.name)),
    executor
      .select()
      .from(marketChartDefault)
      .where(
        and(
          inWorkspace(marketChartDefault, workspaceId),
          eq(marketChartDefault.actorId, userId),
        ),
      ),
  ]);
  return { brands, defaults, instruments };
}

export async function readOwnedMarketAnalysisCommandState(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisId: string,
) {
  return ownedAnalysis(executor, workspaceId, userId, analysisId);
}

export async function readMarketAnalysisSelectionContext(
  executor: Executor,
  workspaceId: string,
  userId: string,
  input: { mediaBrandId?: string; marketInstrumentId?: string },
) {
  void userId;
  const [brand, instrument] = await Promise.all([
    input.mediaBrandId
      ? executor
          .select({ id: mediaBrand.id, key: mediaBrand.key })
          .from(mediaBrand)
          .where(
            and(
              inWorkspace(mediaBrand, workspaceId),
              eq(mediaBrand.id, input.mediaBrandId),
              isNull(mediaBrand.deletedAt),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
    input.marketInstrumentId
      ? executor
          .select({
            id: marketInstrument.id,
            key: marketInstrument.key,
            name: marketInstrument.name,
            symbol: marketInstrument.symbol,
            enabled: marketInstrument.enabled,
            providerMappings: marketInstrument.providerMappings,
          })
          .from(marketInstrument)
          .where(
            and(
              inWorkspace(marketInstrument, workspaceId),
              eq(marketInstrument.id, input.marketInstrumentId),
              isNull(marketInstrument.deletedAt),
            ),
          )
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);
  return { brand, instrument };
}
