import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";
import { ownedDraftExists } from "@rz-chain-reporter/db/repositories/draft-origin";
import { type SQL, sql } from "drizzle-orm";

import {
  decodeKeysetCursor,
  keysetPageOf,
  type OccurredAtCursor,
  occurredAtCursorSchema,
} from "@/features/shared/lib/keyset-cursor";

import { PUBLISHING_PAGE_SIZE } from "../constants";
import type {
  PublishingHistoryRow,
  PublishingQuery,
  SavedHistoryRow,
  SavedQuery,
} from "../schemas/history";

type CursorRow = { id: string; occurredAt: Date; cursorOccurredAt: string };

function cursorCondition(
  cursor: OccurredAtCursor | null,
  column: SQL,
  id: SQL,
) {
  if (!cursor) return sql`true`;
  return cursor.direction === "older"
    ? sql`(${column}, ${id}) < (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`
    : sql`(${column}, ${id}) > (${cursor.occurredAt}::timestamptz, ${cursor.id}::uuid)`;
}

function occurredAtCursorOf(row: CursorRow, direction: "older" | "newer") {
  return {
    direction,
    occurredAt: row.cursorOccurredAt,
    id: row.id,
  } satisfies OccurredAtCursor;
}

export async function readSavedHistory(
  executor: Executor,
  workspaceId: string,
  userId: string,
  query: SavedQuery,
) {
  const cursor = decodeKeysetCursor(occurredAtCursorSchema, query.cursor);
  const direction = cursor?.direction ?? "older";
  const orderDirection = direction === "older" ? sql`desc` : sql`asc`;
  const state =
    query.state === "active"
      ? sql`and saved.discarded_at is null`
      : query.state === "discarded"
        ? sql`and saved.discarded_at is not null`
        : sql``;
  const result = await executor.execute<
    Omit<SavedHistoryRow, "executionScope"> &
      CursorRow & { marketAnalysisId: string | null }
  >(sql`
    select saved.id,
      coalesce(selection_unit.analysis_run_id, telegram.analysis_run_id, promo_unit.analysis_run_id) as "analysisRunId",
      market_handoff.market_analysis_id as "marketAnalysisId",
      saved.platform_draft_id as "platformDraftId",
      saved.created_at as "savedAt",
      saved.created_at as "occurredAt",
      to_char(saved.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorOccurredAt",
      saved.discarded_at as "discardedAt", saved.version,
      brand.key as "brandKey", brand.name as "brandName", draft.platform,
      coalesce(source_item.title, telegram_item.title, promo.title, market_handoff.story_headline, '—') as "originTitle",
      active_revision.revision_number as "revisionNumber",
      active_revision.headline, active_revision.body,
      active_revision.content_locale as "contentLocale",
      (active_revision.selected_final_media_asset_id is not null) as "hasImage",
      (current_approval.id is not null) as approved
    from saved_card saved
    join platform_draft draft on draft.id = saved.platform_draft_id and draft.workspace_id = saved.workspace_id and draft.deleted_at is null
    join media_brand brand on brand.id = draft.media_brand_id and brand.workspace_id = draft.workspace_id
    left join editorial_selection selection on selection.id = draft.editorial_selection_id and selection.workspace_id = draft.workspace_id
    left join analysis_model_unit selection_unit on selection_unit.id = selection.analysis_model_unit_id and selection_unit.workspace_id = draft.workspace_id
    left join source_item on source_item.id = selection.source_item_id and source_item.workspace_id = draft.workspace_id
    left join filter_result telegram on telegram.id = draft.telegram_filter_result_id and telegram.workspace_id = draft.workspace_id
    left join source_item telegram_item on telegram_item.id = telegram.source_item_id and telegram_item.workspace_id = draft.workspace_id
    left join promo_idea promo on promo.id = draft.promo_idea_id and promo.workspace_id = draft.workspace_id
    left join analysis_model_unit promo_unit on promo_unit.id = promo.analysis_model_unit_id and promo_unit.workspace_id = draft.workspace_id
    left join market_analysis_handoff market_handoff on market_handoff.id = draft.market_analysis_handoff_id and market_handoff.workspace_id = draft.workspace_id
    left join draft_revision active_revision
      on active_revision.id = draft.active_revision_id
      and active_revision.workspace_id = draft.workspace_id
      and active_revision.platform_draft_id = draft.id
    left join approval current_approval on current_approval.workspace_id = saved.workspace_id
      and current_approval.draft_revision_id = active_revision.id
      and current_approval.selected_final_media_asset_id is not distinct from active_revision.selected_final_media_asset_id
    where saved.workspace_id = ${workspaceId}::uuid and saved.saved_by = ${userId}
      ${state}
      and ${cursorCondition(cursor, sql`saved.created_at`, sql`saved.id`)}
    order by saved.created_at ${orderDirection}, saved.id ${orderDirection}
    limit ${PUBLISHING_PAGE_SIZE + 1}
  `);
  const { ordered, ...page } = keysetPageOf({
    raw: result.rows,
    pageSize: PUBLISHING_PAGE_SIZE,
    cursor,
    toCursor: occurredAtCursorOf,
  });
  return {
    ...page,
    rows: ordered.map(
      ({ cursorOccurredAt: _cursor, marketAnalysisId, ...row }) => {
        return {
          ...row,
          executionScope: savedExecutionScope(
            marketAnalysisId,
            row.analysisRunId,
          ),
        };
      },
    ),
  };
}

function savedExecutionScope(
  marketAnalysisId: string | null,
  analysisRunId: string | null,
) {
  if (marketAnalysisId) {
    return { kind: "market_analysis" as const, marketAnalysisId };
  }
  if (!analysisRunId) {
    throw new Error("saved draft is missing its execution scope");
  }
  return { kind: "analysis_run" as const, analysisRunId };
}

export async function readPublishingHistory(
  executor: Executor,
  workspaceId: string,
  userId: string,
  query: PublishingQuery,
) {
  const cursor = decodeKeysetCursor(occurredAtCursorSchema, query.cursor);
  const direction = cursor?.direction ?? "older";
  const orderDirection = direction === "older" ? sql`desc` : sql`asc`;
  const source =
    query.view === "scheduled"
      ? sql`
        select schedule.id, draft.id as "platformDraftId", schedule.scheduled_at as "occurredAt",
          brand.key as "brandKey", brand.name as "brandName", revision.headline, revision.body,
          revision.content_locale as "contentLocale",
          (revision.selected_final_media_asset_id is not null) as "hasImage",
          schedule.destination_account_id as "destinationAccountId",
          destination.key as "destinationKey", coalesce(destination.metadata->>'label', destination.key) as "destinationLabel",
          eligible.destinations as "eligibleDestinations",
          schedule.platform, revision.revision_number as "revisionNumber", schedule.lifecycle::text as lifecycle,
          schedule.version, publication.version as "publicationVersion", schedule.id as "scheduleId", schedule.publication_id as "publicationId",
          schedule.originating_operation_id as "operationId",
          case when publication.active_operation_id = schedule.originating_operation_id then publication.unresolved_attempt_id else null end as "unresolvedAttemptId",
          case when publication.active_operation_id = schedule.originating_operation_id then publication.confirmed_provider_result_id else null end as "providerResultId",
          checkpoint.id as "evidenceCheckpointId", checkpoint.kind as "evidenceCheckpointKind",
          null::text as "reconciliationDecision", null::text as "reconciliationAuthority", null::timestamptz as "reconciledAt",
          coalesce(publish_operation.settlement_activity_status, 'not_due')::text as "activityStatus", schedule.timezone
        from schedule
        join destination_account destination on destination.id = schedule.destination_account_id and destination.workspace_id = schedule.workspace_id
        join draft_revision revision on revision.id = schedule.draft_revision_id and revision.workspace_id = schedule.workspace_id
        join platform_draft draft on draft.id = revision.platform_draft_id and draft.workspace_id = schedule.workspace_id
        join media_brand brand on brand.id = draft.media_brand_id and brand.workspace_id = draft.workspace_id
        join publication on publication.id = schedule.publication_id and publication.workspace_id = schedule.workspace_id
        join lateral (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', candidate.id,
                'key', candidate.key,
                'label', coalesce(candidate.metadata->>'label', candidate.key)
              ) order by candidate.key
            ),
            '[]'::jsonb
          ) as destinations
          from media_brand_destination_account mapping
          join destination_account candidate
            on candidate.id = mapping.destination_account_id
            and candidate.workspace_id = mapping.workspace_id
            and candidate.deleted_at is null
            and candidate.platform = schedule.platform
            and candidate.enabled
            and candidate.binding_present is true
          where mapping.workspace_id = schedule.workspace_id
            and mapping.media_brand_id = draft.media_brand_id
            and mapping.deleted_at is null
        ) eligible on true
        left join publish_operation on publish_operation.operation_id = schedule.originating_operation_id and publish_operation.workspace_id = schedule.workspace_id
        left join lateral (select id, kind from publish_checkpoint where workspace_id = schedule.workspace_id and publication_id = schedule.publication_id and operation_id = schedule.originating_operation_id order by observed_at desc limit 1) checkpoint on true
        where schedule.workspace_id = ${workspaceId}::uuid
          and schedule.lifecycle in ('scheduled', 'cancelled', 'rescheduled', 'effect_claimed', 'completed', 'delivery_unknown', 'missed_requires_confirmation', 'failed')
          and ${ownedDraftExists(workspaceId, userId, sql`draft.id`)}`
      : sql`
        select publication.id, draft.id as "platformDraftId",
          ${query.view === "reconciliation" ? sql`coalesce(reconciliation."occurredAt", publication.updated_at)` : sql`publication.updated_at`} as "occurredAt",
          brand.key as "brandKey", brand.name as "brandName", revision.headline, revision.body,
          revision.content_locale as "contentLocale",
          (revision.selected_final_media_asset_id is not null) as "hasImage",
          publish_operation.destination_account_id as "destinationAccountId",
          destination.key as "destinationKey", coalesce(destination.metadata->>'label', destination.key) as "destinationLabel",
          eligible.destinations as "eligibleDestinations",
          publication.platform, revision.revision_number as "revisionNumber",
          case
            when publication.lifecycle = 'available' and publish_operation.settlement_activity_status <> 'not_due' then 'failed'
            else publication.lifecycle::text
          end as lifecycle,
          publication.version, publication.version as "publicationVersion", publish_operation.schedule_id as "scheduleId", publication.id as "publicationId",
          publication.active_operation_id as "operationId", publication.unresolved_attempt_id as "unresolvedAttemptId",
          publication.confirmed_provider_result_id as "providerResultId", checkpoint.id as "evidenceCheckpointId", checkpoint.kind as "evidenceCheckpointKind",
          reconciliation.decision::text as "reconciliationDecision", reconciliation.authority::text as "reconciliationAuthority",
          reconciliation."occurredAt" as "reconciledAt",
          coalesce(publish_operation.settlement_activity_status, 'not_due')::text as "activityStatus", schedule.timezone
        from publication
        join draft_revision revision on revision.id = publication.draft_revision_id and revision.workspace_id = publication.workspace_id
        join platform_draft draft on draft.id = revision.platform_draft_id and draft.workspace_id = publication.workspace_id
        join media_brand brand on brand.id = draft.media_brand_id and brand.workspace_id = draft.workspace_id
        join lateral (
          select candidate.* from publish_operation candidate
          where candidate.workspace_id = publication.workspace_id and candidate.publication_id = publication.id
          order by candidate.updated_at desc, candidate.operation_id desc limit 1
        ) publish_operation on true
        join destination_account destination on destination.id = publish_operation.destination_account_id and destination.workspace_id = publication.workspace_id
        join lateral (
          select coalesce(
            jsonb_agg(
              jsonb_build_object(
                'id', candidate.id,
                'key', candidate.key,
                'label', coalesce(candidate.metadata->>'label', candidate.key)
              ) order by candidate.key
            ),
            '[]'::jsonb
          ) as destinations
          from media_brand_destination_account mapping
          join destination_account candidate
            on candidate.id = mapping.destination_account_id
            and candidate.workspace_id = mapping.workspace_id
            and candidate.deleted_at is null
            and candidate.platform = publication.platform
            and candidate.enabled
            and candidate.binding_present is true
          where mapping.workspace_id = publication.workspace_id
            and mapping.media_brand_id = draft.media_brand_id
            and mapping.deleted_at is null
        ) eligible on true
        left join schedule on schedule.id = publish_operation.schedule_id and schedule.workspace_id = publication.workspace_id
        left join lateral (select id, kind from publish_checkpoint where workspace_id = publication.workspace_id and publication_id = publication.id order by observed_at desc limit 1) checkpoint on true
        left join lateral (
          select decision, authority, occurred_at as "occurredAt"
          from publication_reconciliation
          where workspace_id = publication.workspace_id and publication_id = publication.id
          order by occurred_at desc, id desc limit 1
        ) reconciliation on true
        where publication.workspace_id = ${workspaceId}::uuid
          and ${ownedDraftExists(workspaceId, userId, sql`draft.id`)}
          and ${
            query.view === "published"
              ? sql`(
                publication.lifecycle = 'confirmed'
                or (publication.lifecycle = 'available' and publish_operation.settlement_activity_status <> 'not_due')
              )`
              : sql`(
                publication.lifecycle = 'delivery_unknown'
                or reconciliation."occurredAt" is not null
              )`
          }`;
  const result = await executor.execute<PublishingHistoryRow & CursorRow>(sql`
    select history.*, to_char(history."occurredAt" at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorOccurredAt"
    from (${source}) history
    where ${cursorCondition(cursor, sql`history."occurredAt"`, sql`history.id`)}
    order by history."occurredAt" ${orderDirection}, history.id ${orderDirection}
    limit ${PUBLISHING_PAGE_SIZE + 1}
  `);
  const { ordered, ...page } = keysetPageOf({
    raw: result.rows,
    pageSize: PUBLISHING_PAGE_SIZE,
    cursor,
    toCursor: occurredAtCursorOf,
  });
  return {
    ...page,
    rows: ordered.map(({ cursorOccurredAt: _cursor, ...row }) => row),
  };
}

export async function readPublishingControl(
  executor: Executor,
  workspaceId: string,
) {
  const result = await executor.execute<{
    paused: boolean;
    version: number;
    pausedAt: Date | null;
  }>(sql`
    select paused, version, paused_at as "pausedAt"
    from publishing_control
    where workspace_id = ${workspaceId}::uuid
  `);
  return result.rows[0] ?? { paused: false, version: 0, pausedAt: null };
}
