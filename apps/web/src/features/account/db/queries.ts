import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";
import { sql } from "drizzle-orm";

import type { AccountSummary, ActivityHistoryRow } from "../schemas/account";

export async function readAccountSummary(
  executor: Executor,
  workspaceId: string,
  userId: string,
): Promise<AccountSummary> {
  const result = await executor.execute<AccountSummary>(sql`
    with generated_by_brand as (
      select draft.media_brand_id as "mediaBrandId", count(*)::integer as count
      from platform_draft draft
      where draft.workspace_id = ${workspaceId}::uuid
        and draft.deleted_at is null
      group by draft.media_brand_id
    ), scheduled_by_brand as (
      select draft.media_brand_id as "mediaBrandId", count(*)::integer as count
      from schedule scheduled
      join draft_revision revision
        on revision.id = scheduled.draft_revision_id
        and revision.workspace_id = scheduled.workspace_id
      join platform_draft draft
        on draft.id = revision.platform_draft_id
        and draft.workspace_id = scheduled.workspace_id
      where scheduled.workspace_id = ${workspaceId}::uuid
        and scheduled.lifecycle = 'scheduled'
      group by draft.media_brand_id
    ), saved_by_brand as (
      select draft.media_brand_id as "mediaBrandId", count(*)::integer as count
      from saved_card saved
      join platform_draft draft
        on draft.id = saved.platform_draft_id
        and draft.workspace_id = saved.workspace_id
      where saved.workspace_id = ${workspaceId}::uuid
        and saved.saved_by = ${userId}
        and saved.discarded_at is null
        and draft.deleted_at is null
      group by draft.media_brand_id
    )
    select
      coalesce((select sum(count) from generated_by_brand), 0)::integer as "generatedDrafts",
      coalesce((select sum(count) from scheduled_by_brand), 0)::integer as scheduled,
      coalesce((select sum(count) from saved_by_brand), 0)::integer as saved,
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'key', brand.key,
            'name', brand.name,
            'generatedDrafts', coalesce(generated.count, 0),
            'scheduled', coalesce(scheduled.count, 0),
            'saved', coalesce(saved.count, 0)
          ) order by brand.sort_order, brand.key
        )
        from media_brand brand
        left join generated_by_brand generated on generated."mediaBrandId" = brand.id
        left join scheduled_by_brand scheduled on scheduled."mediaBrandId" = brand.id
        left join saved_by_brand saved on saved."mediaBrandId" = brand.id
        where brand.workspace_id = ${workspaceId}::uuid
          and brand.deleted_at is null
      ), '[]'::jsonb) as brands
  `);

  const summary = result.rows[0];
  if (!summary) throw new Error("account summary returned no aggregate row");
  return summary;
}

export async function readActivityHistory(
  executor: Executor,
  workspaceId: string,
  userId: string,
): Promise<ActivityHistoryRow[]> {
  const result = await executor.execute<ActivityHistoryRow>(sql`
    select event.id,
      event.event_type as "eventType",
      event.occurred_at as "occurredAt",
      draft.id as "platformDraftId",
      brand.key as "brandKey",
      brand.name as "brandName",
      draft.platform,
      coalesce(
        approved_revision.headline,
        scheduled_revision.headline,
        published_revision.headline,
        active_revision.headline
      ) as headline
    from activity_event event
    left join saved_card saved
      on saved.id = event.saved_card_id
      and saved.workspace_id = event.workspace_id
    left join approval approved
      on approved.id = event.approval_id
      and approved.workspace_id = event.workspace_id
    left join schedule scheduled
      on scheduled.id = event.schedule_id
      and scheduled.workspace_id = event.workspace_id
    left join publication published
      on published.id = event.publication_id
      and published.workspace_id = event.workspace_id
    left join draft_revision approved_revision
      on approved_revision.id = approved.draft_revision_id
      and approved_revision.workspace_id = event.workspace_id
    left join draft_revision scheduled_revision
      on scheduled_revision.id = scheduled.draft_revision_id
      and scheduled_revision.workspace_id = event.workspace_id
    left join draft_revision published_revision
      on published_revision.id = published.draft_revision_id
      and published_revision.workspace_id = event.workspace_id
    left join platform_draft draft
      on draft.id = coalesce(
        event.platform_draft_id,
        saved.platform_draft_id,
        approved_revision.platform_draft_id,
        scheduled_revision.platform_draft_id,
        published_revision.platform_draft_id
      )
      and draft.workspace_id = event.workspace_id
    left join media_brand brand
      on brand.id = draft.media_brand_id
      and brand.workspace_id = event.workspace_id
    left join draft_revision active_revision
      on active_revision.id = draft.active_revision_id
      and active_revision.workspace_id = event.workspace_id
      and active_revision.platform_draft_id = draft.id
    where event.workspace_id = ${workspaceId}::uuid
      and event.actor_id = ${userId}
    order by event.occurred_at desc, event.id desc
    limit 20
  `);

  return result.rows;
}
