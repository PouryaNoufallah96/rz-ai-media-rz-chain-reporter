import {
  type CardOriginReference,
  COPY_GENERATION_COMMAND_PREFIX,
  type ContentLocale,
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
  type Platform,
  type RunConfiguration,
} from "@rz-chain-reporter/contracts";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { classifyDbError } from "../db-error";
import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { copyGeneration } from "../schema/copy-generation";
import { editorialSelection } from "../schema/editorial-selection";
import { filterResult } from "../schema/filter-result";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { promoIdea } from "../schema/promo-idea";
import { sourceItem } from "../schema/source-item";
import { insertCopyGeneration } from "./copy-generation";
import {
  insertOperationIdentity,
  readOperationIdentity,
  resolveOperationIdentityConflict,
} from "./operation";

export const PLATFORM_DRAFT_ROUTE_COMMAND_TYPE = `${COPY_GENERATION_COMMAND_PREFIX}route`;

type OriginAuthority = {
  runId: string;
  configuration: RunConfiguration;
  mediaBrandId: string;
  mediaBrandKey: string;
  sourceItemId: string | null;
  templateFingerprint: string;
};

type DraftRow = typeof platformDraft.$inferSelect;

export type RoutePlatformDraftInput = {
  actor: string;
  origin: CardOriginReference;
  platform: Platform;
  modelOptionKey: string;
  requestedContentLocale: ContentLocale;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  variantKeys: readonly string[];
  customerTemplateFingerprint: string;
  brandPolicyFingerprint: string;
  mediaBrandKey?: string;
  promptVersion: string;
  configurationVersion: string;
};

export type RoutePlatformDraftResult =
  | {
      status: "created" | "replayed" | "reconciled";
      draft: DraftRow;
      generationLifecycle: typeof operation.$inferSelect.lifecycle | null;
    }
  | {
      status:
        | "not_found"
        | "stale_origin"
        | "invalid_disposition"
        | "platform_not_allowed"
        | "mismatch";
    };

export type ReorderPlatformDraftsInput = {
  platformDraftId: string;
  expectedVersion: number;
  orderedDraftIds: readonly string[];
};

export type ReorderPlatformDraftsResult =
  | {
      status: "updated";
      drafts: { id: string; lanePosition: number; version: number }[];
    }
  | {
      status: "not_found" | "version_conflict" | "membership_conflict";
    };

export async function reorderPlatformDrafts(
  executor: Executor,
  workspaceId: string,
  input: ReorderPlatformDraftsInput,
): Promise<ReorderPlatformDraftsResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const target = await tx.execute<{
      id: string;
      mediaBrandId: string;
      platform: Platform;
      runId: string;
      version: number;
    }>(sql`
      select
        draft.id,
        draft.media_brand_id as "mediaBrandId",
        draft.platform,
        coalesce(
          selection_unit.analysis_run_id,
          telegram.analysis_run_id,
          promo_unit.analysis_run_id
        ) as "runId",
        draft.version
      from platform_draft draft
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
      where draft.workspace_id = ${workspaceId}::uuid
        and draft.id = ${input.platformDraftId}::uuid
        and draft.deleted_at is null
      limit 1
    `);
    const lane = target.rows[0];
    if (!lane) return { status: "not_found" };

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('platform-draft-route'), hashtext(${`${workspaceId}:${lane.runId}:${lane.mediaBrandId}:${lane.platform}`}))`,
    );

    const current = await tx.execute<{
      id: string;
      lanePosition: number;
      version: number;
    }>(sql`
      select
        draft.id,
        draft.lane_position as "lanePosition",
        draft.version
      from platform_draft draft
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
      where draft.workspace_id = ${workspaceId}::uuid
        and draft.media_brand_id = ${lane.mediaBrandId}::uuid
        and draft.platform = ${lane.platform}::platform
        and draft.deleted_at is null
        and coalesce(
          selection_unit.analysis_run_id,
          telegram.analysis_run_id,
          promo_unit.analysis_run_id
        ) = ${lane.runId}::uuid
      order by draft.lane_position, draft.id
      for update of draft
    `);
    const authoritativeTarget = current.rows.find(
      (draft) => draft.id === input.platformDraftId,
    );
    if (!authoritativeTarget) return { status: "not_found" };
    if (authoritativeTarget.version !== input.expectedVersion) {
      return { status: "version_conflict" };
    }

    const submitted = new Set(input.orderedDraftIds);
    if (
      submitted.size !== input.orderedDraftIds.length ||
      submitted.size !== current.rows.length ||
      current.rows.some((draft) => !submitted.has(draft.id))
    ) {
      return { status: "membership_conflict" };
    }

    const byId = new Map(current.rows.map((draft) => [draft.id, draft]));
    const drafts = [];
    for (const [index, id] of input.orderedDraftIds.entries()) {
      const draft = byId.get(id);
      if (!draft) return { status: "membership_conflict" };
      const lanePosition = index + 1;
      const changed = draft.lanePosition !== lanePosition;
      const version = changed ? draft.version + 1 : draft.version;
      if (changed) {
        await tx
          .update(platformDraft)
          .set({ lanePosition, version, updatedAt: new Date() })
          .where(
            and(
              inWorkspace(platformDraft, workspaceId),
              eq(platformDraft.id, id),
              eq(platformDraft.version, draft.version),
            ),
          );
      }
      drafts.push({ id, lanePosition, version });
    }

    return { status: "updated", drafts };
  });
}

export async function routePlatformDraft(
  executor: Executor,
  workspaceId: string,
  input: RoutePlatformDraftInput,
): Promise<RoutePlatformDraftResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const authority = await loadOriginAuthority(tx, workspaceId, input.origin);
    if (authority.status !== "found") {
      return { status: authority.status };
    }
    if (
      authority.value.templateFingerprint !== input.customerTemplateFingerprint
    ) {
      return { status: "stale_origin" };
    }
    if (
      input.mediaBrandKey !== undefined &&
      authority.value.mediaBrandKey !== input.mediaBrandKey
    ) {
      return { status: "stale_origin" };
    }
    if (
      authority.value.configuration.kind === "news" &&
      !authority.value.configuration.platforms.includes(input.platform)
    ) {
      return { status: "platform_not_allowed" };
    }

    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('platform-draft-route'), hashtext(${`${workspaceId}:${authority.value.runId}:${authority.value.mediaBrandId}:${input.platform}`}))`,
    );

    const identity = await readOperationIdentity(tx, workspaceId, {
      actor: input.actor,
      commandType: PLATFORM_DRAFT_ROUTE_COMMAND_TYPE,
      idempotencyKey: input.idempotencyKey,
    });
    if (identity) {
      if (identity.requestHash !== input.requestHash) {
        return { status: "mismatch" };
      }
      const draft = await readActiveRoute(
        tx,
        workspaceId,
        authority.value.mediaBrandId,
        input.platform,
        input.origin,
      );
      if (!draft) {
        throw new Error("route operation identity has no active draft");
      }
      return routeResult(tx, workspaceId, draft, "replayed");
    }

    const active = await readActiveRoute(
      tx,
      workspaceId,
      authority.value.mediaBrandId,
      input.platform,
      input.origin,
    );
    if (active) {
      const reserved = await reserveOperation(
        tx,
        workspaceId,
        input,
        "succeeded",
      );
      if (reserved.status === "mismatch") return { status: "mismatch" };
      return routeResult(tx, workspaceId, active, "reconciled");
    }

    let created: { draft: DraftRow } | undefined;
    try {
      created = await tx.transaction(async (savepoint) => {
        const reserved = await reserveOperation(
          savepoint,
          workspaceId,
          input,
          "queued",
        );
        if (reserved.status !== "created") {
          throw new IdentityResolution(reserved.status);
        }

        const lanePosition = await nextLanePosition(
          savepoint,
          workspaceId,
          authority.value.runId,
          authority.value.mediaBrandId,
          input.platform,
        );
        const [draft] = await savepoint
          .insert(platformDraft)
          .values({
            workspaceId,
            mediaBrandId: authority.value.mediaBrandId,
            platform: input.platform,
            lanePosition,
            ...originColumns(input.origin),
          })
          .returning();
        if (!draft) throw new Error("platform draft insert returned no row");
        await insertCopyGeneration(savepoint, workspaceId, {
          operationId: reserved.operationId,
          platformDraftId: draft.id,
          requestedContentLocale: input.requestedContentLocale,
          modelOptionKey: input.modelOptionKey,
          variantKeys: input.variantKeys,
          customerTemplateFingerprint: input.customerTemplateFingerprint,
          brandPolicyFingerprint: input.brandPolicyFingerprint,
          promptVersion: input.promptVersion,
          configurationVersion: input.configurationVersion,
        });
        await savepoint.insert(outboxEvent).values({
          workspaceId,
          operationId: reserved.operationId,
          eventType: OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          payload: {
            schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
            workspaceId,
            operationId: reserved.operationId,
          },
        });
        return { draft };
      });
    } catch (error) {
      if (error instanceof IdentityResolution) {
        if (error.status === "mismatch") return { status: "mismatch" };
        const winner = await readActiveRoute(
          tx,
          workspaceId,
          authority.value.mediaBrandId,
          input.platform,
          input.origin,
        );
        if (!winner) throw error;
        return routeResult(tx, workspaceId, winner, "replayed");
      }

      const winner = await readActiveRoute(
        tx,
        workspaceId,
        authority.value.mediaBrandId,
        input.platform,
        input.origin,
      );
      if (!winner || classifyDbError(error)?.kind === "retry") throw error;

      const reserved = await reserveOperation(
        tx,
        workspaceId,
        input,
        "succeeded",
      );
      if (reserved.status === "mismatch") return { status: "mismatch" };
      return routeResult(tx, workspaceId, winner, "reconciled");
    }

    if (!created) throw new Error("platform draft route returned no row");
    return {
      status: "created",
      draft: created.draft,
      generationLifecycle: "queued",
    };
  });
}

class IdentityResolution extends Error {
  constructor(readonly status: "replayed" | "mismatch") {
    super(status);
  }
}

async function reserveOperation(
  tx: Transaction,
  workspaceId: string,
  input: RoutePlatformDraftInput,
  lifecycle: "queued" | "succeeded",
) {
  try {
    const operation = await insertOperationIdentity(tx, workspaceId, {
      actor: input.actor,
      commandType: PLATFORM_DRAFT_ROUTE_COMMAND_TYPE,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
      lifecycle,
    });
    return { status: "created" as const, operationId: operation.id };
  } catch (error) {
    if (classifyDbError(error)?.kind !== "operation_identity") throw error;
    const resolved = await resolveOperationIdentityConflict(
      tx,
      workspaceId,
      {
        actor: input.actor,
        commandType: PLATFORM_DRAFT_ROUTE_COMMAND_TYPE,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        requestId: input.requestId,
      },
      error,
    );
    return {
      status: resolved.status === "mismatch" ? "mismatch" : "replayed",
    } as const;
  }
}

export async function readRouteOriginContext(
  executor: Executor,
  workspaceId: string,
  origin: CardOriginReference,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    return loadOriginAuthority(tx, workspaceId, origin);
  });
}

async function loadOriginAuthority(
  tx: Transaction,
  workspaceId: string,
  origin: CardOriginReference,
): Promise<
  | { status: "found"; value: OriginAuthority }
  | { status: "not_found" | "invalid_disposition" }
> {
  if (origin.kind === "editorial_selection") {
    const [row] = await tx
      .select({
        runId: analysisModelUnit.analysisRunId,
        configuration: analysisRun.configuration,
        mediaBrandId: analysisModelUnit.mediaBrandId,
        mediaBrandKey: mediaBrand.key,
        sourceItemId: editorialSelection.sourceItemId,
        templateFingerprint: analysisRun.templateFingerprint,
      })
      .from(editorialSelection)
      .innerJoin(
        analysisModelUnit,
        and(
          inWorkspace(analysisModelUnit, workspaceId),
          eq(analysisModelUnit.id, editorialSelection.analysisModelUnitId),
        ),
      )
      .innerJoin(
        analysisRun,
        eq(analysisRun.id, analysisModelUnit.analysisRunId),
      )
      .innerJoin(
        mediaBrand,
        and(
          inWorkspace(mediaBrand, workspaceId),
          eq(mediaBrand.id, analysisModelUnit.mediaBrandId),
        ),
      )
      .innerJoin(sourceItem, eq(sourceItem.id, editorialSelection.sourceItemId))
      .where(
        and(
          inWorkspace(editorialSelection, workspaceId),
          eq(editorialSelection.id, origin.editorialSelectionId),
        ),
      );
    return row ? { status: "found", value: row } : { status: "not_found" };
  }

  if (origin.kind === "promo_idea") {
    const [row] = await tx
      .select({
        runId: analysisModelUnit.analysisRunId,
        configuration: analysisRun.configuration,
        mediaBrandId: analysisModelUnit.mediaBrandId,
        mediaBrandKey: mediaBrand.key,
        templateFingerprint: analysisRun.templateFingerprint,
      })
      .from(promoIdea)
      .innerJoin(
        analysisModelUnit,
        and(
          inWorkspace(analysisModelUnit, workspaceId),
          eq(analysisModelUnit.id, promoIdea.analysisModelUnitId),
        ),
      )
      .innerJoin(
        analysisRun,
        eq(analysisRun.id, analysisModelUnit.analysisRunId),
      )
      .innerJoin(
        mediaBrand,
        and(
          inWorkspace(mediaBrand, workspaceId),
          eq(mediaBrand.id, analysisModelUnit.mediaBrandId),
        ),
      )
      .where(
        and(
          inWorkspace(promoIdea, workspaceId),
          eq(promoIdea.id, origin.promoIdeaId),
        ),
      );
    return row
      ? { status: "found", value: { ...row, sourceItemId: null } }
      : { status: "not_found" };
  }

  const [row] = await tx
    .select({
      runId: filterResult.analysisRunId,
      configuration: analysisRun.configuration,
      mediaBrandId: filterResult.mediaBrandId,
      mediaBrandKey: mediaBrand.key,
      sourceItemId: filterResult.sourceItemId,
      disposition: filterResult.disposition,
      templateFingerprint: analysisRun.templateFingerprint,
    })
    .from(filterResult)
    .innerJoin(analysisRun, eq(analysisRun.id, filterResult.analysisRunId))
    .innerJoin(
      mediaBrand,
      and(
        inWorkspace(mediaBrand, workspaceId),
        eq(mediaBrand.id, filterResult.mediaBrandId),
      ),
    )
    .innerJoin(sourceItem, eq(sourceItem.id, filterResult.sourceItemId))
    .where(
      and(
        inWorkspace(filterResult, workspaceId),
        eq(filterResult.id, origin.telegramFilterResultId),
      ),
    );
  if (!row) return { status: "not_found" };
  if (row.disposition !== "telegram_lane") {
    return { status: "invalid_disposition" };
  }
  return { status: "found", value: row };
}

function originColumns(origin: CardOriginReference) {
  if (origin.kind === "editorial_selection") {
    return { editorialSelectionId: origin.editorialSelectionId };
  }
  if (origin.kind === "telegram_filter_result") {
    return { telegramFilterResultId: origin.telegramFilterResultId };
  }
  return { promoIdeaId: origin.promoIdeaId };
}

async function readActiveRoute(
  tx: Transaction,
  workspaceId: string,
  mediaBrandId: string,
  platform: Platform,
  origin: CardOriginReference,
) {
  const originPredicate =
    origin.kind === "editorial_selection"
      ? eq(platformDraft.editorialSelectionId, origin.editorialSelectionId)
      : origin.kind === "telegram_filter_result"
        ? eq(
            platformDraft.telegramFilterResultId,
            origin.telegramFilterResultId,
          )
        : eq(platformDraft.promoIdeaId, origin.promoIdeaId);
  const [draft] = await tx
    .select()
    .from(platformDraft)
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.mediaBrandId, mediaBrandId),
        eq(platformDraft.platform, platform),
        isNull(platformDraft.deletedAt),
        originPredicate,
      ),
    );
  return draft ?? null;
}

async function nextLanePosition(
  tx: Transaction,
  workspaceId: string,
  runId: string,
  mediaBrandId: string,
  platform: Platform,
) {
  const result = await tx.execute<{ lanePosition: number }>(sql`
    select coalesce(max(draft.lane_position), 0)::int + 1 as "lanePosition"
    from platform_draft draft
    left join editorial_selection selection on selection.id = draft.editorial_selection_id
    left join analysis_model_unit selection_unit on selection_unit.id = selection.analysis_model_unit_id
    left join filter_result telegram on telegram.id = draft.telegram_filter_result_id
    left join promo_idea promo on promo.id = draft.promo_idea_id
    left join analysis_model_unit promo_unit on promo_unit.id = promo.analysis_model_unit_id
    where draft.workspace_id = ${workspaceId}::uuid
      and draft.media_brand_id = ${mediaBrandId}::uuid
      and draft.platform = ${platform}::platform
      and draft.deleted_at is null
      and coalesce(selection_unit.analysis_run_id, telegram.analysis_run_id, promo_unit.analysis_run_id) = ${runId}::uuid
  `);
  return result.rows[0]?.lanePosition ?? 1;
}

async function routeResult(
  tx: Transaction,
  workspaceId: string,
  draft: DraftRow,
  status: "replayed" | "reconciled",
) {
  const [generation] = await tx
    .select({ lifecycle: operation.lifecycle })
    .from(copyGeneration)
    .innerJoin(operation, eq(operation.id, copyGeneration.operationId))
    .where(
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.platformDraftId, draft.id),
      ),
    )
    .orderBy(desc(copyGeneration.createdAt))
    .limit(1);
  return {
    status,
    draft,
    generationLifecycle: generation?.lifecycle ?? null,
  } as const;
}
