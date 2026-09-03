import "server-only";

import {
  type CardOriginReference,
  type ContentLocale,
  type FilterDisposition,
  type FilteringReason,
  isOperationSettled,
  type ModelUnitStatus,
  OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
  type OperationLifecycle,
  type RunCardOriginReference,
  type RunConfiguration,
  type SourceFetchOutcome,
  type SourceFetchReason,
  type SourceImportStage,
  type SourceOrigin,
} from "@rz-chain-reporter/contracts";
import type { Executor, Transaction } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { analysisRunProgress } from "@rz-chain-reporter/db/repositories/analysis-run";
import {
  readCopyVariantLocalizations,
  readCopyVariantTranslationStatuses,
} from "@rz-chain-reporter/db/repositories/copy-variant-localization";
import { ownedDraftExists } from "@rz-chain-reporter/db/repositories/draft-origin";
import {
  type EditorialPresentationTranslationStatus,
  readEditorialPresentationTranslationStatuses,
} from "@rz-chain-reporter/db/repositories/editorial-presentation-localization-request";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { analysisRunItem } from "@rz-chain-reporter/db/schema/analysis-run-item";
import { approval } from "@rz-chain-reporter/db/schema/approval";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { copyGeneration } from "@rz-chain-reporter/db/schema/copy-generation";
import { copyGenerationUnit } from "@rz-chain-reporter/db/schema/copy-generation-unit";
import { copyVariant } from "@rz-chain-reporter/db/schema/copy-variant";
import { destinationAccount } from "@rz-chain-reporter/db/schema/destination-account";
import { draftRevision } from "@rz-chain-reporter/db/schema/draft-revision";
import { editorialPresentationLocalization } from "@rz-chain-reporter/db/schema/editorial-presentation-localization";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { filterResult } from "@rz-chain-reporter/db/schema/filter-result";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { mediaBrandDestinationAccount } from "@rz-chain-reporter/db/schema/media-brand-destination-account";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { promoIdea } from "@rz-chain-reporter/db/schema/promo-idea";
import { publication } from "@rz-chain-reporter/db/schema/publication";
import { publishCheckpoint } from "@rz-chain-reporter/db/schema/publish-checkpoint";
import { publishOperation } from "@rz-chain-reporter/db/schema/publish-operation";
import { publishingControl } from "@rz-chain-reporter/db/schema/publishing-control";
import { savedCard } from "@rz-chain-reporter/db/schema/saved-card";
import { schedule } from "@rz-chain-reporter/db/schema/schedule";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceImport } from "@rz-chain-reporter/db/schema/source-import";
import { sourceImportItem } from "@rz-chain-reporter/db/schema/source-import-item";
import { sourceImportSource } from "@rz-chain-reporter/db/schema/source-import-source";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
} from "@/features/shared/lib/keyset-cursor";

import {
  RECENT_TOPIC_LIMIT,
  RECENT_TOPIC_RUNS,
  REPORT_PAGE_SIZE,
} from "../constants";
import type {
  PlatformDraftCard,
  PlatformDraftExactCard,
} from "../schemas/drafts";
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
  PresentationTranslationStatus,
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

const sourcePresentation = alias(
  editorialPresentationLocalization,
  "source_presentation",
);
const selectionPresentation = alias(
  editorialPresentationLocalization,
  "selection_presentation",
);
const promoPresentation = alias(
  editorialPresentationLocalization,
  "promo_presentation",
);
const platformSourcePresentation = alias(
  editorialPresentationLocalization,
  "platform_source_presentation",
);
const platformSelectionPresentation = alias(
  editorialPresentationLocalization,
  "platform_selection_presentation",
);
const platformPromoPresentation = alias(
  editorialPresentationLocalization,
  "platform_promo_presentation",
);

export async function ownedDraftSelectedMediaExists(
  executor: Executor,
  workspaceId: string,
  userId: string,
  mediaAssetId: string,
) {
  const [row] = await executor
    .select({ id: draftRevision.id })
    .from(draftRevision)
    .innerJoin(
      platformDraft,
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, draftRevision.platformDraftId),
        isNull(platformDraft.deletedAt),
      ),
    )
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.selectedFinalMediaAssetId, mediaAssetId),
        ownedDraftExists(workspaceId, userId, platformDraft.id),
      ),
    )
    .limit(1);
  return row !== undefined;
}

export async function readEditorialWorkspace(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisRunId: string,
  presentationLocale: ContentLocale,
) {
  const selected = await readRunHead(
    executor,
    workspaceId,
    userId,
    analysisRunId,
  );

  if (!selected) {
    return { head: null, modelLanes: [], telegramLanes: [] };
  }

  const { executionFacts, head } = selected;

  const [modelLanes, telegram, progress] = await Promise.all([
    readModelLanes(executor, workspaceId, head.id, presentationLocale),
    readTelegramLanes(
      executor,
      workspaceId,
      head.id,
      head.sourceImportId,
      presentationLocale,
    ),
    analysisRunProgress(executor, workspaceId, [head.id]),
  ]);

  const runProgress = progress[head.id];
  const translationStatuses =
    await readEditorialPresentationTranslationStatuses(
      executor,
      workspaceId,
      userId,
      editorialWorkspaceOrigins(modelLanes, telegram.lanes),
      presentationLocale,
    );
  const translationByOrigin =
    presentationTranslationByOrigin(translationStatuses);
  const presentedModelLanes = modelLanes.map((lane) => ({
    ...lane,
    selections: lane.selections.map((card) => ({
      ...card,
      presentationTranslation:
        translationByOrigin.get(
          presentationOriginKey({
            kind: "editorial_selection",
            editorialSelectionId: card.id,
          }),
        ) ?? null,
    })),
    promoIdeas: lane.promoIdeas.map((card) => ({
      ...card,
      presentationTranslation:
        translationByOrigin.get(
          presentationOriginKey({
            kind: "promo_idea",
            promoIdeaId: card.id,
          }),
        ) ?? null,
    })),
  }));
  const presentedTelegramLanes = telegram.lanes.map((lane) => ({
    ...lane,
    cards: lane.cards.map((card) => ({
      ...card,
      presentationTranslation:
        translationByOrigin.get(
          presentationOriginKey({
            kind: "telegram_filter_result",
            telegramFilterResultId: card.telegramFilterResultId,
          }),
        ) ?? null,
    })),
  }));

  return {
    head: runProgress
      ? {
          ...head,
          execution: deriveRunExecution(head, executionFacts, runProgress),
          progress: runProgress,
          telegramAcquisition: telegram.acquisition,
        }
      : null,
    modelLanes: presentedModelLanes,
    telegramLanes: presentedTelegramLanes,
  };
}

type PlatformDraftProjectionRow = {
  id: string;
  analysisRunId: string | null;
  marketAnalysisId: string | null;
  originLifecycle: OperationLifecycle;
  mediaBrandId: string;
  brandKey: string;
  brandName: string;
  platform: PlatformDraftCard["platform"];
  lanePosition: number | null;
  version: number;
  activeRevisionId: string | null;
  revisionVersion: number;
  projectionVersion: number;
  editorialSelectionId: string | null;
  telegramFilterResultId: string | null;
  promoIdeaId: string | null;
  marketAnalysisHandoffId: string | null;
  originTitle: string;
  presentationReady: boolean;
  sourceKind: "market" | "promo" | "rss" | "telegram";
  originSourceName: string | null;
  originPublishedAt: string | null;
  originCanonicalUrl: string | null;
  originSummary: string | null;
  originContentLocale: ContentLocale | null;
  originSuitabilityScore: number | null;
  originReasoning: string | null;
  originSuggestedPlatform: PlatformDraftCard["platform"] | null;
  originTelegramReason: FilteringReason | null;
  originPromoAngle: string | null;
  originVerifiedFacts: unknown | null;
  operationId: string | null;
  lifecycle: OperationLifecycle | null;
  modelOptionKey: string | null;
  requestedContentLocale: ContentLocale | null;
  limited: boolean | null;
  forceArticleRefresh: boolean | null;
  generationCreatedAt: string | null;
  imageOperationId: string | null;
  imageDraftRevisionId: string | null;
  imageLifecycle: OperationLifecycle | null;
  imageModelOptionKey: string | null;
  imageReferenceMediaAssetId: string | null;
  imageProviderOriginalMediaAssetId: string | null;
  imageFinalMediaAssetId: string | null;
  imageCreatedAt: string | null;
  publishingPaused: boolean | null;
  publishingControlVersion: number | null;
};

type PlatformDraftSelector =
  | { analysisRunId: string; platformDraftId?: never }
  | { analysisRunId?: never; platformDraftId: string };

type PlatformDraftRead = {
  analysisRunId: string | null;
  executionScope:
    | { kind: "analysis_run"; analysisRunId: string }
    | { kind: "market_analysis"; marketAnalysisId: string };
  lifecycle: OperationLifecycle;
  card: PlatformDraftExactCard;
};

type PlatformDraftLaneRead = {
  analysisRunId: string;
  executionScope: { kind: "analysis_run"; analysisRunId: string };
  lifecycle: OperationLifecycle;
  card: PlatformDraftCard;
};

export function readPlatformDrafts(
  database: Executor,
  workspaceId: string,
  selector: { analysisRunId: string; platformDraftId?: never },
  userId: string,
  environmentForcedPause: boolean,
  timeZone: string,
  presentationLocale: ContentLocale,
): Promise<PlatformDraftLaneRead[]>;
export function readPlatformDrafts(
  database: Executor,
  workspaceId: string,
  selector: { analysisRunId?: never; platformDraftId: string },
  userId: string,
  environmentForcedPause: boolean,
  timeZone: string,
  presentationLocale: ContentLocale,
): Promise<PlatformDraftRead[]>;

export async function readPlatformDrafts(
  database: Executor,
  workspaceId: string,
  selector: PlatformDraftSelector,
  userId: string,
  environmentForcedPause: boolean,
  timeZone: string,
  presentationLocale: ContentLocale,
): Promise<PlatformDraftRead[] | PlatformDraftLaneRead[]> {
  return database.transaction(
    async (executor) => {
      const selectorSql =
        "analysisRunId" in selector
          ? sql`origin_run.id = ${selector.analysisRunId}::uuid`
          : sql`draft.id = ${selector.platformDraftId}::uuid`;
      const sourcePresentationReadySql = sql`(
        origin_revision.content_locale = ${presentationLocale}
        or (
          ${platformSourcePresentation.title} is not null
          and (
            origin_revision.summary is null
            or ${platformSourcePresentation.summary} is not null
          )
        )
      )`;
      const selectionPresentationReadySql =
        presentationLocale === "en"
          ? sql`true`
          : sql`(
              selection.reasoning is null
              or ${platformSelectionPresentation.reasoning} is not null
            )`;
      const promoPresentationReadySql =
        presentationLocale === "en"
          ? sql`true`
          : sql`(
              ${platformPromoPresentation.title} is not null
              and ${platformPromoPresentation.description} is not null
              and ${platformPromoPresentation.angle} is not null
            )`;
      const presentationReadySql = sql`(
        draft.market_analysis_handoff_id is not null
        or
        (
          draft.promo_idea_id is not null
          and ${promoPresentationReadySql}
        )
        or (
          draft.promo_idea_id is null
          and ${sourcePresentationReadySql}
          and ${selectionPresentationReadySql}
        )
      )`;
      const sourceTitleSql = sql`case
        when ${presentationReadySql}
          and origin_revision.content_locale <> ${presentationLocale}
          then ${platformSourcePresentation.title}
        else origin_revision.title
      end`;
      const sourceSummarySql = sql`case
        when ${presentationReadySql}
          and origin_revision.content_locale <> ${presentationLocale}
          then ${platformSourcePresentation.summary}
        else origin_revision.summary
      end`;
      const promoTitleSql = sql`case
        when ${presentationReadySql} and ${presentationLocale} <> 'en'
          then ${platformPromoPresentation.title}
        else promo.title
      end`;
      const promoDescriptionSql = sql`case
        when ${presentationReadySql} and ${presentationLocale} <> 'en'
          then ${platformPromoPresentation.description}
        else promo.description
      end`;
      const promoAngleSql = sql`case
        when ${presentationReadySql} and ${presentationLocale} <> 'en'
          then ${platformPromoPresentation.angle}
        else promo.angle
      end`;
      const selectionReasoningSql = sql`case
        when ${presentationReadySql} and ${presentationLocale} <> 'en'
          then ${platformSelectionPresentation.reasoning}
        else selection.reasoning
      end`;
      const result = await executor.execute<PlatformDraftProjectionRow>(sql`
    select
      draft.id,
      origin_run.id as "analysisRunId",
      market_analysis.id as "marketAnalysisId",
      coalesce(origin_operation.lifecycle, market_owner_operation.lifecycle) as "originLifecycle",
      draft.media_brand_id as "mediaBrandId",
      brand.key as "brandKey",
      brand.name as "brandName",
      draft.platform,
      draft.lane_position as "lanePosition",
      draft.version,
      draft.active_revision_id as "activeRevisionId",
      draft.revision_version as "revisionVersion",
      draft.projection_version as "projectionVersion",
      draft.editorial_selection_id as "editorialSelectionId",
      draft.telegram_filter_result_id as "telegramFilterResultId",
      draft.promo_idea_id as "promoIdeaId",
      draft.market_analysis_handoff_id as "marketAnalysisHandoffId",
      coalesce(${sourceTitleSql}, ${promoTitleSql}, market_handoff.story_headline) as "originTitle",
      ${presentationReadySql} as "presentationReady",
      case
        when draft.market_analysis_handoff_id is not null then 'market'
        when draft.promo_idea_id is not null then 'promo'
        when draft.telegram_filter_result_id is not null or origin_item.origin = 'telegram_public' then 'telegram'
        else 'rss'
      end as "sourceKind",
      origin_source.name as "originSourceName",
      origin_item.published_at as "originPublishedAt",
      origin_revision.canonical_url as "originCanonicalUrl",
      coalesce(${sourceSummarySql}, ${promoDescriptionSql}, market_handoff.story_supporting_text) as "originSummary",
      coalesce(origin_revision.content_locale, market_handoff.content_locale) as "originContentLocale",
      selection.selection_suitability_score as "originSuitabilityScore",
      ${selectionReasoningSql} as "originReasoning",
      coalesce(selection.suggested_platform, draft.platform) as "originSuggestedPlatform",
      telegram.reason as "originTelegramReason",
      ${promoAngleSql} as "originPromoAngle",
      market_handoff.verified_facts as "originVerifiedFacts",
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
      , ${publishingControl.paused} as "publishingPaused"
      , ${publishingControl.version} as "publishingControlVersion"
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
    left join filter_result telegram
      on telegram.id = draft.telegram_filter_result_id
      and telegram.workspace_id = draft.workspace_id
    left join promo_idea promo
      on promo.id = draft.promo_idea_id
      and promo.workspace_id = draft.workspace_id
    left join analysis_model_unit promo_unit
      on promo_unit.id = promo.analysis_model_unit_id
      and promo_unit.workspace_id = draft.workspace_id
    left join analysis_run origin_run
      on origin_run.id = coalesce(
        selection_unit.analysis_run_id,
        telegram.analysis_run_id,
        promo_unit.analysis_run_id
      )
      and origin_run.workspace_id = draft.workspace_id
    left join operation origin_operation
      on origin_operation.id = origin_run.operation_id
      and origin_operation.workspace_id = draft.workspace_id
    left join market_analysis_handoff market_handoff
      on market_handoff.id = draft.market_analysis_handoff_id
      and market_handoff.workspace_id = draft.workspace_id
    left join market_analysis market_analysis
      on market_analysis.id = market_handoff.market_analysis_id
      and market_analysis.workspace_id = draft.workspace_id
    left join operation market_owner_operation
      on market_owner_operation.id = market_analysis.operation_id
      and market_owner_operation.workspace_id = draft.workspace_id
    left join ${publishingControl}
      on ${publishingControl.workspaceId} = draft.workspace_id
    left join source_item origin_item
      on origin_item.id = coalesce(selection.source_item_id, telegram.source_item_id)
      and origin_item.workspace_id = draft.workspace_id
    left join source origin_source
      on origin_source.id = origin_item.source_id
      and origin_source.workspace_id = draft.workspace_id
    left join analysis_run_item origin_run_item
      on origin_run_item.workspace_id = draft.workspace_id
      and origin_run_item.analysis_run_id = origin_run.id
      and origin_run_item.source_item_id = origin_item.id
    left join source_item_revision origin_revision
      on origin_revision.id = origin_run_item.source_item_revision_id
      and origin_revision.workspace_id = draft.workspace_id
    left join ${editorialPresentationLocalization} as platform_source_presentation
      on ${platformSourcePresentation.workspaceId} = draft.workspace_id
      and ${platformSourcePresentation.sourceItemRevisionId} = origin_revision.id
      and ${platformSourcePresentation.presentationLocale} = ${presentationLocale}
    left join ${editorialPresentationLocalization} as platform_selection_presentation
      on ${platformSelectionPresentation.workspaceId} = draft.workspace_id
      and ${platformSelectionPresentation.editorialSelectionId} = selection.id
      and ${platformSelectionPresentation.presentationLocale} = ${presentationLocale}
    left join ${editorialPresentationLocalization} as platform_promo_presentation
      on ${platformPromoPresentation.workspaceId} = draft.workspace_id
      and ${platformPromoPresentation.promoIdeaId} = promo.id
      and ${platformPromoPresentation.presentationLocale} = ${presentationLocale}
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
      inner join operation generation_operation
        on generation_operation.id = generation.operation_id
        and generation_operation.workspace_id = generation.workspace_id
      where generation.workspace_id = draft.workspace_id
        and generation.draft_revision_id = draft.active_revision_id
      order by generation.created_at desc, generation.operation_id desc
      limit 1
    ) latest_image on true
    where draft.workspace_id = ${workspaceId}::uuid
      and draft.deleted_at is null
      and coalesce(origin_operation.actor, market_owner_operation.actor) = ${userId}
      and ${selectorSql}
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
      const variants =
        draftIds.length === 0
          ? []
          : await executor
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
              .innerJoin(
                operation,
                and(
                  inWorkspace(operation, workspaceId),
                  eq(operation.id, copyGeneration.operationId),
                ),
              )
              .where(
                and(
                  inWorkspace(copyVariant, workspaceId),
                  eq(operation.lifecycle, "succeeded"),
                  sql`(
                    (
                      ${operation.commandType} in (
                        'copy-generation:route',
                        'copy-generation:regenerate',
                        'copy-generation:refresh_article'
                      )
                      and not exists (
                        select 1
                        from copy_generation newer_generation
                        inner join operation newer_operation
                          on newer_operation.id = newer_generation.operation_id
                          and newer_operation.workspace_id = newer_generation.workspace_id
                        where newer_generation.workspace_id = ${copyGeneration.workspaceId}
                          and newer_generation.platform_draft_id = ${copyGeneration.platformDraftId}
                          and newer_generation.requested_content_locale = ${copyGeneration.requestedContentLocale}
                          and newer_operation.lifecycle = 'succeeded'
                          and newer_operation.command_type in (
                            'copy-generation:route',
                            'copy-generation:regenerate',
                            'copy-generation:refresh_article'
                          )
                          and (newer_generation.created_at, newer_generation.operation_id)
                            > (${copyGeneration.createdAt}, ${copyGeneration.operationId})
                      )
                    )
                    or (
                      ${operation.commandType} = 'copy-generation:retry_failed'
                      and exists (
                        select 1
                        from copy_generation prior_generation
                        inner join operation prior_operation
                          on prior_operation.id = prior_generation.operation_id
                          and prior_operation.workspace_id = prior_generation.workspace_id
                        where prior_generation.workspace_id = ${copyGeneration.workspaceId}
                          and prior_generation.platform_draft_id = ${copyGeneration.platformDraftId}
                          and prior_generation.requested_content_locale = ${copyGeneration.requestedContentLocale}
                          and prior_operation.lifecycle in ('succeeded', 'failed', 'cancelled', 'unknown')
                          and prior_operation.command_type in (
                            'copy-generation:route',
                            'copy-generation:regenerate',
                            'copy-generation:refresh_article'
                          )
                          and (prior_generation.created_at, prior_generation.operation_id)
                            < (${copyGeneration.createdAt}, ${copyGeneration.operationId})
                      )
                      and not exists (
                        select 1
                        from copy_generation later_generation
                        inner join operation later_operation
                          on later_operation.id = later_generation.operation_id
                          and later_operation.workspace_id = later_generation.workspace_id
                        where later_generation.workspace_id = ${copyGeneration.workspaceId}
                          and later_generation.platform_draft_id = ${copyGeneration.platformDraftId}
                          and later_generation.requested_content_locale = ${copyGeneration.requestedContentLocale}
                          and later_operation.lifecycle = 'succeeded'
                          and later_operation.command_type in (
                            'copy-generation:route',
                            'copy-generation:regenerate',
                            'copy-generation:refresh_article'
                          )
                          and (later_generation.created_at, later_generation.operation_id)
                            > (${copyGeneration.createdAt}, ${copyGeneration.operationId})
                      )
                    )
                  )`,
                ),
              )
              .orderBy(desc(copyVariant.createdAt), asc(copyVariant.id));
      const nativeCandidatesByDraft = new Map<
        string,
        {
          contentLocale: ContentLocale;
          candidates: typeof variants;
        }
      >();
      for (const variant of variants) {
        const current = nativeCandidatesByDraft.get(variant.platformDraftId);
        if (
          !current ||
          (current.contentLocale !== presentationLocale &&
            variant.contentLocale === presentationLocale)
        ) {
          nativeCandidatesByDraft.set(variant.platformDraftId, {
            contentLocale: variant.contentLocale,
            candidates: [variant],
          });
        } else if (variant.contentLocale === current.contentLocale) {
          current.candidates.push(variant);
        }
      }
      const translatableVariantIds = [
        ...nativeCandidatesByDraft.values(),
      ].flatMap(({ candidates }) =>
        candidates.flatMap((candidate) =>
          candidate.contentLocale === presentationLocale ? [] : [candidate.id],
        ),
      );
      const revisions =
        draftIds.length === 0
          ? []
          : await executor
              .select({
                id: draftRevision.id,
                platformDraftId: draftRevision.platformDraftId,
                revisionNumber: draftRevision.revisionNumber,
                contentLocale: draftRevision.contentLocale,
                headline: draftRevision.headline,
                body: draftRevision.body,
                hashtags: draftRevision.hashtags,
                originatingCopyVariantId:
                  draftRevision.originatingCopyVariantId,
                imageSourceReadiness: sql<"ready" | "extract_required">`case
                when ${platformDraft.promoIdeaId} is not null then 'ready'
                when ${sourceItem.origin} = 'telegram_public' then 'ready'
                when ${sourceItem.origin} = 'rss'
                  and ${copyGeneration.sourceItemRevisionId} is not null then 'ready'
                else 'extract_required'
              end`,
                sourceAttribution: sourceItem.attribution,
                sourceCanonicalUrl: sourceItemRevision.canonicalUrl,
                selectedFinalMediaAssetId:
                  draftRevision.selectedFinalMediaAssetId,
                imageIntentVersion: draftRevision.imageIntentVersion,
                hasNonterminalImageGeneration: sql<boolean>`exists (
                  select 1
                  from image_generation revision_image_generation
                  inner join operation revision_image_operation
                    on revision_image_operation.id = revision_image_generation.operation_id
                    and revision_image_operation.workspace_id = revision_image_generation.workspace_id
                  where revision_image_generation.workspace_id = ${draftRevision.workspaceId}
                    and revision_image_generation.draft_revision_id = ${draftRevision.id}
                    and revision_image_operation.lifecycle in ('queued', 'running', 'settling')
                )`,
                mediaLocked: sql<boolean>`exists (
                  select 1
                  from approval revision_approval
                  where revision_approval.workspace_id = ${draftRevision.workspaceId}
                    and revision_approval.draft_revision_id = ${draftRevision.id}
                )`,
                imageProvenanceMismatch: sql<boolean>`exists (
                  select 1
                  from image_generation selected_generation
                  inner join draft_revision generating_revision
                    on generating_revision.id = selected_generation.draft_revision_id
                    and generating_revision.workspace_id = selected_generation.workspace_id
                  inner join copy_variant generating_variant
                    on generating_variant.id = generating_revision.originating_copy_variant_id
                    and generating_variant.workspace_id = generating_revision.workspace_id
                  inner join copy_generation_unit generating_unit
                    on generating_unit.id = generating_variant.copy_generation_unit_id
                    and generating_unit.workspace_id = generating_variant.workspace_id
                  inner join copy_generation generating_copy
                    on generating_copy.operation_id = generating_unit.copy_generation_id
                    and generating_copy.workspace_id = generating_unit.workspace_id
                  where selected_generation.workspace_id = ${draftRevision.workspaceId}
                    and selected_generation.final_media_asset_id = ${draftRevision.selectedFinalMediaAssetId}
                    and (
                      generating_revision.headline is distinct from ${draftRevision.headline}
                      or generating_revision.body is distinct from ${draftRevision.body}
                      or generating_revision.hashtags is distinct from ${draftRevision.hashtags}
                      or generating_revision.content_locale is distinct from ${draftRevision.contentLocale}
                      or generating_copy.source_item_revision_id is distinct from ${copyGeneration.sourceItemRevisionId}
                      or generating_copy.source_item_enrichment_id is distinct from ${copyGeneration.sourceItemEnrichmentId}
                      or generating_copy.page_content_hash is distinct from ${copyGeneration.pageContentHash}
                      or generating_copy.limited is distinct from ${copyGeneration.limited}
                    )
                )`,
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
                  eq(
                    copyGeneration.workspaceId,
                    copyGenerationUnit.workspaceId,
                  ),
                ),
              )
              .leftJoin(
                sourceItemRevision,
                and(
                  eq(
                    sourceItemRevision.id,
                    copyGeneration.sourceItemRevisionId,
                  ),
                  eq(
                    sourceItemRevision.workspaceId,
                    copyGeneration.workspaceId,
                  ),
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
              );
      const revisionsByDraft = new Map<
        string,
        Omit<(typeof revisions)[number], "platformDraftId">[]
      >();
      const nextRevisionNumberByDraft = new Map<string, number>();
      for (const { platformDraftId, ...revision } of revisions) {
        const existing = revisionsByDraft.get(platformDraftId);
        if (existing) existing.push(revision);
        else revisionsByDraft.set(platformDraftId, [revision]);
        nextRevisionNumberByDraft.set(
          platformDraftId,
          Math.max(
            nextRevisionNumberByDraft.get(platformDraftId) ?? 1,
            revision.revisionNumber + 1,
          ),
        );
      }

      const [
        publishingByDraft,
        translationStatuses,
        copyVariantLocalizations,
        copyVariantTranslationStatuses,
      ] = await Promise.all([
        readPlatformDraftPublishing(
          executor,
          workspaceId,
          userId,
          result.rows,
          revisions,
          environmentForcedPause,
          timeZone,
        ),
        readEditorialPresentationTranslationStatuses(
          executor,
          workspaceId,
          userId,
          result.rows.flatMap((row) => {
            if (row.presentationReady) return [];
            const origin = platformDraftOrigin(row);
            return origin.kind === "market_analysis_handoff" ? [] : [origin];
          }),
          presentationLocale,
        ),
        translatableVariantIds.length === 0
          ? Promise.resolve([])
          : readCopyVariantLocalizations(
              executor,
              workspaceId,
              translatableVariantIds,
              presentationLocale,
            ),
        translatableVariantIds.length === 0
          ? Promise.resolve([])
          : readCopyVariantTranslationStatuses(
              executor,
              workspaceId,
              userId,
              translatableVariantIds,
              presentationLocale,
            ),
      ]);
      const translationByOrigin =
        presentationTranslationByOrigin(translationStatuses);
      const localizationByVariant = new Map(
        copyVariantLocalizations.map((entry) => [entry.copyVariantId, entry]),
      );
      const translationByVariant = new Map(
        copyVariantTranslationStatuses.map((entry) => [
          entry.copyVariantId,
          {
            dispatchState: entry.dispatchState,
            lifecycle: entry.lifecycle,
            operationId: entry.operationId,
          },
        ]),
      );
      const candidatesByDraft = new Map<
        string,
        PlatformDraftCard["candidates"]
      >();
      for (const [draftId, { candidates }] of nativeCandidatesByDraft) {
        candidatesByDraft.set(
          draftId,
          candidates.map(
            ({ platformDraftId: _platformDraftId, ...candidate }) => {
              const localization = localizationByVariant.get(candidate.id);
              return {
                ...candidate,
                ...(localization
                  ? {
                      contentLocale: localization.contentLocale,
                      headline: localization.headline,
                      body: localization.body,
                      hashtags: localization.hashtags,
                    }
                  : {}),
                translation:
                  localization || candidate.contentLocale === presentationLocale
                    ? null
                    : (translationByVariant.get(candidate.id) ?? null),
              };
            },
          ),
        );
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
                createdAt:
                  row.generationCreatedAt === null
                    ? new Date(0)
                    : new Date(row.generationCreatedAt),
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
                providerOriginalMediaAssetId:
                  row.imageProviderOriginalMediaAssetId,
                finalMediaAssetId: row.imageFinalMediaAssetId,
                createdAt:
                  row.imageCreatedAt === null
                    ? new Date(0)
                    : new Date(row.imageCreatedAt),
              }
            : null;

        const card: PlatformDraftExactCard = {
          id: row.id,
          mediaBrandId: row.mediaBrandId,
          brandKey: row.brandKey,
          brandName: row.brandName,
          platform: row.platform,
          lanePosition: row.lanePosition,
          executionScope: row.marketAnalysisId
            ? {
                kind: "market_analysis",
                marketAnalysisId: row.marketAnalysisId,
              }
            : {
                kind: "analysis_run",
                analysisRunId: requireAnalysisRunId(row),
              },
          version: row.version,
          activeRevisionId: row.activeRevisionId,
          revisionVersion: row.revisionVersion,
          projectionVersion: row.projectionVersion,
          nextRevisionNumber: nextRevisionNumberByDraft.get(row.id) ?? 1,
          origin,
          originTitle: row.originTitle,
          presentationReady: row.presentationReady,
          presentationTranslation:
            origin.kind === "market_analysis_handoff"
              ? null
              : (translationByOrigin.get(presentationOriginKey(origin)) ??
                null),
          sourceKind: row.sourceKind,
          originDetails: platformDraftOriginDetails(row),
          generation,
          candidates: candidatesByDraft.get(row.id) ?? [],
          revisions: revisionsByDraft.get(row.id) ?? [],
          imageGeneration,
          publishing:
            publishingByDraft.get(row.id) ??
            emptyPublishingProjection(environmentForcedPause, timeZone),
        };

        const executionScope = row.marketAnalysisId
          ? ({
              kind: "market_analysis",
              marketAnalysisId: row.marketAnalysisId,
            } as const)
          : ({
              kind: "analysis_run",
              analysisRunId: requireAnalysisRunId(row),
            } as const);
        return {
          analysisRunId: row.analysisRunId,
          executionScope,
          lifecycle: row.originLifecycle,
          card,
        };
      });
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

function emptyPublishingProjection(
  environmentForcedPause: boolean,
  timeZone: string,
): PlatformDraftCard["publishing"] {
  return {
    savedCard: null,
    approval: null,
    destinations: [],
    timeZone,
    control: {
      paused: environmentForcedPause,
      environmentForced: environmentForcedPause,
      version: 0,
    },
    latestPublication: null,
    latestSchedule: null,
  };
}

async function readPlatformDraftPublishing(
  executor: Transaction,
  workspaceId: string,
  userId: string,
  drafts: PlatformDraftProjectionRow[],
  revisions: Array<{
    id: string;
    platformDraftId: string;
    selectedFinalMediaAssetId: string | null;
  }>,
  environmentForcedPause: boolean,
  timeZone: string,
) {
  const draftIds = drafts.map((draft) => draft.id);
  if (draftIds.length === 0) {
    return new Map<string, PlatformDraftCard["publishing"]>();
  }

  const revisionsById = new Map(
    revisions.map((revision) => [revision.id, revision]),
  );
  const activeRevisionByDraft = new Map<string, (typeof revisions)[number]>();
  for (const draft of drafts) {
    const revision = draft.activeRevisionId
      ? revisionsById.get(draft.activeRevisionId)
      : undefined;
    if (revision?.platformDraftId === draft.id) {
      activeRevisionByDraft.set(draft.id, revision);
    }
  }
  const revisionIds = [...activeRevisionByDraft.values()].map((row) => row.id);
  const brandIds = [...new Set(drafts.map((draft) => draft.mediaBrandId))];
  const savedRows = await executor
    .select({
      id: savedCard.id,
      platformDraftId: savedCard.platformDraftId,
      version: savedCard.version,
      savedAt: savedCard.createdAt,
      discardedAt: savedCard.discardedAt,
    })
    .from(savedCard)
    .where(
      and(
        inWorkspace(savedCard, workspaceId),
        eq(savedCard.savedBy, userId),
        inArray(savedCard.platformDraftId, draftIds),
      ),
    )
    .orderBy(desc(savedCard.createdAt), desc(savedCard.id));
  const approvalRows =
    revisionIds.length === 0
      ? []
      : await executor
          .select({
            id: approval.id,
            draftRevisionId: approval.draftRevisionId,
            selectedFinalMediaAssetId: approval.selectedFinalMediaAssetId,
            approvedAt: approval.approvedAt,
          })
          .from(approval)
          .where(
            and(
              inWorkspace(approval, workspaceId),
              inArray(approval.draftRevisionId, revisionIds),
            ),
          )
          .orderBy(desc(approval.approvedAt), desc(approval.id));
  const destinationRows = await executor
    .select({
      mediaBrandId: mediaBrandDestinationAccount.mediaBrandId,
      id: destinationAccount.id,
      key: destinationAccount.key,
      label: sql<string>`coalesce(${destinationAccount.metadata}->>'label', ${destinationAccount.key})`,
      platform: destinationAccount.platform,
      enabled: destinationAccount.enabled,
      bound: sql<boolean>`coalesce(${destinationAccount.bindingPresent}, false)`,
      bindingCheckedAt: destinationAccount.bindingCheckedAt,
    })
    .from(mediaBrandDestinationAccount)
    .innerJoin(
      destinationAccount,
      and(
        inWorkspace(destinationAccount, workspaceId),
        eq(
          destinationAccount.id,
          mediaBrandDestinationAccount.destinationAccountId,
        ),
        isNull(destinationAccount.deletedAt),
      ),
    )
    .where(
      and(
        inWorkspace(mediaBrandDestinationAccount, workspaceId),
        isNull(mediaBrandDestinationAccount.deletedAt),
        inArray(mediaBrandDestinationAccount.mediaBrandId, brandIds),
      ),
    )
    .orderBy(asc(destinationAccount.key));
  const publicationRows =
    revisionIds.length === 0
      ? []
      : await executor
          .select({
            id: publication.id,
            draftRevisionId: publication.draftRevisionId,
            lifecycle: publication.lifecycle,
            version: publication.version,
            activeOperationId: publication.activeOperationId,
            destinationAccountId: publishOperation.destinationAccountId,
            unresolvedAttemptId: publication.unresolvedAttemptId,
            confirmedProviderResultId: publication.confirmedProviderResultId,
            confirmedAt: publication.confirmedAt,
            activityStatus: sql<
              "not_due" | "pending" | "failed" | "recorded"
            >`coalesce(${publishOperation.settlementActivityStatus}, 'not_due')`,
            updatedAt: publication.updatedAt,
          })
          .from(publication)
          .leftJoin(
            publishOperation,
            and(
              inWorkspace(publishOperation, workspaceId),
              eq(publishOperation.operationId, publication.activeOperationId),
            ),
          )
          .where(
            and(
              inWorkspace(publication, workspaceId),
              inArray(publication.draftRevisionId, revisionIds),
            ),
          )
          .orderBy(desc(publication.updatedAt), desc(publication.id));
  const scheduleRows =
    revisionIds.length === 0
      ? []
      : await executor
          .select({
            id: schedule.id,
            draftRevisionId: schedule.draftRevisionId,
            lifecycle: schedule.lifecycle,
            scheduledAt: schedule.scheduledAt,
            timezone: schedule.timezone,
            destinationAccountId: schedule.destinationAccountId,
            version: schedule.version,
            updatedAt: schedule.updatedAt,
          })
          .from(schedule)
          .where(
            and(
              inWorkspace(schedule, workspaceId),
              inArray(schedule.draftRevisionId, revisionIds),
            ),
          )
          .orderBy(desc(schedule.updatedAt), desc(schedule.id));
  const checkpointRows =
    revisionIds.length === 0
      ? []
      : await executor
          .select({
            id: publishCheckpoint.id,
            publicationId: publishCheckpoint.publicationId,
            kind: publishCheckpoint.kind,
            referenceId: publishCheckpoint.providerReferenceId,
          })
          .from(publishCheckpoint)
          .innerJoin(
            publication,
            and(
              inWorkspace(publication, workspaceId),
              eq(publication.id, publishCheckpoint.publicationId),
              inArray(publication.draftRevisionId, revisionIds),
            ),
          )
          .where(inWorkspace(publishCheckpoint, workspaceId))
          .orderBy(
            desc(publishCheckpoint.observedAt),
            desc(publishCheckpoint.id),
          );

  const savedByDraft = new Map<string, (typeof savedRows)[number]>();
  for (const row of savedRows) {
    const preserved = savedByDraft.get(row.platformDraftId);
    if (!preserved || (preserved.discardedAt && !row.discardedAt)) {
      savedByDraft.set(row.platformDraftId, row);
    }
  }
  const approvalByRevision = new Map<string, (typeof approvalRows)[number]>();
  for (const row of approvalRows) {
    if (!approvalByRevision.has(row.draftRevisionId)) {
      approvalByRevision.set(row.draftRevisionId, row);
    }
  }
  const destinationsByBrand = new Map<string, typeof destinationRows>();
  for (const row of destinationRows) {
    const entries = destinationsByBrand.get(row.mediaBrandId) ?? [];
    entries.push(row);
    destinationsByBrand.set(row.mediaBrandId, entries);
  }
  const publicationByRevision = new Map<
    string,
    (typeof publicationRows)[number]
  >();
  for (const row of publicationRows) {
    if (!publicationByRevision.has(row.draftRevisionId)) {
      publicationByRevision.set(row.draftRevisionId, row);
    }
  }
  const scheduleByRevision = new Map<string, (typeof scheduleRows)[number]>();
  for (const row of scheduleRows) {
    if (!scheduleByRevision.has(row.draftRevisionId)) {
      scheduleByRevision.set(row.draftRevisionId, row);
    }
  }
  const checkpointByPublication = new Map<
    string,
    (typeof checkpointRows)[number]
  >();
  for (const row of checkpointRows) {
    if (!checkpointByPublication.has(row.publicationId)) {
      checkpointByPublication.set(row.publicationId, row);
    }
  }

  const persistedControl = drafts[0];
  const output = new Map<string, PlatformDraftCard["publishing"]>();
  for (const draft of drafts) {
    const savedRow = savedByDraft.get(draft.id);
    const revision = activeRevisionByDraft.get(draft.id);
    const approvalRow = revision
      ? (approvalByRevision.get(revision.id) ?? null)
      : null;
    const currentApproval =
      approvalRow &&
      approvalRow.selectedFinalMediaAssetId ===
        revision?.selectedFinalMediaAssetId
        ? approvalRow
        : null;
    const publicationRow = revision
      ? (publicationByRevision.get(revision.id) ?? null)
      : null;
    const scheduleRow = revision
      ? (scheduleByRevision.get(revision.id) ?? null)
      : null;
    const checkpointRow = publicationRow
      ? (checkpointByPublication.get(publicationRow.id) ?? null)
      : null;
    const destinations = [];
    for (const {
      mediaBrandId: _mediaBrandId,
      ...destination
    } of destinationsByBrand.get(draft.mediaBrandId) ?? []) {
      if (destination.platform === draft.platform) {
        destinations.push(destination);
      }
    }
    output.set(draft.id, {
      savedCard: savedRow
        ? {
            id: savedRow.id,
            version: savedRow.version,
            savedAt: savedRow.savedAt,
            discardedAt: savedRow.discardedAt,
          }
        : null,
      approval: currentApproval,
      destinations,
      timeZone,
      control: {
        paused:
          environmentForcedPause ||
          (persistedControl?.publishingPaused ?? false),
        environmentForced: environmentForcedPause,
        version: persistedControl?.publishingControlVersion ?? 0,
      },
      latestPublication: publicationRow
        ? {
            id: publicationRow.id,
            lifecycle: publicationRow.lifecycle,
            version: publicationRow.version,
            activeOperationId: publicationRow.activeOperationId,
            destinationAccountId: publicationRow.destinationAccountId,
            unresolvedAttemptId: publicationRow.unresolvedAttemptId,
            confirmedProviderResultId: publicationRow.confirmedProviderResultId,
            checkpointId: checkpointRow?.id ?? null,
            checkpointKind: checkpointRow?.kind ?? null,
            checkpointReferenceId: checkpointRow?.referenceId ?? null,
            confirmedAt: publicationRow.confirmedAt,
            activityStatus: publicationRow.activityStatus,
          }
        : null,
      latestSchedule: scheduleRow
        ? {
            id: scheduleRow.id,
            lifecycle: scheduleRow.lifecycle,
            scheduledAt: scheduleRow.scheduledAt,
            timezone: scheduleRow.timezone,
            destinationAccountId: scheduleRow.destinationAccountId,
            version: scheduleRow.version,
          }
        : null,
    });
  }
  return output;
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
  userId: string,
): Promise<RunConfiguration | null> {
  const [row] = await executor
    .select({ configuration: analysisRun.configuration })
    .from(analysisRun)
    .innerJoin(operation, eq(operation.id, analysisRun.operationId))
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, analysisRunId),
        eq(operation.actor, userId),
      ),
    );

  return row?.configuration ?? null;
}

function platformDraftOrigin(
  row: Pick<
    PlatformDraftProjectionRow,
    | "editorialSelectionId"
    | "marketAnalysisHandoffId"
    | "promoIdeaId"
    | "telegramFilterResultId"
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
  if (row.marketAnalysisHandoffId) {
    return {
      kind: "market_analysis_handoff",
      marketAnalysisHandoffId: row.marketAnalysisHandoffId,
    };
  }
  throw new Error("platform draft origin is missing");
}

function requireAnalysisRunId(row: PlatformDraftProjectionRow) {
  if (!row.analysisRunId) {
    throw new Error("run-backed platform draft is missing its analysis run");
  }
  return row.analysisRunId;
}

function platformDraftOriginDetails(
  row: PlatformDraftProjectionRow,
): PlatformDraftExactCard["originDetails"] {
  if (
    row.originSourceName === null &&
    row.originPromoAngle === null &&
    row.marketAnalysisHandoffId === null
  ) {
    return null;
  }

  return {
    sourceName: row.originSourceName,
    publishedAt:
      row.originPublishedAt === null ? null : new Date(row.originPublishedAt),
    canonicalUrl: row.originCanonicalUrl,
    summary: row.originSummary,
    contentLocale: row.originContentLocale,
    suitabilityScore: row.originSuitabilityScore,
    reasoning: row.originReasoning,
    suggestedPlatform: row.originSuggestedPlatform,
    telegramReason: row.originTelegramReason,
    promoAngle: row.originPromoAngle,
    marketAnalysisId: row.marketAnalysisId,
    verifiedFacts: row.originVerifiedFacts,
  };
}

async function readRunHead(
  executor: Executor,
  workspaceId: string,
  userId: string,
  analysisRunId: string,
): Promise<RunHeadRead | null> {
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
      effectiveTopics: sourceImport.effectiveTopics,
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
    })
    .from(analysisRun)
    .innerJoin(operation, eq(operation.id, analysisRun.operationId))
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
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, analysisRunId),
        eq(operation.actor, userId),
      ),
    )
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
    effectiveTopics,
    unitUpdatedAt,
    ...run
  } = row;

  return {
    head: {
      ...run,
      topicTranslationFallback: effectiveTopics?.usedOriginalFallback === true,
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
    "execution" | "progress" | "telegramAcquisition" | "templateChanged"
  >;
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
  const elapsedTo = isOperationSettled(head.lifecycle)
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
  if (isOperationSettled(head.lifecycle)) return head.lifecycle;
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
  presentationLocale: ContentLocale,
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
  const sourcePresentationReady = sql<boolean>`(
    ${sourceItemRevision.contentLocale} = ${presentationLocale}
    or (
      ${sourcePresentation.title} is not null
      and (
        ${sourceItemRevision.summary} is null
        or ${sourcePresentation.summary} is not null
      )
    )
  )`;
  const selectionPresentationReady = sql<boolean>`(
    ${presentationLocale} = 'en'
    or ${editorialSelection.reasoning} is null
    or ${selectionPresentation.reasoning} is not null
  )`;
  const selectionBundleReady = sql<boolean>`(
    ${sourcePresentationReady} and ${selectionPresentationReady}
  )`;
  const promoPresentationReady = sql<boolean>`(
    ${presentationLocale} = 'en'
    or (
      ${promoPresentation.title} is not null
      and ${promoPresentation.description} is not null
      and ${promoPresentation.angle} is not null
    )
  )`;

  const [selections, promoIdeas] = await Promise.all([
    executor
      .select({
        analysisModelUnitId: editorialSelection.analysisModelUnitId,
        id: editorialSelection.id,
        rank: editorialSelection.rank,
        sourceItemId: editorialSelection.sourceItemId,
        suggestedPlatform: editorialSelection.suggestedPlatform,
        reasoning: sql<string | null>`case
          when ${selectionBundleReady} and ${presentationLocale} <> 'en'
            then ${selectionPresentation.reasoning}
          else ${editorialSelection.reasoning}
        end`,
        suitabilityScore: editorialSelection.selectionSuitabilityScore,
        impactScore: editorialSelection.selectionImpactScore,
        viralityScore: editorialSelection.selectionViralityScore,
        confidenceScore: editorialSelection.selectionConfidenceScore,
        title: sql<string>`case
          when ${selectionBundleReady}
            and ${sourceItemRevision.contentLocale} <> ${presentationLocale}
            then ${sourcePresentation.title}
          else ${sourceItemRevision.title}
        end`,
        summary: sql<string | null>`case
          when ${selectionBundleReady}
            and ${sourceItemRevision.contentLocale} <> ${presentationLocale}
            then ${sourcePresentation.summary}
          else ${sourceItemRevision.summary}
        end`,
        canonicalUrl: sourceItemRevision.canonicalUrl,
        contentLocale: sourceItemRevision.contentLocale,
        sourceName: source.name,
        sourceOrigin: source.origin,
        publishedAt: sourceItem.publishedAt,
        presentationReady: selectionBundleReady,
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
      .leftJoin(
        sourcePresentation,
        and(
          inWorkspace(sourcePresentation, workspaceId),
          eq(sourcePresentation.sourceItemRevisionId, sourceItemRevision.id),
          eq(sourcePresentation.presentationLocale, presentationLocale),
        ),
      )
      .leftJoin(
        selectionPresentation,
        and(
          inWorkspace(selectionPresentation, workspaceId),
          eq(selectionPresentation.editorialSelectionId, editorialSelection.id),
          eq(selectionPresentation.presentationLocale, presentationLocale),
        ),
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
        title: sql<string>`case
          when ${promoPresentationReady} and ${presentationLocale} <> 'en'
            then ${promoPresentation.title}
          else ${promoIdea.title}
        end`,
        description: sql<string>`case
          when ${promoPresentationReady} and ${presentationLocale} <> 'en'
            then ${promoPresentation.description}
          else ${promoIdea.description}
        end`,
        angle: sql<string>`case
          when ${promoPresentationReady} and ${presentationLocale} <> 'en'
            then ${promoPresentation.angle}
          else ${promoIdea.angle}
        end`,
        presentationReady: promoPresentationReady,
      })
      .from(promoIdea)
      .leftJoin(
        promoPresentation,
        and(
          inWorkspace(promoPresentation, workspaceId),
          eq(promoPresentation.promoIdeaId, promoIdea.id),
          eq(promoPresentation.presentationLocale, presentationLocale),
        ),
      )
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
    lanes.get(analysisModelUnitId)?.selections.push({
      ...card,
      presentationTranslation: null,
    } satisfies SelectionCard);
  }

  for (const { analysisModelUnitId, ...card } of promoIdeas) {
    lanes.get(analysisModelUnitId)?.promoIdeas.push({
      ...card,
      presentationTranslation: null,
    } satisfies PromoIdeaCard);
  }

  return [...lanes.values()];
}

async function readTelegramLanes(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
  sourceImportId: string | null,
  presentationLocale: ContentLocale,
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
        case
          when revision.content_locale = ${presentationLocale} then revision.title
          when ${sourcePresentation.title} is not null
            and (
              revision.summary is null
              or ${sourcePresentation.summary} is not null
            ) then ${sourcePresentation.title}
          else revision.title
        end as "title",
        case
          when revision.content_locale = ${presentationLocale} then revision.summary
          when ${sourcePresentation.title} is not null
            and (
              revision.summary is null
              or ${sourcePresentation.summary} is not null
            ) then ${sourcePresentation.summary}
          else revision.summary
        end as "summary",
        (
          revision.content_locale = ${presentationLocale}
          or (
            ${sourcePresentation.title} is not null
            and (
              revision.summary is null
              or ${sourcePresentation.summary} is not null
            )
          )
        ) as "presentationReady",
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
      left join ${editorialPresentationLocalization} as source_presentation
        on ${sourcePresentation.workspaceId} = ${workspaceId}
        and ${sourcePresentation.sourceItemRevisionId} = revision.id
        and ${sourcePresentation.presentationLocale} = ${presentationLocale}
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
      presentationReady: row.presentationReady,
      presentationTranslation: null,
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

function editorialWorkspaceOrigins(
  modelLanes: readonly ModelLane[],
  telegramLanes: readonly TelegramLane[],
): RunCardOriginReference[] {
  const origins: RunCardOriginReference[] = [];

  for (const lane of modelLanes) {
    for (const card of lane.selections) {
      if (!card.presentationReady) {
        origins.push({
          kind: "editorial_selection",
          editorialSelectionId: card.id,
        });
      }
    }
    for (const card of lane.promoIdeas) {
      if (!card.presentationReady) {
        origins.push({ kind: "promo_idea", promoIdeaId: card.id });
      }
    }
  }

  for (const lane of telegramLanes) {
    for (const card of lane.cards) {
      if (!card.presentationReady) {
        origins.push({
          kind: "telegram_filter_result",
          telegramFilterResultId: card.telegramFilterResultId,
        });
      }
    }
  }

  return origins;
}

function presentationTranslationByOrigin(
  statuses: readonly EditorialPresentationTranslationStatus[],
): Map<string, PresentationTranslationStatus> {
  return new Map(
    statuses.map(({ origin, ...status }) => [
      presentationOriginKey(origin),
      status,
    ]),
  );
}

function presentationOriginKey(origin: RunCardOriginReference): string {
  if (origin.kind === "editorial_selection") {
    return `editorial_selection:${origin.editorialSelectionId}`;
  }
  if (origin.kind === "telegram_filter_result") {
    return `telegram_filter_result:${origin.telegramFilterResultId}`;
  }
  return `promo_idea:${origin.promoIdeaId}`;
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
    | (Omit<TelegramCard, "presentationTranslation" | "publishedAt"> & {
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
  userId: string,
): Promise<{
  runs: {
    configuration: RunConfiguration;
    id: string;
    kind: RunOption["kind"];
    lifecycle: RunOption["lifecycle"];
    startedAt: Date;
    templateFingerprint: string;
  }[];
  recentTopics: string[];
}> {
  const [runs, recentTopics] = await Promise.all([
    executor
      .select({
        id: analysisRun.id,
        kind: analysisRun.kind,
        lifecycle: operation.lifecycle,
        startedAt: analysisRun.startedAt,
        templateFingerprint: analysisRun.templateFingerprint,
        configuration: analysisRun.configuration,
      })
      .from(analysisRun)
      .innerJoin(operation, eq(operation.id, analysisRun.operationId))
      .where(
        and(inWorkspace(analysisRun, workspaceId), eq(operation.actor, userId)),
      )
      .orderBy(desc(analysisRun.startedAt), desc(analysisRun.id))
      .limit(RECENT_TOPIC_RUNS),
    readRecentTopics(executor, workspaceId, userId),
  ]);

  return { runs, recentTopics };
}

export async function readRecentTopics(
  executor: Executor,
  workspaceId: string,
  userId: string,
): Promise<string[]> {
  const result = await executor.execute<{ topic: string }>(sql`
    select folded.topic
    from (
      select distinct on (fold_unique_name_v1(authored.topic))
        authored.topic,
        recent.started_at,
        recent.id,
        authored.ordinal
      from (
        select runs.id, runs.configuration, runs.started_at
        from ${analysisRun} as runs
        inner join ${operation} as run_operation
          on run_operation.id = runs.operation_id
          and run_operation.workspace_id = runs.workspace_id
        where runs.workspace_id = ${workspaceId}::uuid
          and run_operation.actor = ${userId}
        order by runs.started_at desc, runs.id desc
        limit ${RECENT_TOPIC_RUNS}
      ) as recent
      cross join lateral jsonb_array_elements_text(
        recent.configuration -> 'topics'
      ) with ordinality as authored(topic, ordinal)
      where jsonb_exists(recent.configuration, 'topics')
      order by
        fold_unique_name_v1(authored.topic),
        recent.started_at desc,
        recent.id desc,
        authored.ordinal
    ) as folded
    order by folded.started_at desc, folded.id desc, folded.ordinal
    limit ${RECENT_TOPIC_LIMIT}
  `);

  return result.rows.map((row) => row.topic);
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
  userId: string,
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
        eq(operation.actor, userId),
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
