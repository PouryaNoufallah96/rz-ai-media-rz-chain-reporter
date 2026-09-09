import type { ContentLocale, Platform } from "@rz-chain-reporter/contracts";
import { and, asc, eq, sql } from "drizzle-orm";

import type { Executor } from "../executor";
import { type Transaction, withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { marketAnalysisHandoff } from "../schema/market-analysis";
import { marketSnapshotSeries } from "../schema/market-snapshot";
import {
  type RoutePlatformDraftResult,
  routePlatformDraftInTransaction,
} from "./platform-draft";

export type PrepareMarketPlatformInput = {
  actorId: string;
  analysisId: string;
  expectedVersion?: number;
  expectedFinalFingerprint?: string;
  platform: Platform;
  modelOptionKey: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  variantKeys: readonly string[];
  customerTemplateFingerprint: string;
  brandPolicyFingerprint: string;
  promptVersion: string;
  configurationVersion: string;
};

export type PrepareMarketPlatformResult =
  | Extract<RoutePlatformDraftResult, { draft: unknown }>
  | {
      status:
        | "not_found"
        | "not_ready"
        | "invalid_disposition"
        | "stale_origin"
        | "platform_not_allowed"
        | "mismatch";
    };

type AuthorityRow = {
  approvedFinalFingerprint: string | null;
  brandKey: string;
  catalogFingerprint: string | null;
  chartApprovalFingerprint: string | null;
  chartMediaAssetId: string | null;
  chartMediaChecksum: string | null;
  chartMediaLifecycle: string | null;
  contentLocale: ContentLocale;
  designApprovalFingerprint: string | null;
  designFamilyKey: string | null;
  designVariantKey: string | null;
  finalMediaAssetId: string | null;
  finalMediaChecksum: string | null;
  finalMediaLifecycle: string | null;
  footerLockupChecksum: string | null;
  imageOptionKey: string | null;
  instrumentProfileFingerprint: string;
  marketChartRenderId: string | null;
  marketSnapshotId: string | null;
  mediaBrandId: string;
  operationActor: string;
  referenceSampleChecksum: string | null;
  storyApprovalFingerprint: string | null;
  storyHeadline: string | null;
  storySupportingText: string | null;
  templateFingerprint: string;
  visualOwnerInstrumentId: string;
  version: number;
};

class RouteRejected extends Error {
  constructor(
    readonly status:
      | "invalid_disposition"
      | "mismatch"
      | "not_found"
      | "platform_not_allowed"
      | "stale_origin",
  ) {
    super(status);
  }
}

export async function prepareMarketPlatform(
  executor: Executor,
  workspaceId: string,
  input: PrepareMarketPlatformInput,
): Promise<PrepareMarketPlatformResult> {
  try {
    return await executor.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      const authority = await loadAuthority(tx, workspaceId, input.analysisId);
      if (!authority || authority.operationActor !== input.actorId) {
        return { status: "not_found" } as const;
      }
      if (
        (input.expectedVersion !== undefined &&
          authority.version !== input.expectedVersion) ||
        (input.expectedFinalFingerprint !== undefined &&
          authority.approvedFinalFingerprint !== input.expectedFinalFingerprint)
      ) {
        return { status: "stale_origin" } as const;
      }
      if (!ready(authority)) return { status: "not_ready" } as const;
      const verifiedFacts = await tx
        .select({
          attributionIdentity: marketSnapshotSeries.attributionIdentity,
          changePercent: marketSnapshotSeries.changePercent,
          descriptorIdentity: marketSnapshotSeries.descriptorIdentity,
          endPrice: marketSnapshotSeries.endPrice,
          position: marketSnapshotSeries.position,
          role: marketSnapshotSeries.role,
          startPrice: marketSnapshotSeries.startPrice,
        })
        .from(marketSnapshotSeries)
        .where(
          and(
            inWorkspace(marketSnapshotSeries, workspaceId),
            eq(
              marketSnapshotSeries.marketSnapshotId,
              authority.marketSnapshotId,
            ),
          ),
        )
        .orderBy(asc(marketSnapshotSeries.position));

      const [inserted] = await tx
        .insert(marketAnalysisHandoff)
        .values({
          workspaceId,
          marketAnalysisId: input.analysisId,
          approvedFinalFingerprint: authority.approvedFinalFingerprint,
          marketSnapshotId: authority.marketSnapshotId,
          mediaBrandId: authority.mediaBrandId,
          visualOwnerInstrumentId: authority.visualOwnerInstrumentId,
          designFamilyKey: authority.designFamilyKey,
          designVariantKey: authority.designVariantKey,
          contentLocale: authority.contentLocale,
          storyHeadline: authority.storyHeadline,
          storySupportingText: authority.storySupportingText,
          verifiedFacts,
          templateFingerprint: authority.templateFingerprint,
          catalogFingerprint: authority.catalogFingerprint,
          instrumentProfileFingerprint: authority.instrumentProfileFingerprint,
          brandPolicyFingerprint: input.brandPolicyFingerprint,
          referenceSampleChecksum: authority.referenceSampleChecksum,
          footerLockupChecksum: authority.footerLockupChecksum,
          imageOptionKey: authority.imageOptionKey,
          marketChartRenderId: authority.marketChartRenderId,
          chartMediaAssetId: authority.chartMediaAssetId,
          chartMediaChecksum: authority.chartMediaChecksum,
          finalMediaAssetId: authority.finalMediaAssetId,
          finalMediaChecksum: authority.finalMediaChecksum,
          chartApprovalFingerprint: authority.chartApprovalFingerprint,
          storyApprovalFingerprint: authority.storyApprovalFingerprint,
          designApprovalFingerprint: authority.designApprovalFingerprint,
        })
        .onConflictDoNothing({
          target: [
            marketAnalysisHandoff.workspaceId,
            marketAnalysisHandoff.marketAnalysisId,
            marketAnalysisHandoff.approvedFinalFingerprint,
          ],
        })
        .returning({ id: marketAnalysisHandoff.id });
      const handoffId =
        inserted?.id ??
        (
          await tx
            .select({ id: marketAnalysisHandoff.id })
            .from(marketAnalysisHandoff)
            .where(
              and(
                inWorkspace(marketAnalysisHandoff, workspaceId),
                eq(marketAnalysisHandoff.marketAnalysisId, input.analysisId),
                eq(
                  marketAnalysisHandoff.approvedFinalFingerprint,
                  authority.approvedFinalFingerprint,
                ),
              ),
            )
        )[0]?.id;
      if (!handoffId) throw new Error("market handoff conflict has no row");

      const routed = await routePlatformDraftInTransaction(tx, workspaceId, {
        actor: input.actorId,
        origin: {
          kind: "market_analysis_handoff",
          marketAnalysisHandoffId: handoffId,
        },
        platform: input.platform,
        modelOptionKey: input.modelOptionKey,
        requestedContentLocale: authority.contentLocale,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        requestId: input.requestId,
        variantKeys: input.variantKeys,
        customerTemplateFingerprint: input.customerTemplateFingerprint,
        brandPolicyFingerprint: input.brandPolicyFingerprint,
        mediaBrandKey: authority.brandKey,
        promptVersion: input.promptVersion,
        configurationVersion: input.configurationVersion,
      });
      if (!("draft" in routed)) throw new RouteRejected(routed.status);
      return routed;
    });
  } catch (error) {
    if (error instanceof RouteRejected) {
      return { status: error.status } as PrepareMarketPlatformResult;
    }
    throw error;
  }
}

async function loadAuthority(
  tx: Transaction,
  workspaceId: string,
  analysisId: string,
) {
  const result = await tx.execute<AuthorityRow>(sql`
    select
      analysis.final_approval_fingerprint as "approvedFinalFingerprint",
      brand.key as "brandKey",
      analysis.catalog_fingerprint as "catalogFingerprint",
      analysis.chart_approval_fingerprint as "chartApprovalFingerprint",
      analysis.current_chart_media_asset_id as "chartMediaAssetId",
      chart_asset.checksum as "chartMediaChecksum",
      chart_asset.lifecycle as "chartMediaLifecycle",
      analysis.content_locale as "contentLocale",
      analysis.design_approval_fingerprint as "designApprovalFingerprint",
      analysis.design_family_key as "designFamilyKey",
      analysis.design_variant_key as "designVariantKey",
      analysis.current_final_media_asset_id as "finalMediaAssetId",
      final_asset.checksum as "finalMediaChecksum",
      final_asset.lifecycle as "finalMediaLifecycle",
      generation.footer_lockup_checksum as "footerLockupChecksum",
      analysis.image_option_key as "imageOptionKey",
      analysis.instrument_profile_fingerprint as "instrumentProfileFingerprint",
      analysis.current_chart_render_id as "marketChartRenderId",
      analysis.current_snapshot_id as "marketSnapshotId",
      analysis.media_brand_id as "mediaBrandId",
      owner_operation.actor as "operationActor",
      generation.reference_sample_checksum as "referenceSampleChecksum",
      analysis.story_approval_fingerprint as "storyApprovalFingerprint",
      analysis.story_headline as "storyHeadline",
      analysis.story_supporting_text as "storySupportingText",
      analysis.template_fingerprint as "templateFingerprint",
      analysis.visual_owner_instrument_id as "visualOwnerInstrumentId",
      analysis.version as "version"
    from market_analysis analysis
    join operation owner_operation
      on owner_operation.workspace_id = analysis.workspace_id
      and owner_operation.id = analysis.operation_id
    join media_brand brand
      on brand.workspace_id = analysis.workspace_id
      and brand.id = analysis.media_brand_id
    left join media_asset chart_asset
      on chart_asset.workspace_id = analysis.workspace_id
      and chart_asset.id = analysis.current_chart_media_asset_id
    left join media_asset final_asset
      on final_asset.workspace_id = analysis.workspace_id
      and final_asset.id = analysis.current_final_media_asset_id
    left join market_generation generation
      on generation.workspace_id = analysis.workspace_id
      and generation.final_media_asset_id = analysis.current_final_media_asset_id
    where analysis.workspace_id = ${workspaceId}::uuid
      and analysis.id = ${analysisId}::uuid
    for update of analysis
  `);
  return result.rows[0] ?? null;
}

function ready(row: AuthorityRow): row is AuthorityRow & {
  approvedFinalFingerprint: string;
  catalogFingerprint: string;
  chartApprovalFingerprint: string;
  chartMediaAssetId: string;
  chartMediaChecksum: string;
  designApprovalFingerprint: string;
  designFamilyKey: string;
  designVariantKey: string;
  finalMediaAssetId: string;
  finalMediaChecksum: string;
  footerLockupChecksum: string;
  imageOptionKey: string;
  marketChartRenderId: string;
  marketSnapshotId: string;
  referenceSampleChecksum: string;
  storyApprovalFingerprint: string;
  storyHeadline: string;
  storySupportingText: string;
} {
  return Boolean(
    row.approvedFinalFingerprint &&
      row.catalogFingerprint &&
      row.chartApprovalFingerprint &&
      row.chartMediaAssetId &&
      row.chartMediaChecksum &&
      row.chartMediaLifecycle === "verified" &&
      row.designApprovalFingerprint &&
      row.designFamilyKey &&
      row.designVariantKey &&
      row.finalMediaAssetId &&
      row.finalMediaChecksum &&
      row.finalMediaLifecycle === "verified" &&
      row.footerLockupChecksum &&
      row.imageOptionKey &&
      row.marketChartRenderId &&
      row.marketSnapshotId &&
      row.referenceSampleChecksum &&
      row.storyApprovalFingerprint &&
      row.storyHeadline &&
      row.storySupportingText,
  );
}
