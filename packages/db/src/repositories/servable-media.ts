import {
  MARKET_CHART_RENDER_MEDIA_KIND,
  MARKET_GENERATION_FINAL_MEDIA_KIND,
  referenceImageMimeTypeSchema,
} from "@rz-chain-reporter/contracts";
import { and, eq, isNotNull, isNull, or, sql } from "drizzle-orm";

import type { Executor } from "../executor";
import { inWorkspace } from "../filters";
import { imageGeneration } from "../schema/image-generation";
import {
  marketAnalysis,
  marketAnalysisHandoff,
  marketInstrument,
} from "../schema/market-analysis";
import { mediaAsset } from "../schema/media-asset";
import { operation } from "../schema/operation";

export async function findServableMedia(
  executor: Executor,
  workspaceId: string,
  mediaAssetId: string,
) {
  const [row] = await executor
    .select({
      actualBytes: mediaAsset.actualBytes,
      checksum: mediaAsset.checksum,
      mimeType: mediaAsset.mimeType,
      objectKey: mediaAsset.objectKey,
    })
    .from(mediaAsset)
    .leftJoin(
      imageGeneration,
      and(
        eq(imageGeneration.finalMediaAssetId, mediaAsset.id),
        eq(imageGeneration.workspaceId, mediaAsset.workspaceId),
      ),
    )
    .leftJoin(
      marketAnalysis,
      and(
        eq(marketAnalysis.currentFinalMediaAssetId, mediaAsset.id),
        eq(marketAnalysis.workspaceId, mediaAsset.workspaceId),
      ),
    )
    .leftJoin(
      marketAnalysisHandoff,
      and(
        eq(marketAnalysisHandoff.finalMediaAssetId, mediaAsset.id),
        eq(marketAnalysisHandoff.workspaceId, mediaAsset.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
        or(
          eq(mediaAsset.kind, "image"),
          eq(mediaAsset.kind, MARKET_CHART_RENDER_MEDIA_KIND),
          eq(mediaAsset.kind, MARKET_GENERATION_FINAL_MEDIA_KIND),
          and(
            eq(mediaAsset.kind, "image_final"),
            or(
              isNotNull(imageGeneration.operationId),
              isNotNull(marketAnalysis.id),
              isNotNull(marketAnalysisHandoff.id),
            ),
          ),
        ),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
      ),
    );
  if (!row || row.actualBytes === null || row.checksum === null) return null;
  const mimeType = referenceImageMimeTypeSchema.safeParse(row.mimeType);
  if (!mimeType.success) return null;
  return { ...row, mimeType: mimeType.data };
}

export async function canReadOwnedMarketMedia(
  executor: Executor,
  workspaceId: string,
  actorId: string,
  mediaAssetId: string,
) {
  const [row] = await executor
    .select({
      analysisId: marketAnalysis.id,
      normalizedRequest: marketAnalysis.normalizedRequest,
      outputFormat: marketAnalysis.outputFormat,
      ownerKey: marketInstrument.key,
      role: sql<"chart" | "final">`case
        when ${marketAnalysis.currentChartMediaAssetId} = ${mediaAssetId}
          or ${marketAnalysisHandoff.chartMediaAssetId} = ${mediaAssetId}
        then 'chart'
        else 'final'
      end`,
    })
    .from(marketAnalysis)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, marketAnalysis.operationId),
        eq(operation.actor, actorId),
      ),
    )
    .leftJoin(
      marketAnalysisHandoff,
      and(
        inWorkspace(marketAnalysisHandoff, workspaceId),
        eq(marketAnalysisHandoff.marketAnalysisId, marketAnalysis.id),
      ),
    )
    .innerJoin(
      marketInstrument,
      and(
        inWorkspace(marketInstrument, workspaceId),
        eq(marketInstrument.id, marketAnalysis.visualOwnerInstrumentId),
      ),
    )
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        or(
          eq(marketAnalysis.currentChartMediaAssetId, mediaAssetId),
          eq(marketAnalysis.currentFinalMediaAssetId, mediaAssetId),
          eq(marketAnalysisHandoff.chartMediaAssetId, mediaAssetId),
          eq(marketAnalysisHandoff.finalMediaAssetId, mediaAssetId),
        ),
      ),
    )
    .limit(1);
  if (!row) return null;
  return {
    analysisId: row.analysisId,
    format: row.outputFormat ?? "image",
    ownerKey: row.ownerKey,
    period: row.normalizedRequest.period,
    role: row.role,
    symbols: row.normalizedRequest.series.map((series) => series.symbol),
  };
}
