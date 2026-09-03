import type { ContentLocale, Platform } from "@rz-chain-reporter/contracts";
import { and, eq, type SQLWrapper, sql } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { inWorkspace, liveInWorkspace } from "../filters";
import { draftRevision } from "../schema/draft-revision";
import { mediaBrand } from "../schema/media-brand";
import { platformDraft } from "../schema/platform-draft";

export type LiveDraftOrigin = {
  brandKey: string;
  contentLocale: ContentLocale | null;
  platform: Platform;
};

export function ownedDraftExists(
  workspaceId: string,
  actorId: string,
  draftId: SQLWrapper = platformDraft.id,
) {
  return sql`exists (
    select 1
    from platform_draft owned_draft
    left join editorial_selection owned_selection
      on owned_selection.id = owned_draft.editorial_selection_id
      and owned_selection.workspace_id = owned_draft.workspace_id
    left join analysis_model_unit owned_selection_unit
      on owned_selection_unit.id = owned_selection.analysis_model_unit_id
      and owned_selection_unit.workspace_id = owned_draft.workspace_id
    left join filter_result owned_telegram
      on owned_telegram.id = owned_draft.telegram_filter_result_id
      and owned_telegram.workspace_id = owned_draft.workspace_id
    left join promo_idea owned_promo
      on owned_promo.id = owned_draft.promo_idea_id
      and owned_promo.workspace_id = owned_draft.workspace_id
    left join analysis_model_unit owned_promo_unit
      on owned_promo_unit.id = owned_promo.analysis_model_unit_id
      and owned_promo_unit.workspace_id = owned_draft.workspace_id
    left join analysis_run owned_origin_run
      on owned_origin_run.id = coalesce(
        owned_selection_unit.analysis_run_id,
        owned_telegram.analysis_run_id,
        owned_promo_unit.analysis_run_id
      )
      and owned_origin_run.workspace_id = owned_draft.workspace_id
    left join operation owned_origin_operation
      on owned_origin_operation.id = owned_origin_run.operation_id
      and owned_origin_operation.workspace_id = owned_draft.workspace_id
    left join market_analysis_handoff owned_handoff
      on owned_handoff.id = owned_draft.market_analysis_handoff_id
      and owned_handoff.workspace_id = owned_draft.workspace_id
    left join market_analysis owned_market_analysis
      on owned_market_analysis.id = owned_handoff.market_analysis_id
      and owned_market_analysis.workspace_id = owned_draft.workspace_id
    left join operation owned_market_operation
      on owned_market_operation.id = owned_market_analysis.operation_id
      and owned_market_operation.workspace_id = owned_draft.workspace_id
    where owned_draft.id = ${draftId}
      and owned_draft.workspace_id = ${workspaceId}::uuid
      and owned_draft.deleted_at is null
      and coalesce(owned_origin_operation.actor, owned_market_operation.actor) = ${actorId}
  )`;
}

export async function readLiveDraftOrigin(
  executor: Executor | Transaction,
  workspaceId: string,
  userId: string,
  platformDraftId: string,
): Promise<LiveDraftOrigin | null> {
  const [row] = await executor
    .select({
      brandKey: mediaBrand.key,
      contentLocale: draftRevision.contentLocale,
      platform: platformDraft.platform,
    })
    .from(platformDraft)
    .innerJoin(
      mediaBrand,
      and(
        liveInWorkspace(mediaBrand, workspaceId),
        eq(mediaBrand.id, platformDraft.mediaBrandId),
      ),
    )
    .leftJoin(
      draftRevision,
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, platformDraft.activeRevisionId),
      ),
    )
    .where(
      and(
        liveInWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, platformDraftId),
        ownedDraftExists(workspaceId, userId),
      ),
    );

  return row ?? null;
}

export async function readLiveDraftRevisionOrigin(
  executor: Executor | Transaction,
  workspaceId: string,
  userId: string,
  draftRevisionId: string,
): Promise<LiveDraftOrigin | null> {
  const [revision] = await executor
    .select({ platformDraftId: draftRevision.platformDraftId })
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, draftRevisionId),
      ),
    );

  return revision
    ? readLiveDraftOrigin(
        executor,
        workspaceId,
        userId,
        revision.platformDraftId,
      )
    : null;
}
