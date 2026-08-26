import "server-only";

import type {
  CardOriginReference,
  ContentLocale,
  FilterDisposition,
  ModelUnitStatus,
  OperationLifecycle,
  RunConfiguration,
  SourceFetchOutcome,
  SourceFetchReason,
  SourceImportStage,
  SourceOrigin,
} from "@rz-chain-reporter/contracts";
import { OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME } from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { analysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { analysisRunItem } from "@rz-chain-reporter/db/schema/analysis-run-item";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { copyGeneration } from "@rz-chain-reporter/db/schema/copy-generation";
import { copyGenerationUnit } from "@rz-chain-reporter/db/schema/copy-generation-unit";
import { copyVariant } from "@rz-chain-reporter/db/schema/copy-variant";
import { draftRevision } from "@rz-chain-reporter/db/schema/draft-revision";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { filterResult } from "@rz-chain-reporter/db/schema/filter-result";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { promoIdea } from "@rz-chain-reporter/db/schema/promo-idea";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceImport } from "@rz-chain-reporter/db/schema/source-import";
import { sourceImportItem } from "@rz-chain-reporter/db/schema/source-import-item";
import { sourceImportSource } from "@rz-chain-reporter/db/schema/source-import-source";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
} from "@/features/shared/lib/keyset-cursor";

import {
  RECENT_TOPIC_LIMIT,
  RECENT_TOPIC_RUNS,
  REPORT_PAGE_SIZE,
} from "../constants";
import type { PlatformDraftCard } from "../schemas/drafts";
import {
  type ReportBrandOption,
  type ReportCursor,
  type ReportPage,
  type ReportQuery,
  type ReportRow,
  reportBranchPlan,
  reportCursorSchema,
} from "../schemas/report";
import type {
  ModelLane,
  PromoIdeaCard,
  RunExecution,
  RunHead,
  RunOption,
  SelectionCard,
  TelegramAcquisition,
  TelegramCard,
  TelegramLane,
} from "../schemas/workspace";

// Prefer the committed usage row; otherwise the highest attempted ladder slot
// preserves truthful provenance for terminal and ambiguous failures.
const LADDER_POSITION = sql`array_position(array['primary', 'retry-1', 'fallback'], ${aiUsageEvent.invocationKey})`;

const COMMITTED_USAGE_FIRST = sql`(${aiUsageEvent.status} = 'succeeded')`;

const DUPLICATE_BRAND_ID = "00000000-0000-0000-0000-000000000000";

export async function readEditorialWorkspace(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string | null,
  userId?: string,
) {
  const selected = await readRunHead(
    executor,
    workspaceId,
    analysisRunId,
    userId,
  );

  if (!selected) {
    return { head: null, modelLanes: [], telegramLanes: [] };
  }

  const { executionFacts, head } = selected;

  const [modelLanes, telegram, progress] = await Promise.all([
    readModelLanes(executor, workspaceId, head.id),
    readTelegramLanes(executor, workspaceId, head.id, head.sourceImportId),
    analysisRunProgress(executor, workspaceId, [head.id]),
  ]);

  const runProgress = progress[head.id];

  return {
    head: runProgress
      ? {
          ...head,
          execution: deriveRunExecution(head, executionFacts, runProgress),
          progress: runProgress,
          telegramAcquisition: telegram.acquisition,
        }
      : null,
    modelLanes,
    telegramLanes: telegram.lanes,
  };
}

type PlatformDraftProjectionRow = {
  id: string;
  mediaBrandId: string;
  brandKey: string;
  brandName: string;
  platform: PlatformDraftCard["platform"];
  lanePosition: number;
  version: number;
  editorialSelectionId: string | null;
  telegramFilterResultId: string | null;
  promoIdeaId: string | null;
  originTitle: string;
  sourceKind: "promo" | "rss" | "telegram";
  operationId: string | null;
  lifecycle: OperationLifecycle | null;
  modelOptionKey: string | null;
  requestedContentLocale: ContentLocale | null;
  limited: boolean | null;
  forceArticleRefresh: boolean | null;
  generationCreatedAt: Date | null;
  imageOperationId: string | null;
  imageDraftRevisionId: string | null;
  imageLifecycle: OperationLifecycle | null;
  imageModelOptionKey: string | null;
  imageReferenceMediaAssetId: string | null;
  imageProviderOriginalMediaAssetId: string | null;
  imageFinalMediaAssetId: string | null;
  imageCreatedAt: Date | null;
};

export async function readPlatformDrafts(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
  imageModels: readonly { key: string; name: string }[] = [],
): Promise<PlatformDraftCard[]> {
  const result = await executor.execute<PlatformDraftProjectionRow>(sql`
    select
      draft.id,
      draft.media_brand_id as "mediaBrandId",
      brand.key as "brandKey",
      brand.name as "brandName",
      draft.platform,
      draft.lane_position as "lanePosition",
      draft.version,
      draft.editorial_selection_id as "editorialSelectionId",
      draft.telegram_filter_result_id as "telegramFilterResultId",
      draft.promo_idea_id as "promoIdeaId",
      coalesce(selection_item.title, telegram_item.title, promo.title) as "originTitle",
      case
        when draft.promo_idea_id is not null then 'promo'
        when draft.telegram_filter_result_id is not null or selection_item.origin = 'telegram_public' then 'telegram'
        else 'rss'
      end as "sourceKind",
      latest.operation_id as "operationId",
      latest.lifecycle,
      latest.model_option_key as "modelOptionKey",
      latest.requested_content_locale as "requestedContentLocale",
      latest.limited,
      latest.force_article_refresh as "forceArticleRefresh",
      latest.created_at as "generationCreatedAt"
      , latest_image.operation_id as "imageOperationId"
      , latest_image.draft_revision_id as "imageDraftRevisionId"
      , latest_image.lifecycle as "imageLifecycle"
      , latest_image.model_option_key as "imageModelOptionKey"
      , latest_image.reference_media_asset_id as "imageReferenceMediaAssetId"
      , latest_image.provider_original_media_asset_id as "imageProviderOriginalMediaAssetId"
      , latest_image.final_media_asset_id as "imageFinalMediaAssetId"
      , latest_image.created_at as "imageCreatedAt"
    from platform_draft draft
    inner join media_brand brand
      on brand.id = draft.media_brand_id
      and brand.workspace_id = draft.workspace_id
      and brand.deleted_at is null
    left join editorial_selection selection
      on selection.id = draft.editorial_selection_id
      and selection.workspace_id = draft.workspace_id
    left join analysis_model_unit selection_unit
      on selection_unit.id = selection.analysis_model_unit_id
      and selection_unit.workspace_id = draft.workspace_id
    left join source_item selection_item
      on selection_item.id = selection.source_item_id
      and selection_item.workspace_id = draft.workspace_id
    left join filter_result telegram
      on telegram.id = draft.telegram_filter_result_id
      and telegram.workspace_id = draft.workspace_id
    left join source_item telegram_item
      on telegram_item.id = telegram.source_item_id
      and telegram_item.workspace_id = draft.workspace_id
    left join promo_idea promo
      on promo.id = draft.promo_idea_id
      and promo.workspace_id = draft.workspace_id
    left join analysis_model_unit promo_unit
      on promo_unit.id = promo.analysis_model_unit_id
      and promo_unit.workspace_id = draft.workspace_id
    left join lateral (
      select
        generation.operation_id,
        generation.model_option_key,
        generation.requested_content_locale,
        generation.limited,
        generation.force_article_refresh,
        generation.created_at,
        generation_operation.lifecycle
      from copy_generation generation
      inner join operation generation_operation
        on generation_operation.id = generation.operation_id
        and generation_operation.workspace_id = generation.workspace_id
      where generation.workspace_id = draft.workspace_id
        and generation.platform_draft_id = draft.id
      order by generation.created_at desc, generation.operation_id desc
      limit 1
    ) latest on true
    left join lateral (
      select
        generation.operation_id,
        generation.draft_revision_id,
        generation.model_option_key,
        generation.reference_media_asset_id,
        generation.provider_original_media_asset_id,
        generation.final_media_asset_id,
        generation.created_at,
        generation_operation.lifecycle
      from image_generation generation
      inner join draft_revision image_revision
        on image_revision.id = generation.draft_revision_id
        and image_revision.workspace_id = generation.workspace_id
      inner join operation generation_operation
        on generation_operation.id = generation.operation_id
        and generation_operation.workspace_id = generation.workspace_id
      where generation.workspace_id = draft.workspace_id
        and image_revision.platform_draft_id = draft.id
      order by generation.created_at desc, generation.operation_id desc
      limit 1
    ) latest_image on true
    where draft.workspace_id = ${workspaceId}::uuid
      and draft.deleted_at is null
      and coalesce(
        selection_unit.analysis_run_id,
        telegram.analysis_run_id,
        promo_unit.analysis_run_id
      ) = ${analysisRunId}::uuid
    order by brand.sort_order, draft.platform, draft.lane_position, draft.id
  `);

  const operationIds = result.rows.flatMap((row) =>
    row.operationId ? [row.operationId] : [],
  );
  const units =
    operationIds.length === 0
      ? []
      : await executor
          .select({
            id: copyGenerationUnit.id,
            operationId: copyGenerationUnit.copyGenerationId,
            status: copyGenerationUnit.status,
            variantKey: copyGenerationUnit.variantKey,
          })
          .from(copyGenerationUnit)
          .where(
            and(
              inWorkspace(copyGenerationUnit, workspaceId),
              inArray(copyGenerationUnit.copyGenerationId, operationIds),
            ),
          )
          .orderBy(
            asc(copyGenerationUnit.createdAt),
            asc(copyGenerationUnit.variantKey),
          );
  const unitsByOperation = new Map<
    string,
    { id: string; variantKey: string; status: ModelUnitStatus }[]
  >();
  for (const unit of units) {
    const existing = unitsByOperation.get(unit.operationId);
    if (existing) {
      existing.push({
        id: unit.id,
        variantKey: unit.variantKey,
        status: unit.status,
      });
    } else {
      unitsByOperation.set(unit.operationId, [
        { id: unit.id, variantKey: unit.variantKey, status: unit.status },
      ]);
    }
  }

  const draftIds = result.rows.map((row) => row.id);
  const [variants, revisions] =
    draftIds.length === 0
      ? [[], []]
      : await Promise.all([
          executor
            .select({
              id: copyVariant.id,
              platformDraftId: copyGeneration.platformDraftId,
              operationId: copyGeneration.operationId,
              variantKey: copyGenerationUnit.variantKey,
              contentLocale: copyVariant.contentLocale,
              headline: copyVariant.headline,
              body: copyVariant.body,
              hashtags: copyVariant.hashtags,
              limited: copyGeneration.limited,
              modelOptionKey: copyGeneration.modelOptionKey,
              createdAt: copyVariant.createdAt,
            })
            .from(copyVariant)
            .innerJoin(
              copyGenerationUnit,
              and(
                inWorkspace(copyGenerationUnit, workspaceId),
                eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
              ),
            )
            .innerJoin(
              copyGeneration,
              and(
                inWorkspace(copyGeneration, workspaceId),
                eq(
                  copyGeneration.operationId,
                  copyGenerationUnit.copyGenerationId,
                ),
                inArray(copyGeneration.platformDraftId, draftIds),
              ),
            )
            .where(inWorkspace(copyVariant, workspaceId))
            .orderBy(desc(copyVariant.createdAt), asc(copyVariant.id)),
          executor
            .select({
              id: draftRevision.id,
              platformDraftId: draftRevision.platformDraftId,
              revisionNumber: draftRevision.revisionNumber,
              contentLocale: draftRevision.contentLocale,
              headline: draftRevision.headline,
              body: draftRevision.body,
              hashtags: draftRevision.hashtags,
              originatingCopyVariantId: draftRevision.originatingCopyVariantId,
              imageSourceReadiness: sql<"ready" | "extract_required">`case
                when ${platformDraft.promoIdeaId} is not null then 'ready'
                when ${sourceItem.origin} = 'telegram_public' then 'ready'
                when ${sourceItem.origin} = 'rss'
                  and not ${copyGeneration.limited}
                  and ${copyGeneration.sourceItemEnrichmentId} is not null
                  and ${copyGeneration.pageContentHash} is not null then 'ready'
                else 'extract_required'
              end`,
              selectedFinalMediaAssetId:
                draftRevision.selectedFinalMediaAssetId,
              authoredBy: draftRevision.authoredBy,
              authorName: user.name,
              createdAt: draftRevision.createdAt,
            })
            .from(draftRevision)
            .innerJoin(
              platformDraft,
              and(
                eq(platformDraft.id, draftRevision.platformDraftId),
                eq(platformDraft.workspaceId, draftRevision.workspaceId),
              ),
            )
            .innerJoin(
              copyVariant,
              and(
                eq(copyVariant.id, draftRevision.originatingCopyVariantId),
                eq(copyVariant.workspaceId, draftRevision.workspaceId),
              ),
            )
            .innerJoin(
              copyGenerationUnit,
              and(
                eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
                eq(copyGenerationUnit.workspaceId, copyVariant.workspaceId),
              ),
            )
            .innerJoin(
              copyGeneration,
              and(
                eq(
                  copyGeneration.operationId,
                  copyGenerationUnit.copyGenerationId,
                ),
                eq(copyGeneration.workspaceId, copyGenerationUnit.workspaceId),
              ),
            )
            .leftJoin(
              sourceItemRevision,
              and(
                eq(sourceItemRevision.id, copyGeneration.sourceItemRevisionId),
                eq(sourceItemRevision.workspaceId, copyGeneration.workspaceId),
              ),
            )
            .leftJoin(
              sourceItem,
              and(
                eq(sourceItem.id, sourceItemRevision.sourceItemId),
                eq(sourceItem.workspaceId, sourceItemRevision.workspaceId),
              ),
            )
            .innerJoin(user, eq(user.id, draftRevision.authoredBy))
            .where(
              and(
                inWorkspace(draftRevision, workspaceId),
                inArray(draftRevision.platformDraftId, draftIds),
              ),
            )
            .orderBy(
              asc(draftRevision.platformDraftId),
              desc(draftRevision.revisionNumber),
            ),
        ]);
  const candidatesByDraft = new Map<
    string,
    Omit<(typeof variants)[number], "platformDraftId">[]
  >();
  for (const { platformDraftId, ...variant } of variants) {
    const existing = candidatesByDraft.get(platformDraftId);
    if (existing) existing.push(variant);
    else candidatesByDraft.set(platformDraftId, [variant]);
  }
  const revisionsByDraft = new Map<
    string,
    Omit<(typeof revisions)[number], "platformDraftId">[]
  >();
  for (const { platformDraftId, ...revision } of revisions) {
    const existing = revisionsByDraft.get(platformDraftId);
    if (existing) existing.push(revision);
    else revisionsByDraft.set(platformDraftId, [revision]);
  }

  return result.rows.map((row) => {
    const origin = platformDraftOrigin(row);
    const generation =
      row.operationId &&
      row.lifecycle &&
      row.modelOptionKey &&
      row.requestedContentLocale !== null
        ? {
            operationId: row.operationId,
            lifecycle: row.lifecycle,
            modelOptionKey: row.modelOptionKey,
            requestedContentLocale: row.requestedContentLocale,
            limited: row.limited ?? false,
            forceArticleRefresh: row.forceArticleRefresh ?? false,
            createdAt: row.generationCreatedAt ?? new Date(0),
            units: unitsByOperation.get(row.operationId) ?? [],
          }
        : null;
    const imageGeneration =
      row.imageOperationId &&
      row.imageDraftRevisionId &&
      row.imageLifecycle &&
      row.imageModelOptionKey
        ? {
            operationId: row.imageOperationId,
            draftRevisionId: row.imageDraftRevisionId,
            lifecycle: row.imageLifecycle,
            modelOptionKey: row.imageModelOptionKey,
            referenceMediaAssetId: row.imageReferenceMediaAssetId,
            providerOriginalMediaAssetId: row.imageProviderOriginalMediaAssetId,
            finalMediaAssetId: row.imageFinalMediaAssetId,
            createdAt: row.imageCreatedAt ?? new Date(0),
          }
        : null;

    return {
      id: row.id,
      mediaBrandId: row.mediaBrandId,
      brandKey: row.brandKey,
      brandName: row.brandName,
      platform: row.platform,
      lanePosition: row.lanePosition,
      version: row.version,
      origin,
      originTitle: row.originTitle,
      sourceKind: row.sourceKind,
      generation,
      candidates: candidatesByDraft.get(row.id) ?? [],
      revisions: revisionsByDraft.get(row.id) ?? [],
      imageGeneration,
      imageModels: [...imageModels],
    };
  });
}

export async function readPlatformDraftBrands(
  executor: Executor,
  workspaceId: string,
) {
  return executor
    .select({
      id: mediaBrand.id,
      key: mediaBrand.key,
      name: mediaBrand.name,
    })
    .from(mediaBrand)
    .where(
      and(
        inWorkspace(mediaBrand, workspaceId),
        sql`${mediaBrand.deletedAt} is null`,
      ),
    )
    .orderBy(asc(mediaBrand.sortOrder), asc(mediaBrand.id));
}

export async function readPlatformDraftRunConfiguration(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
): Promise<RunConfiguration | null> {
  const [row] = await executor
    .select({ configuration: analysisRun.configuration })
    .from(analysisRun)
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, analysisRunId),
      ),
    );

  return row?.configuration ?? null;
}

function platformDraftOrigin(
  row: Pick<
    PlatformDraftProjectionRow,
    "editorialSelectionId" | "promoIdeaId" | "telegramFilterResultId"
  >,
): CardOriginReference {
  if (row.editorialSelectionId) {
    return {
      kind: "editorial_selection",
      editorialSelectionId: row.editorialSelectionId,
    };
  }
  if (row.telegramFilterResultId) {
    return {
      kind: "telegram_filter_result",
      telegramFilterResultId: row.telegramFilterResultId,
    };
  }
  if (row.promoIdeaId) {
    return { kind: "promo_idea", promoIdeaId: row.promoIdeaId };
  }
  throw new Error("platform draft origin is missing");
}

async function readRunHead(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string | null,
  userId?: string,
): Promise<RunHeadRead | null> {
  const runMatch =
    analysisRunId !== null
      ? eq(analysisRun.id, analysisRunId)
      : userId !== undefined
        ? eq(operation.actor, userId)
        : undefined;
  if (!runMatch) {
    return null;
  }
  const latestAttempt = executor
    .select({ failureCode: operationAttempt.failureCode })
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.operationId, analysisRun.operationId),
      ),
    )
    .orderBy(desc(operationAttempt.attemptNumber))
    .limit(1)
    .as("latest_attempt");

  const semanticUsage = executor
    .select({
      model: sql<
        string | null
      >`coalesce(${aiUsageEvent.resolvedModel}, ${aiUsageEvent.requestedModel})`.as(
        "model",
      ),
      backend: aiUsageEvent.backend,
    })
    .from(aiUsageEvent)
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationAttemptId, analysisRun.semanticAttemptId),
        ne(aiUsageEvent.status, "pending"),
      ),
    )
    .orderBy(desc(COMMITTED_USAGE_FIRST), desc(LADDER_POSITION))
    .limit(1)
    .as("semantic_usage");

  const requestDispatch = executor
    .select({
      dispatchedAt: outboxEvent.dispatchedAt,
      exhaustedAt: outboxEvent.exhaustedAt,
      updatedAt: outboxEvent.updatedAt,
    })
    .from(outboxEvent)
    .where(
      and(
        inWorkspace(outboxEvent, workspaceId),
        eq(outboxEvent.operationId, analysisRun.operationId),
        eq(outboxEvent.eventType, OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME),
      ),
    )
    .orderBy(desc(outboxEvent.createdAt))
    .limit(1)
    .as("request_dispatch");

  const latestUnitProgress = executor
    .select({
      updatedAt: analysisModelUnit.updatedAt,
    })
    .from(analysisModelUnit)
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.analysisRunId, analysisRun.id),
      ),
    )
    .orderBy(desc(analysisModelUnit.updatedAt))
    .limit(1)
    .as("latest_unit_progress");

  const [row] = await executor
    .select({
      id: analysisRun.id,
      operationId: analysisRun.operationId,
      kind: analysisRun.kind,
      lifecycle: operation.lifecycle,
      failureCode: latestAttempt.failureCode,
      configuration: analysisRun.configuration,
      templateFingerprint: analysisRun.templateFingerprint,
      sourceImportId: analysisRun.sourceImportId,
      sourceImportBinding: analysisRun.sourceImportBinding,
      startedAt: analysisRun.startedAt,
      completedAt: analysisRun.completedAt,
      cancelRequestedAt: analysisRun.cancelRequestedAt,
      cancelledAt: analysisRun.cancelledAt,
      fanOutPlannedAt: analysisRun.fanOutPlannedAt,
      runUpdatedAt: analysisRun.updatedAt,
      operationEffectiveAt: operation.effectiveAt,
      operationUpdatedAt: operation.updatedAt,
      requestDispatchedAt: requestDispatch.dispatchedAt,
      requestExhaustedAt: requestDispatch.exhaustedAt,
      requestUpdatedAt: requestDispatch.updatedAt,
      sourceImportStage: sourceImport.stage,
      sourceImportUpdatedAt: sourceImport.updatedAt,
      unitUpdatedAt: latestUnitProgress.updatedAt,
      scoringVersion: analysisRun.scoringVersion,
      semanticStatus: analysisRun.semanticStatus,
      semanticReason: analysisRun.semanticReason,
      semanticDimension: analysisRun.semanticDimension,
      semanticNormalizationVersion: analysisRun.semanticNormalizationVersion,
      semanticProjectionVersion: analysisRun.semanticProjectionVersion,
      semanticTopicCount: analysisRun.semanticTopicCount,
      semanticAnchorCount: analysisRun.semanticAnchorCount,
      semanticModel: semanticUsage.model,
      semanticBackend: semanticUsage.backend,
      actorId: operation.actor,
      actorName: user.name,
    })
    .from(analysisRun)
    .innerJoin(operation, eq(operation.id, analysisRun.operationId))
    .innerJoin(user, eq(user.id, operation.actor))
    .leftJoinLateral(latestAttempt, sql`true`)
    .leftJoinLateral(semanticUsage, sql`true`)
    .leftJoinLateral(requestDispatch, sql`true`)
    .leftJoin(
      sourceImport,
      and(
        inWorkspace(sourceImport, workspaceId),
        eq(sourceImport.id, analysisRun.sourceImportId),
      ),
    )
    .leftJoinLateral(latestUnitProgress, sql`true`)
    .where(and(inWorkspace(analysisRun, workspaceId), runMatch))
    .orderBy(desc(analysisRun.startedAt), desc(analysisRun.id))
    .limit(1);

  if (!row) return null;

  const {
    scoringVersion,
    semanticStatus,
    semanticReason,
    semanticModel,
    semanticBackend,
    semanticDimension,
    semanticNormalizationVersion,
    semanticProjectionVersion,
    semanticTopicCount,
    semanticAnchorCount,
    fanOutPlannedAt,
    runUpdatedAt,
    operationEffectiveAt,
    operationUpdatedAt,
    requestDispatchedAt,
    requestExhaustedAt,
    requestUpdatedAt,
    sourceImportStage,
    sourceImportUpdatedAt,
    unitUpdatedAt,
    ...run
  } = row;

  return {
    head: {
      ...run,
      provenance: {
        scoringVersion,
        semanticStatus,
        semanticReason,
        semanticModel,
        semanticBackend,
        semanticDimension,
        semanticNormalizationVersion,
        semanticProjectionVersion,
        semanticTopicCount,
        semanticAnchorCount,
      },
    },
    executionFacts: {
      fanOutPlannedAt,
      operationEffectiveAt,
      operationUpdatedAt,
      requestDispatchedAt,
      requestExhaustedAt,
      requestUpdatedAt,
      runUpdatedAt,
      sourceImportStage,
      sourceImportUpdatedAt,
      unitUpdatedAt,
    },
  };
}

type RunHeadRead = {
  head: Omit<
    RunHead,
    | "execution"
    | "mine"
    | "progress"
    | "telegramAcquisition"
    | "templateChanged"
  > & { actorId: string };
  executionFacts: {
    fanOutPlannedAt: Date | null;
    operationEffectiveAt: Date;
    operationUpdatedAt: Date;
    requestDispatchedAt: Date | null;
    requestExhaustedAt: Date | null;
    requestUpdatedAt: Date | null;
    runUpdatedAt: Date;
    sourceImportStage: SourceImportStage | null;
    sourceImportUpdatedAt: Date | null;
    unitUpdatedAt: Date | null;
  };
};

function deriveRunExecution(
  head: RunHeadRead["head"],
  facts: RunHeadRead["executionFacts"],
  progress: RunHead["progress"],
): RunExecution {
  const dispatch = facts.requestDispatchedAt
    ? "dispatched"
    : facts.requestExhaustedAt
      ? "exhausted"
      : "pending";
  const elapsedTo = isTerminal(head.lifecycle)
    ? (head.completedAt ?? facts.operationUpdatedAt)
    : null;
  const lastProgressAt = latestDate(
    facts.operationEffectiveAt,
    facts.operationUpdatedAt,
    facts.requestUpdatedAt,
    facts.runUpdatedAt,
    facts.sourceImportUpdatedAt,
    facts.unitUpdatedAt,
    head.cancelRequestedAt,
    head.cancelledAt,
    head.completedAt,
  );

  return {
    dispatch,
    elapsedFrom: facts.operationEffectiveAt,
    elapsedTo,
    lastProgressAt,
    stage: progressStage(head, facts, progress, dispatch),
  };
}

function progressStage(
  head: Pick<
    RunHeadRead["head"],
    "cancelRequestedAt" | "kind" | "lifecycle" | "provenance"
  >,
  facts: RunHeadRead["executionFacts"],
  progress: RunHead["progress"],
  dispatch: RunExecution["dispatch"],
): RunExecution["stage"] {
  if (isTerminal(head.lifecycle)) return head.lifecycle;
  if (head.cancelRequestedAt) return "cancelling";
  if (head.lifecycle === "queued") {
    return dispatch === "dispatched" ? "waitingForWorker" : "queuedForDispatch";
  }
  if (head.lifecycle === "settling") return "settling";
  if (facts.sourceImportStage && facts.sourceImportStage !== "settled") {
    return "acquiring";
  }

  const activeUnits = progress.units.pending + progress.units.running;
  const totalUnits =
    activeUnits +
    progress.units.succeeded +
    progress.units.failed +
    progress.units.cancelled;
  if (facts.fanOutPlannedAt || totalUnits > 0) {
    return activeUnits > 0 ? "models" : "settling";
  }
  if (
    head.provenance.semanticStatus === "running" ||
    head.provenance.semanticStatus === "succeeded" ||
    head.provenance.semanticStatus === "degraded"
  ) {
    return "filtering";
  }
  return "preparing";
}

function isTerminal(lifecycle: OperationLifecycle) {
  return (
    lifecycle === "succeeded" ||
    lifecycle === "failed" ||
    lifecycle === "cancelled" ||
    lifecycle === "unknown"
  );
}

function latestDate(first: Date, ...rest: (Date | null)[]) {
  let latest = first;
  for (const candidate of rest) {
    if (candidate && candidate > latest) latest = candidate;
  }
  return latest;
}

async function readModelLanes(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
): Promise<ModelLane[]> {
  const winningSlot = executor
    .select({ invocationKey: aiUsageEvent.invocationKey })
    .from(aiUsageEvent)
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(
          aiUsageEvent.operationAttemptId,
          analysisModelUnit.operationAttemptId,
        ),
        ne(aiUsageEvent.status, "pending"),
      ),
    )
    .orderBy(desc(COMMITTED_USAGE_FIRST), desc(LADDER_POSITION))
    .limit(1)
    .as("winning_slot");

  const units = await executor
    .select({
      unitId: analysisModelUnit.id,
      mediaBrandId: analysisModelUnit.mediaBrandId,
      brandKey: mediaBrand.key,
      brandName: mediaBrand.name,
      modelOptionKey: analysisModelUnit.modelOptionKey,
      taskKey: analysisModelUnit.taskKey,
      status: analysisModelUnit.status,
      failureCode: analysisModelUnit.failureCode,
      invocationKey: winningSlot.invocationKey,
    })
    .from(analysisModelUnit)
    .innerJoin(mediaBrand, eq(mediaBrand.id, analysisModelUnit.mediaBrandId))
    .leftJoinLateral(winningSlot, sql`true`)
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.analysisRunId, analysisRunId),
      ),
    )
    .orderBy(
      asc(analysisModelUnit.modelOptionKey),
      asc(analysisModelUnit.mediaBrandId),
    );

  if (units.length === 0) {
    return [];
  }

  const unitIds = units.map((unit) => unit.unitId);

  const [selections, promoIdeas] = await Promise.all([
    executor
      .select({
        analysisModelUnitId: editorialSelection.analysisModelUnitId,
        id: editorialSelection.id,
        rank: editorialSelection.rank,
        sourceItemId: editorialSelection.sourceItemId,
        suggestedPlatform: editorialSelection.suggestedPlatform,
        reasoning: editorialSelection.reasoning,
        suitabilityScore: editorialSelection.selectionSuitabilityScore,
        impactScore: editorialSelection.selectionImpactScore,
        viralityScore: editorialSelection.selectionViralityScore,
        confidenceScore: editorialSelection.selectionConfidenceScore,
        title: sourceItemRevision.title,
        summary: sourceItemRevision.summary,
        canonicalUrl: sourceItemRevision.canonicalUrl,
        contentLocale: sourceItemRevision.contentLocale,
        sourceName: source.name,
        sourceOrigin: source.origin,
        publishedAt: sourceItem.publishedAt,
      })
      .from(editorialSelection)
      .innerJoin(
        analysisRunItem,
        and(
          inWorkspace(analysisRunItem, workspaceId),
          eq(analysisRunItem.analysisRunId, analysisRunId),
          eq(analysisRunItem.sourceItemId, editorialSelection.sourceItemId),
        ),
      )
      .innerJoin(
        sourceItemRevision,
        eq(sourceItemRevision.id, analysisRunItem.sourceItemRevisionId),
      )
      .innerJoin(sourceItem, eq(sourceItem.id, editorialSelection.sourceItemId))
      .innerJoin(source, eq(source.id, sourceItem.sourceId))
      .where(
        and(
          inWorkspace(editorialSelection, workspaceId),
          inArray(editorialSelection.analysisModelUnitId, unitIds),
        ),
      )
      .orderBy(
        asc(editorialSelection.analysisModelUnitId),
        asc(editorialSelection.rank),
      ),
    executor
      .select({
        analysisModelUnitId: promoIdea.analysisModelUnitId,
        id: promoIdea.id,
        rank: promoIdea.rank,
        title: promoIdea.title,
        description: promoIdea.description,
        angle: promoIdea.angle,
      })
      .from(promoIdea)
      .where(
        and(
          inWorkspace(promoIdea, workspaceId),
          inArray(promoIdea.analysisModelUnitId, unitIds),
        ),
      )
      .orderBy(asc(promoIdea.analysisModelUnitId), asc(promoIdea.rank)),
  ]);

  const lanes = new Map<string, ModelLane>(
    units.map((unit) => [
      unit.unitId,
      { ...unit, selections: [], promoIdeas: [] },
    ]),
  );

  for (const { analysisModelUnitId, ...card } of selections) {
    lanes
      .get(analysisModelUnitId)
      ?.selections.push(card satisfies SelectionCard);
  }

  for (const { analysisModelUnitId, ...card } of promoIdeas) {
    lanes
      .get(analysisModelUnitId)
      ?.promoIdeas.push(card satisfies PromoIdeaCard);
  }

  return [...lanes.values()];
}

async function readTelegramLanes(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
  sourceImportId: string | null,
): Promise<{ acquisition: TelegramAcquisition; lanes: TelegramLane[] }> {
  if (sourceImportId === null) {
    return {
      acquisition: { acquiredChannels: 0, failures: [], totalChannels: 0 },
      lanes: [],
    };
  }

  const result = await executor.execute<TelegramLaneSqlRow>(sql`
    with channel_acquisition as (
      select
        telegram_source.id,
        telegram_source.endpoint,
        telegram_source.name,
        import_source.outcome,
        import_source.reason,
        import_source.outcome in ('succeeded', 'not_modified') or exists (
          select 1
          from ${sourceImportItem} as acquired_item
          join ${sourceItem} as acquired_source_item
            on acquired_source_item.id = acquired_item.source_item_id
            and acquired_source_item.workspace_id = acquired_item.workspace_id
          where acquired_item.workspace_id = ${workspaceId}
            and acquired_item.source_import_id = ${sourceImportId}
            and acquired_item.admission = 'admitted'
            and acquired_source_item.source_id = import_source.source_id
        ) as acquired
      from ${sourceImportSource} as import_source
      join ${source} as telegram_source
        on telegram_source.id = import_source.source_id
      where import_source.workspace_id = ${workspaceId}
        and import_source.source_import_id = ${sourceImportId}
        and telegram_source.origin = 'telegram_public'
    ),
    acquisition as (
      select
        count(*)::int as "totalChannels",
        count(*) filter (where acquired)::int as "acquiredChannels",
        coalesce(
          array_agg(endpoint order by name, id)
            filter (where not acquired and outcome <> 'pending'),
          array[]::text[]
        ) as "failureChannels",
        coalesce(
          array_agg(
            coalesce(reason::text, outcome::text)
            order by name, id
          ) filter (where not acquired and outcome <> 'pending'),
          array[]::text[]
        ) as "failureCodes"
      from channel_acquisition
    ),
    cards as (
      select
        route.media_brand_id as "mediaBrandId",
        route.id as "telegramFilterResultId",
        brand.key as "brandKey",
        brand.name as "brandName",
        route.source_item_id as "sourceItemId",
        route.rank_position as "rankPosition",
        route.disposition as "disposition",
        route.reason as "reason",
        run_item.duplicate_method as "duplicateMethod",
        run_item.duplicate_of_source_item_id as "duplicateOfSourceItemId",
        run_item.duplicate_similarity_bp as "duplicateSimilarityBp",
        run_item.semantic_participation as "semanticParticipation",
        revision.title as "title",
        revision.summary as "summary",
        revision.canonical_url as "canonicalUrl",
        revision.content_locale as "contentLocale",
        item_source.endpoint as "channelHandle",
        item_source.name as "sourceName",
        item.published_at as "publishedAt",
        import_item.views::int as "views",
        import_item.rank as "sourceRank",
        import_item.keyword_score as "keywordScore",
        import_run.ordering_mode as "orderingMode",
        (
          select count(*)::int
          from ${analysisRunItem} as duplicate_item
          join ${sourceItem} as duplicate_source_item
            on duplicate_source_item.id = duplicate_item.source_item_id
          join ${source} as duplicate_source
            on duplicate_source.id = duplicate_source_item.source_id
          where duplicate_item.workspace_id = ${workspaceId}
            and duplicate_item.analysis_run_id = ${analysisRunId}
            and duplicate_item.duplicate_of_source_item_id = route.source_item_id
            and duplicate_source.origin = 'rss'
        ) as "duplicateRssCount"
      from ${filterResult} as route
      join ${mediaBrand} as brand on brand.id = route.media_brand_id
      join ${analysisRunItem} as run_item
        on run_item.workspace_id = ${workspaceId}
        and run_item.analysis_run_id = route.analysis_run_id
        and run_item.source_item_id = route.source_item_id
      join ${sourceItemRevision} as revision
        on revision.id = run_item.source_item_revision_id
      join ${sourceItem} as item on item.id = route.source_item_id
      join ${source} as item_source on item_source.id = item.source_id
      join ${sourceImport} as import_run on import_run.id = ${sourceImportId}
      left join ${sourceImportItem} as import_item
        on import_item.workspace_id = ${workspaceId}
        and import_item.source_import_id = import_run.id
        and import_item.source_item_id = route.source_item_id
      where route.workspace_id = ${workspaceId}
        and route.analysis_run_id = ${analysisRunId}
        and route.disposition = 'telegram_lane'
    )
    select acquisition.*, cards.*
    from acquisition
    left join cards on true
    order by cards."mediaBrandId", cards."rankPosition", cards."sourceItemId"
  `);

  const lanes = new Map<string, TelegramLane>();
  const [first] = result.rows;

  const acquisition: TelegramAcquisition = first
    ? {
        acquiredChannels: first.acquiredChannels,
        failures: first.failureCodes.flatMap((code, index) => {
          const channelHandle = first.failureChannels[index];
          return channelHandle ? [{ channelHandle, code }] : [];
        }),
        totalChannels: first.totalChannels,
      }
    : { acquiredChannels: 0, failures: [], totalChannels: 0 };

  for (const row of result.rows) {
    if (row.sourceItemId === null) continue;

    const { brandKey, brandName, mediaBrandId } = row;
    let lane = lanes.get(mediaBrandId);

    if (!lane) {
      lane = { mediaBrandId, brandKey, brandName, cards: [] };
      lanes.set(mediaBrandId, lane);
    }

    lane.cards.push({
      canonicalUrl: row.canonicalUrl,
      channelHandle: row.channelHandle,
      contentLocale: row.contentLocale,
      disposition: row.disposition,
      duplicateMethod: row.duplicateMethod,
      duplicateOfSourceItemId: row.duplicateOfSourceItemId,
      duplicateRssCount: row.duplicateRssCount,
      duplicateSimilarityBp: row.duplicateSimilarityBp,
      keywordScore: row.keywordScore,
      orderingMode: row.orderingMode,
      publishedAt: row.publishedAt === null ? null : new Date(row.publishedAt),
      rankPosition: row.rankPosition,
      reason: row.reason,
      semanticParticipation: row.semanticParticipation,
      sourceItemId: row.sourceItemId,
      telegramFilterResultId: row.telegramFilterResultId,
      sourceName: row.sourceName,
      sourceRank: row.sourceRank,
      summary: row.summary,
      title: row.title,
      views: row.views,
    });
  }

  return { acquisition, lanes: [...lanes.values()] };
}

type TelegramAcquisitionSql = {
  acquiredChannels: number;
  failureChannels: string[];
  failureCodes: (SourceFetchOutcome | SourceFetchReason)[];
  totalChannels: number;
};

type TelegramLaneSqlRow = TelegramAcquisitionSql &
  (
    | { sourceItemId: null }
    | (Omit<TelegramCard, "publishedAt"> & {
        brandKey: string;
        brandName: string;
        mediaBrandId: string;
        publishedAt: string | null;
      })
  );

export async function readRunFilters(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
): Promise<ReportBrandOption[]> {
  return executor
    .selectDistinct({
      id: mediaBrand.id,
      key: mediaBrand.key,
      name: mediaBrand.name,
    })
    .from(filterResult)
    .innerJoin(mediaBrand, eq(mediaBrand.id, filterResult.mediaBrandId))
    .where(
      and(
        inWorkspace(filterResult, workspaceId),
        eq(filterResult.analysisRunId, analysisRunId),
      ),
    )
    .orderBy(asc(mediaBrand.name));
}

export async function readRunOptions(
  executor: Executor,
  workspaceId: string,
): Promise<{
  runs: {
    actorId: string;
    actorName: string;
    configuration: RunConfiguration;
    id: string;
    kind: RunOption["kind"];
    lifecycle: RunOption["lifecycle"];
    startedAt: Date;
    templateFingerprint: string;
  }[];
  recentTopics: string[];
}> {
  const [runs, topics] = await Promise.all([
    executor
      .select({
        id: analysisRun.id,
        kind: analysisRun.kind,
        lifecycle: operation.lifecycle,
        startedAt: analysisRun.startedAt,
        templateFingerprint: analysisRun.templateFingerprint,
        actorId: operation.actor,
        actorName: user.name,
        configuration: analysisRun.configuration,
      })
      .from(analysisRun)
      .innerJoin(operation, eq(operation.id, analysisRun.operationId))
      .innerJoin(user, eq(user.id, operation.actor))
      .where(inWorkspace(analysisRun, workspaceId))
      .orderBy(desc(analysisRun.startedAt), desc(analysisRun.id))
      .limit(RECENT_TOPIC_RUNS),
    // Newest authored spelling wins, over the same bounded run window.
    executor.execute<{ topic: string }>(sql`
      select folded.topic
      from (
        select distinct on (fold_unique_name_v1(topic)) topic, recent.started_at
        from (
          select runs.configuration, runs.started_at
          from ${analysisRun} as runs
          where runs.workspace_id = ${workspaceId}
          order by runs.started_at desc, runs.id desc
          limit ${RECENT_TOPIC_RUNS}
        ) as recent,
        jsonb_array_elements_text(recent.configuration -> 'topics') as topic
        where jsonb_exists(recent.configuration, 'topics')
        order by fold_unique_name_v1(topic), recent.started_at desc
      ) as folded
      order by folded.started_at desc
      limit ${RECENT_TOPIC_LIMIT}
    `),
  ]);

  return { runs, recentTopics: topics.rows.map((row) => row.topic) };
}

export async function readRunReportPage(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
  query: ReportQuery,
  mediaFitByBrandKey: Record<string, number>,
): Promise<ReportPage> {
  const plan = reportBranchPlan(query);
  const cursor = decodeKeysetCursor(reportCursorSchema, query.cursor);
  const direction = cursor?.direction ?? "next";

  if (!plan.includeRoutes && !plan.includeDuplicates) {
    return {
      rows: [],
      nextCursor: null,
      previousCursor: null,
      offFirst: cursor !== null,
    };
  }

  const branches = [
    plan.includeRoutes
      ? routeBranch(workspaceId, analysisRunId, query, plan.routeDisposition)
      : null,
    plan.includeDuplicates
      ? duplicateBranch(workspaceId, analysisRunId, query)
      : null,
  ].filter((branch) => branch !== null);

  const keyset = cursor
    ? sql`and (page."bucket", page."sortRank", page."sourceItemId", page."mediaBrandId") ${
        direction === "next" ? sql`>` : sql`<`
      } (${cursor.bucket}, ${cursor.sortRank}, ${cursor.sourceItemId}::uuid, ${cursor.mediaBrandId}::uuid)`
    : sql``;

  const ordering =
    direction === "next"
      ? sql`order by page."bucket", page."sortRank", page."sourceItemId", page."mediaBrandId"`
      : sql`order by page."bucket" desc, page."sortRank" desc, page."sourceItemId" desc, page."mediaBrandId" desc`;

  const result = await executor.execute<ReportSqlRow>(sql`
    select page.*
    from (${sql.join(branches, sql` union all `)}) as page
    where true ${keyset}
    ${ordering}
    limit ${REPORT_PAGE_SIZE + 1}
  `);

  const hasExtra = result.rows.length > REPORT_PAGE_SIZE;
  const bounded = result.rows.slice(0, REPORT_PAGE_SIZE);
  const ordered = direction === "previous" ? bounded.toReversed() : bounded;
  const first = ordered[0];
  const last = ordered.at(-1);
  const offFirst = cursor !== null;

  return {
    rows: ordered.map((row) => reportRowOf(row, mediaFitByBrandKey)),
    nextCursor:
      last && (direction === "previous" || hasExtra)
        ? encodeKeysetCursor(cursorOf(last, "next"))
        : null,
    previousCursor:
      first && offFirst && (direction === "next" || hasExtra)
        ? encodeKeysetCursor(cursorOf(first, "previous"))
        : null,
    offFirst,
  };
}

type ReportSqlRow = Omit<
  ReportRow,
  "mediaBrandId" | "mediaFitThreshold" | "publishedAt"
> & {
  bucket: number;
  sortRank: number;
  mediaBrandId: string;
  publishedAt: string | null;
};

function cursorOf(
  row: ReportSqlRow,
  direction: ReportCursor["direction"],
): ReportCursor {
  return {
    direction,
    bucket: row.bucket,
    sortRank: row.sortRank,
    sourceItemId: row.sourceItemId,
    mediaBrandId: row.mediaBrandId,
  };
}

function reportRowOf(
  { bucket, sortRank, mediaBrandId, publishedAt, ...row }: ReportSqlRow,
  mediaFitByBrandKey: Record<string, number>,
): ReportRow {
  return {
    ...row,
    mediaBrandId: row.brandKey === null ? null : mediaBrandId,
    mediaFitThreshold:
      row.brandKey === null ? null : (mediaFitByBrandKey[row.brandKey] ?? null),
    publishedAt: publishedAt === null ? null : new Date(publishedAt),
  };
}

// Read the pinned revision so later source revisions cannot reinterpret a stored score.
function routeBranch(
  workspaceId: string,
  analysisRunId: string,
  query: ReportQuery,
  routeDisposition: FilterDisposition | null,
) {
  return sql`
    select
      case when route.rank_position is not null then 0 else 1 end as "bucket",
      coalesce(route.rank_position, 0) as "sortRank",
      route.source_item_id as "sourceItemId",
      route.media_brand_id as "mediaBrandId",
      brand.key as "brandKey",
      brand.name as "brandName",
      run_item.eligibility as "eligibility",
      route.disposition::text as "disposition",
      route.reason as "reason",
      route.rank_position as "rankPosition",
      route.value_signal_count as "valueSignalCount",
      route.media_fit_score as "mediaFitScore",
      route.source_preference_score as "sourcePreferenceScore",
      route.diversity_score as "diversityScore",
      route.semantic_brand_score as "semanticBrandScore",
      route.policy_score as "policyScore",
      route.rank_score as "rankScore",
      run_item.source_authority_score as "sourceAuthorityScore",
      run_item.freshness_score as "freshnessScore",
      run_item.policy_virality_score as "policyViralityScore",
      run_item.lexical_topic_score as "lexicalTopicScore",
      run_item.lexical_topic_index as "lexicalTopicIndex",
      run_item.semantic_topic_score as "semanticTopicScore",
      run_item.semantic_topic_index as "semanticTopicIndex",
      run_item.semantic_participation as "semanticParticipation",
      run_item.duplicate_method as "duplicateMethod",
      run_item.duplicate_of_source_item_id as "duplicateOfSourceItemId",
      null::text as "duplicateOfTitle",
      null as "duplicateOfOrigin",
      run_item.duplicate_similarity_bp as "duplicateSimilarityBp",
      revision.title as "title",
      revision.summary as "summary",
      revision.canonical_url as "canonicalUrl",
      revision.content_locale as "contentLocale",
      item_source.name as "sourceName",
      item_source.origin as "sourceOrigin",
      item_source.endpoint as "sourceEndpoint",
      import_item.rank as "sourceRank",
      import_run.ordering_mode::text as "orderingMode",
      import_item.views::int as "views",
      item.published_at as "publishedAt"
    from ${filterResult} as route
    join ${mediaBrand} as brand on brand.id = route.media_brand_id
    join ${analysisRunItem} as run_item
      on run_item.workspace_id = ${workspaceId}
      and run_item.analysis_run_id = route.analysis_run_id
      and run_item.source_item_id = route.source_item_id
    join ${sourceItemRevision} as revision
      on revision.id = run_item.source_item_revision_id
    join ${sourceItem} as item on item.id = route.source_item_id
    join ${source} as item_source on item_source.id = item.source_id
    join ${analysisRun} as report_run on report_run.id = route.analysis_run_id
    left join ${sourceImport} as import_run
      on import_run.id = report_run.source_import_id
    left join ${sourceImportItem} as import_item
      on import_item.workspace_id = ${workspaceId}
      and import_item.source_import_id = import_run.id
      and import_item.source_item_id = route.source_item_id
    where route.workspace_id = ${workspaceId}
      and route.analysis_run_id = ${analysisRunId}
      ${query.brand ? sql`and route.media_brand_id = ${query.brand}::uuid` : sql``}
      ${routeDisposition ? sql`and route.disposition = ${routeDisposition}` : sql``}
      ${query.semantic ? sql`and run_item.semantic_participation = ${query.semantic}` : sql``}
  `;
}

// Duplicate-only rows have no brand route, so route-owned scores remain absent.
function duplicateBranch(
  workspaceId: string,
  analysisRunId: string,
  query: ReportQuery,
) {
  return sql`
    select
      2 as "bucket",
      0 as "sortRank",
      run_item.source_item_id as "sourceItemId",
      ${DUPLICATE_BRAND_ID}::uuid as "mediaBrandId",
      null::text as "brandKey",
      null::text as "brandName",
      run_item.eligibility as "eligibility",
      'duplicate'::text as "disposition",
      null as "reason",
      null::int as "rankPosition",
      null::smallint as "valueSignalCount",
      null::smallint as "mediaFitScore",
      null::smallint as "sourcePreferenceScore",
      null::smallint as "diversityScore",
      null::smallint as "semanticBrandScore",
      null::smallint as "policyScore",
      null::smallint as "rankScore",
      run_item.source_authority_score as "sourceAuthorityScore",
      run_item.freshness_score as "freshnessScore",
      run_item.policy_virality_score as "policyViralityScore",
      run_item.lexical_topic_score as "lexicalTopicScore",
      run_item.lexical_topic_index as "lexicalTopicIndex",
      run_item.semantic_topic_score as "semanticTopicScore",
      run_item.semantic_topic_index as "semanticTopicIndex",
      run_item.semantic_participation as "semanticParticipation",
      run_item.duplicate_method as "duplicateMethod",
      run_item.duplicate_of_source_item_id as "duplicateOfSourceItemId",
      survivor_revision.title as "duplicateOfTitle",
      survivor_source.origin as "duplicateOfOrigin",
      run_item.duplicate_similarity_bp as "duplicateSimilarityBp",
      revision.title as "title",
      revision.summary as "summary",
      revision.canonical_url as "canonicalUrl",
      revision.content_locale as "contentLocale",
      item_source.name as "sourceName",
      item_source.origin as "sourceOrigin",
      item_source.endpoint as "sourceEndpoint",
      null::int as "sourceRank",
      null::text as "orderingMode",
      null::int as "views",
      item.published_at as "publishedAt"
    from ${analysisRunItem} as run_item
    join ${sourceItemRevision} as revision
      on revision.id = run_item.source_item_revision_id
    join ${sourceItem} as item on item.id = run_item.source_item_id
    join ${source} as item_source on item_source.id = item.source_id
    left join ${analysisRunItem} as survivor
      on survivor.workspace_id = ${workspaceId}
      and survivor.analysis_run_id = run_item.analysis_run_id
      and survivor.source_item_id = run_item.duplicate_of_source_item_id
    left join ${sourceItemRevision} as survivor_revision
      on survivor_revision.id = survivor.source_item_revision_id
    left join ${sourceItem} as survivor_item
      on survivor_item.id = run_item.duplicate_of_source_item_id
    left join ${source} as survivor_source
      on survivor_source.id = survivor_item.source_id
    where run_item.workspace_id = ${workspaceId}
      and run_item.analysis_run_id = ${analysisRunId}
      and run_item.eligibility = 'duplicate'
      ${query.semantic ? sql`and run_item.semantic_participation = ${query.semantic}` : sql``}
  `;
}

export async function readRunLifecycle(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
) {
  const [row] = await executor
    .select({
      operationId: analysisRun.operationId,
      lifecycle: operation.lifecycle,
    })
    .from(analysisRun)
    .innerJoin(operation, eq(operation.id, analysisRun.operationId))
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, analysisRunId),
      ),
    );

  return row;
}

export async function selectAnalysisRunSources(
  executor: Executor,
  workspaceId: string,
  sourceIds: readonly string[],
): Promise<{ id: string; origin: SourceOrigin }[]> {
  if (sourceIds.length === 0) return [];

  return executor
    .select({ id: source.id, origin: source.origin })
    .from(source)
    .where(
      and(
        inWorkspace(source, workspaceId),
        inArray(source.id, [...sourceIds]),
        eq(source.enabled, true),
        isNull(source.deletedAt),
      ),
    );
}
