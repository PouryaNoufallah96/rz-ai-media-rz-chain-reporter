import {
  ANALYSIS_RUN_COMMAND_PREFIX,
  type AnalysisRunKind,
  DURABLE_EVENT_SCHEMA_VERSION,
  type DuplicateMethod,
  type ErrorCode,
  type FilterDisposition,
  type FilteringReason,
  type ItemEligibility,
  type ModelUnitStatus,
  OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
  OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
  type OperationLifecycle,
  type Platform,
  type RunConfiguration,
  type SemanticDegradedReason,
  type SemanticParticipation,
  type SemanticStageStatus,
  type SourceImportBinding,
} from "@rz-chain-reporter/contracts";
import { and, count, eq, inArray, isNull, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { analysisRunItem } from "../schema/analysis-run-item";
import { editorialSelection } from "../schema/editorial-selection";
import { filterResult } from "../schema/filter-result";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { promoIdea } from "../schema/promo-idea";
import { sourceImportItem } from "../schema/source-import-item";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import { createOperation, transitionOperation } from "./operation";

export const ANALYSIS_RUN_COMMAND_TYPE = `${ANALYSIS_RUN_COMMAND_PREFIX}start`;

const NON_TERMINAL_UNIT_STATUSES = ["pending", "running"] as const;

type StartAnalysisRunInput = {
  operationId: string;
  actor: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  kind: AnalysisRunKind;
  configuration: RunConfiguration;
  templateFingerprint: string;
};

type StartAnalysisRunResult =
  | { status: "created"; operationId: string; analysisRunId: string }
  | { status: "replayed"; operationId: string }
  | { status: "mismatch" };

export async function startAnalysisRun(
  executor: Executor,
  workspaceId: string,
  input: StartAnalysisRunInput,
): Promise<StartAnalysisRunResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const created = await createOperation(tx, workspaceId, {
      operationId: input.operationId,
      actor: input.actor,
      commandType: ANALYSIS_RUN_COMMAND_TYPE,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
      event: {
        type: OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        payload: {
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          workspaceId,
          operationId: input.operationId,
        },
      },
    });

    if (created.status === "mismatch") {
      return { status: "mismatch" };
    }

    if (created.status === "replayed") {
      return { status: "replayed", operationId: created.operation.id };
    }

    const [run] = await tx
      .insert(analysisRun)
      .values({
        workspaceId,
        operationId: created.operation.id,
        kind: input.kind,
        configuration: input.configuration,
        templateFingerprint: input.templateFingerprint,
        semanticStatus: input.kind === "promo" ? "skipped" : "pending",
      })
      .returning({ id: analysisRun.id });

    if (!run) {
      throw new Error("analysis run insert returned no row");
    }

    return {
      status: "created",
      operationId: created.operation.id,
      analysisRunId: run.id,
    };
  });
}

export async function findAnalysisRunByOperationId(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      id: analysisRun.id,
      kind: analysisRun.kind,
      operationId: analysisRun.operationId,
      sourceImportId: analysisRun.sourceImportId,
      sourceImportBinding: analysisRun.sourceImportBinding,
      configuration: analysisRun.configuration,
      templateFingerprint: analysisRun.templateFingerprint,
      scoringVersion: analysisRun.scoringVersion,
      semanticStatus: analysisRun.semanticStatus,
      semanticAttemptId: analysisRun.semanticAttemptId,
      startedAt: analysisRun.startedAt,
      completedAt: analysisRun.completedAt,
      cancelRequestedAt: analysisRun.cancelRequestedAt,
      cancelledAt: analysisRun.cancelledAt,
    })
    .from(analysisRun)
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.operationId, operationId),
      ),
    );

  return row;
}

type BindAnalysisRunSourceImportInput = {
  analysisRunId: string;
  sourceImportId: string;
  binding: SourceImportBinding;
};

export async function bindAnalysisRunSourceImport(
  executor: Executor,
  workspaceId: string,
  input: BindAnalysisRunSourceImportInput,
) {
  await executor
    .update(analysisRun)
    .set({
      sourceImportId: input.sourceImportId,
      sourceImportBinding: input.binding,
    })
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, input.analysisRunId),
      ),
    );
}

type LoadAnalysisRunCandidatesInput = {
  analysisRunId: string;
  sourceImportId: string;
  windowStart: Date;
};

// Candidate loading owns eligibility and the pinned revision; filter-and-score
// exclusively owns scored fields and the duplicate transition.
export async function loadAnalysisRunCandidates(
  executor: Executor,
  workspaceId: string,
  input: LoadAnalysisRunCandidatesInput,
): Promise<number> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    await tx.execute(sql`
      insert into ${analysisRunItem} (
        workspace_id, analysis_run_id, source_item_id, source_item_revision_id, eligibility)
      select
        ${workspaceId}::uuid,
        ${input.analysisRunId}::uuid,
        ${sourceImportItem.sourceItemId},
        ${sourceItemRevision.id},
        case
          when ${sourceItem.publishedAt} is null then 'undated'
          when ${sourceItem.publishedAt} < ${input.windowStart} then 'out_of_window'
          else 'candidate'
        end::item_eligibility
      from ${sourceImportItem}
      join ${sourceItem} on ${sourceItem.id} = ${sourceImportItem.sourceItemId}
      join ${sourceItemRevision} on ${sourceItemRevision.id} = ${sourceImportItem.sourceItemRevisionId}
      where ${sourceImportItem.workspaceId} = ${workspaceId}::uuid
        and ${sourceImportItem.sourceImportId} = ${input.sourceImportId}::uuid
      on conflict (workspace_id, analysis_run_id, source_item_id) do nothing
    `);

    const [loaded] = await tx
      .select({ items: count() })
      .from(analysisRunItem)
      .where(
        and(
          inWorkspace(analysisRunItem, workspaceId),
          eq(analysisRunItem.analysisRunId, input.analysisRunId),
        ),
      );

    const [expected] = await tx
      .select({ items: count() })
      .from(sourceImportItem)
      .where(
        and(
          inWorkspace(sourceImportItem, workspaceId),
          eq(sourceImportItem.sourceImportId, input.sourceImportId),
        ),
      );

    if (!loaded || !expected || loaded.items !== expected.items) {
      throw new Error(
        `analysis run candidate load covered ${loaded?.items ?? 0} of ${expected?.items ?? 0} source import items`,
      );
    }

    return loaded.items;
  });
}

export type AnalysisRunItemScores = {
  sourceItemId: string;
  eligibility: ItemEligibility;
  duplicateMethod: DuplicateMethod | null;
  duplicateOfSourceItemId: string | null;
  duplicateSimilarityBp: number | null;
  sourceAuthorityScore: number | null;
  freshnessScore: number | null;
  policyViralityScore: number | null;
  lexicalTopicScore: number | null;
  lexicalTopicIndex: number | null;
  semanticTopicScore: number | null;
  semanticTopicIndex: number | null;
  semanticParticipation: SemanticParticipation | null;
};

export type AnalysisRunFilterRow = {
  sourceItemId: string;
  mediaBrandId: string;
  disposition: FilterDisposition;
  reason: FilteringReason | null;
  valueSignalCount: number | null;
  mediaFitScore: number | null;
  sourcePreferenceScore: number | null;
  diversityScore: number | null;
  semanticBrandScore: number | null;
  policyScore: number | null;
  rankScore: number | null;
  rankPosition: number | null;
};

type AnalysisRunSemanticOutcome = {
  status: Extract<SemanticStageStatus, "succeeded" | "degraded">;
  reason: SemanticDegradedReason | null;
  attemptId: string | null;
  dimension: number | null;
  normalizationVersion: string | null;
  projectionVersion: string | null;
  topicCount: number | null;
  anchorCount: number | null;
};

type PersistAnalysisRunFilterOutputInput = {
  analysisRunId: string;
  scoringVersion: string;
  semantic: AnalysisRunSemanticOutcome;
  items: readonly AnalysisRunItemScores[];
  filterRows: readonly AnalysisRunFilterRow[];
};

// The caller transaction commits usage, scores, routes, and run state together;
// scoring_version is the re-entry marker and is written last.
export async function persistAnalysisRunFilterOutput(
  tx: Transaction,
  workspaceId: string,
  input: PersistAnalysisRunFilterOutputInput,
) {
  await withWorkspaceContext(tx, workspaceId);

  if (input.items.length > 0) {
    const values = input.items.map(
      (item) =>
        sql`(${item.sourceItemId}::uuid, ${item.eligibility}::item_eligibility, ${item.duplicateMethod}::duplicate_method, ${item.duplicateOfSourceItemId}::uuid, ${item.duplicateSimilarityBp}::smallint, ${item.sourceAuthorityScore}::smallint, ${item.freshnessScore}::smallint, ${item.policyViralityScore}::smallint, ${item.lexicalTopicScore}::smallint, ${item.lexicalTopicIndex}::smallint, ${item.semanticTopicScore}::smallint, ${item.semanticTopicIndex}::smallint, ${item.semanticParticipation}::semantic_participation)`,
    );

    await tx.execute(sql`
      update ${analysisRunItem} as t set
        eligibility = v.eligibility,
        duplicate_method = v.duplicate_method,
        duplicate_of_source_item_id = v.duplicate_of_source_item_id,
        duplicate_similarity_bp = v.duplicate_similarity_bp,
        source_authority_score = v.source_authority_score,
        freshness_score = v.freshness_score,
        policy_virality_score = v.policy_virality_score,
        lexical_topic_score = v.lexical_topic_score,
        lexical_topic_index = v.lexical_topic_index,
        semantic_topic_score = v.semantic_topic_score,
        semantic_topic_index = v.semantic_topic_index,
        semantic_participation = v.semantic_participation,
        updated_at = now()
      from (values ${sql.join(values, sql`, `)}) as v(
        source_item_id, eligibility, duplicate_method, duplicate_of_source_item_id,
        duplicate_similarity_bp, source_authority_score, freshness_score,
        policy_virality_score, lexical_topic_score, lexical_topic_index,
        semantic_topic_score, semantic_topic_index, semantic_participation)
      where t.workspace_id = ${workspaceId}::uuid
        and t.analysis_run_id = ${input.analysisRunId}::uuid
        and t.source_item_id = v.source_item_id
    `);
  }

  if (input.filterRows.length > 0) {
    await tx.insert(filterResult).values(
      input.filterRows.map((row) => ({
        workspaceId,
        analysisRunId: input.analysisRunId,
        ...row,
      })),
    );
  }

  await tx
    .update(analysisRun)
    .set({
      scoringVersion: input.scoringVersion,
      semanticStatus: input.semantic.status,
      semanticReason: input.semantic.reason,
      semanticAttemptId: input.semantic.attemptId,
      semanticDimension: input.semantic.dimension,
      semanticNormalizationVersion: input.semantic.normalizationVersion,
      semanticProjectionVersion: input.semantic.projectionVersion,
      semanticTopicCount: input.semantic.topicCount,
      semanticAnchorCount: input.semantic.anchorCount,
    })
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, input.analysisRunId),
      ),
    );
}

type AdvanceAnalysisRunSemanticStageInput = {
  analysisRunId: string;
  semanticAttemptId: string;
};

export async function advanceAnalysisRunSemanticStage(
  executor: Executor,
  workspaceId: string,
  input: AdvanceAnalysisRunSemanticStageInput,
) {
  await executor
    .update(analysisRun)
    .set({
      semanticStatus: "running",
      semanticAttemptId: input.semanticAttemptId,
    })
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, input.analysisRunId),
        eq(analysisRun.semanticStatus, "pending"),
      ),
    );
}

export type AnalysisModelUnitPlan = {
  mediaBrandId: string;
  modelOptionKey: string;
  taskKey: string;
};

type PlannedAnalysisModelUnit = {
  id: string;
  mediaBrandId: string;
  modelOptionKey: string;
  taskKey: string;
};

// Idempotent on replay: the unique's target absorbs a second plan, while the
// marker commits with the plan even when the plan contains zero units.
export async function planAnalysisModelUnits(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
  units: readonly AnalysisModelUnitPlan[],
): Promise<PlannedAnalysisModelUnit[]> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    if (units.length > 0) {
      await tx
        .insert(analysisModelUnit)
        .values(
          units.map((unit) => ({
            workspaceId,
            analysisRunId,
            status: "pending" as const,
            ...unit,
          })),
        )
        .onConflictDoNothing({
          target: [
            analysisModelUnit.workspaceId,
            analysisModelUnit.analysisRunId,
            analysisModelUnit.mediaBrandId,
            analysisModelUnit.modelOptionKey,
          ],
        });
    }

    await tx
      .update(analysisRun)
      .set({
        fanOutPlannedAt: sql`coalesce(${analysisRun.fanOutPlannedAt}, now())`,
      })
      .where(
        and(
          inWorkspace(analysisRun, workspaceId),
          eq(analysisRun.id, analysisRunId),
        ),
      );

    return tx
      .select({
        id: analysisModelUnit.id,
        mediaBrandId: analysisModelUnit.mediaBrandId,
        modelOptionKey: analysisModelUnit.modelOptionKey,
        taskKey: analysisModelUnit.taskKey,
      })
      .from(analysisModelUnit)
      .where(
        and(
          inWorkspace(analysisModelUnit, workspaceId),
          eq(analysisModelUnit.analysisRunId, analysisRunId),
        ),
      );
  });
}

export async function findAnalysisModelUnit(
  executor: Executor,
  workspaceId: string,
  analysisModelUnitId: string,
) {
  const [row] = await executor
    .select({
      id: analysisModelUnit.id,
      analysisRunId: analysisModelUnit.analysisRunId,
      mediaBrandId: analysisModelUnit.mediaBrandId,
      modelOptionKey: analysisModelUnit.modelOptionKey,
      taskKey: analysisModelUnit.taskKey,
      status: analysisModelUnit.status,
      operationAttemptId: analysisModelUnit.operationAttemptId,
      failureCode: analysisModelUnit.failureCode,
    })
    .from(analysisModelUnit)
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.id, analysisModelUnitId),
      ),
    );

  return row;
}

// The pre-I/O write, so a lane stops showing pending for the whole provider
// call. Never a settle: a terminal unit keeps its status.
export async function startAnalysisModelUnit(
  executor: Executor,
  workspaceId: string,
  analysisModelUnitId: string,
) {
  await executor
    .update(analysisModelUnit)
    .set({ status: "running" })
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.id, analysisModelUnitId),
        inArray(analysisModelUnit.status, NON_TERMINAL_UNIT_STATUSES),
      ),
    );
}

type SettleAnalysisModelUnitInput = {
  analysisModelUnitId: string;
  status: Extract<ModelUnitStatus, "failed" | "cancelled">;
  failureCode: ErrorCode | null;
};

// Conditional by construction: a child that committed its finalize transaction
// and then died must not be overwritten by the parent's catch clause.
export async function settleAnalysisModelUnit(
  executor: Executor,
  workspaceId: string,
  input: SettleAnalysisModelUnitInput,
): Promise<boolean> {
  const settled = await executor
    .update(analysisModelUnit)
    .set({ status: input.status, failureCode: input.failureCode })
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.id, input.analysisModelUnitId),
        inArray(analysisModelUnit.status, NON_TERMINAL_UNIT_STATUSES),
      ),
    )
    .returning({ id: analysisModelUnit.id });

  return settled.length > 0;
}

type AnalysisModelUnitSelection = {
  rank: number;
  sourceItemId: string;
  suggestedPlatform: Platform;
  reasoning: string | null;
  selectionSuitabilityScore: number | null;
  selectionImpactScore: number | null;
  selectionViralityScore: number | null;
  selectionConfidenceScore: number | null;
};

type AnalysisModelUnitPromoIdea = {
  rank: number;
  title: string;
  description: string;
  angle: string;
};

export type AnalysisModelUnitOutput =
  | { kind: "selection"; rows: readonly AnalysisModelUnitSelection[] }
  | { kind: "promo_idea"; rows: readonly AnalysisModelUnitPromoIdea[] }
  | { kind: "discarded" };

type PersistAnalysisModelUnitResultInput = {
  analysisModelUnitId: string;
  operationAttemptId: string;
  output: AnalysisModelUnitOutput;
};

// The gateway finalize transaction atomically commits usage, output, and status;
// discarded output settles cancelled without output rows.
export async function persistAnalysisModelUnitResult(
  tx: Transaction,
  workspaceId: string,
  input: PersistAnalysisModelUnitResultInput,
) {
  await withWorkspaceContext(tx, workspaceId);

  if (input.output.kind === "selection" && input.output.rows.length > 0) {
    await tx.insert(editorialSelection).values(
      input.output.rows.map((row) => ({
        workspaceId,
        analysisModelUnitId: input.analysisModelUnitId,
        ...row,
      })),
    );
  }

  if (input.output.kind === "promo_idea" && input.output.rows.length > 0) {
    await tx.insert(promoIdea).values(
      input.output.rows.map((row) => ({
        workspaceId,
        analysisModelUnitId: input.analysisModelUnitId,
        ...row,
      })),
    );
  }

  await tx
    .update(analysisModelUnit)
    .set({
      status: input.output.kind === "discarded" ? "cancelled" : "succeeded",
      operationAttemptId: input.operationAttemptId,
    })
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.id, input.analysisModelUnitId),
      ),
    );
}

type RequestAnalysisRunCancellationResult =
  | { status: "requested"; analysisRunId: string; operationId: string }
  | { status: "not_found" };

// Replay keeps the first timestamp and emits no second event; Inngest
// cancellation accelerates durable truth but never replaces it.
export async function requestAnalysisRunCancellation(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
): Promise<RequestAnalysisRunCancellationResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const [requested] = await tx
      .update(analysisRun)
      .set({ cancelRequestedAt: new Date() })
      .where(
        and(
          inWorkspace(analysisRun, workspaceId),
          eq(analysisRun.id, analysisRunId),
          isNull(analysisRun.cancelRequestedAt),
        ),
      )
      .returning({ id: analysisRun.id, operationId: analysisRun.operationId });

    if (!requested) {
      const [existing] = await tx
        .select({
          id: analysisRun.id,
          operationId: analysisRun.operationId,
        })
        .from(analysisRun)
        .where(
          and(
            inWorkspace(analysisRun, workspaceId),
            eq(analysisRun.id, analysisRunId),
          ),
        );

      return existing
        ? {
            status: "requested" as const,
            analysisRunId: existing.id,
            operationId: existing.operationId,
          }
        : { status: "not_found" as const };
    }

    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId: requested.operationId,
      eventType: OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        operationId: requested.operationId,
      },
    });

    return {
      status: "requested",
      analysisRunId: requested.id,
      operationId: requested.operationId,
    };
  });
}

export async function readAnalysisRunCancellation(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
) {
  const [row] = await executor
    .select({
      cancelRequestedAt: analysisRun.cancelRequestedAt,
      cancelledAt: analysisRun.cancelledAt,
    })
    .from(analysisRun)
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, analysisRunId),
      ),
    );

  return row;
}

export async function analysisRunHasRunningUnit(
  executor: Executor,
  workspaceId: string,
  analysisRunId: string,
) {
  const [row] = await executor
    .select({ id: analysisModelUnit.id })
    .from(analysisModelUnit)
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.analysisRunId, analysisRunId),
        eq(analysisModelUnit.status, "running"),
      ),
    )
    .limit(1);

  return row !== undefined;
}

type SettledAnalysisRun = {
  lifecycle: OperationLifecycle;
  version: number;
  cancelled: boolean;
};

// Boundaries (i)-(iv): the cancellation reached the run before any unit could
// be invoked, so it is effective by construction and no progress read applies.
export async function cancelAnalysisRunInBand(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<SettledAnalysisRun | null> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const claim = await claimSettle(tx, workspaceId, operationId);
    if (!claim) {
      return null;
    }

    await cancelNonTerminalUnits(tx, workspaceId, claim.run.id);

    return finishSettle(tx, workspaceId, claim, "cancelled");
  });
}

type SettleAnalysisRunInput = {
  operationId: string;
  failureCode: ErrorCode | null;
};

// The settle transaction derives whether cancellation stopped work from durable
// run progress; no caller can distinguish that race safely.
export async function settleAnalysisRun(
  executor: Executor,
  workspaceId: string,
  input: SettleAnalysisRunInput,
): Promise<SettledAnalysisRun | null> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const claim = await claimSettle(tx, workspaceId, input.operationId);
    if (!claim) {
      return null;
    }

    await cancelNonTerminalUnits(tx, workspaceId, claim.run.id);

    const progress = (
      await analysisRunProgress(tx, workspaceId, [claim.run.id])
    )[claim.run.id];
    const planned = progress
      ? Object.values(progress.units).reduce((total, units) => total + units, 0)
      : 0;

    // Without units, fanOutPlannedAt distinguishes prevented fan-out from a
    // completed zero-unit plan; otherwise cancellation arrived after completion.
    if (
      claim.run.cancelRequestedAt !== null &&
      ((progress?.units.cancelled ?? 0) > 0 ||
        (planned === 0 && claim.run.fanOutPlannedAt === null))
    ) {
      return finishSettle(tx, workspaceId, claim, "cancelled");
    }

    const failed =
      input.failureCode !== null ||
      (planned > 0 && (progress?.units.succeeded ?? 0) === 0);

    return finishSettle(
      tx,
      workspaceId,
      claim,
      failed ? "failed" : "succeeded",
    );
  });
}

type SettleClaim = {
  operationId: string;
  lifecycle: OperationLifecycle;
  version: number;
  run: {
    id: string;
    fanOutPlannedAt: Date | null;
    semanticStatus: SemanticStageStatus;
    cancelRequestedAt: Date | null;
    cancelledAt: Date | null;
  };
};

// FOR UPDATE first so a second settler racing the first returns null instead of
// raising VERSION_CONFLICT on the transition it would lose.
async function claimSettle(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
): Promise<SettleClaim | null> {
  const [current] = await tx
    .select({ lifecycle: operation.lifecycle, version: operation.version })
    .from(operation)
    .where(
      and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
    )
    .for("update");

  if (
    !current ||
    (current.lifecycle !== "queued" &&
      current.lifecycle !== "running" &&
      current.lifecycle !== "settling")
  ) {
    return null;
  }

  const [run] = await tx
    .select({
      id: analysisRun.id,
      fanOutPlannedAt: analysisRun.fanOutPlannedAt,
      semanticStatus: analysisRun.semanticStatus,
      cancelRequestedAt: analysisRun.cancelRequestedAt,
      cancelledAt: analysisRun.cancelledAt,
    })
    .from(analysisRun)
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.operationId, operationId),
      ),
    );

  if (!run) {
    return null;
  }

  return {
    operationId,
    lifecycle: current.lifecycle,
    version: current.version,
    run,
  };
}

async function cancelNonTerminalUnits(
  tx: Transaction,
  workspaceId: string,
  analysisRunId: string,
) {
  await tx
    .update(analysisModelUnit)
    .set({ status: "cancelled" })
    .where(
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        eq(analysisModelUnit.analysisRunId, analysisRunId),
        inArray(analysisModelUnit.status, NON_TERMINAL_UNIT_STATUSES),
      ),
    );
}

// A settled run cannot retain pending/running semantic status: no allocation
// means skipped, while interrupted execution degrades by the staleness rule.
function terminalSemanticStage(status: SemanticStageStatus) {
  if (status === "pending") {
    return { semanticStatus: "skipped" as const, semanticReason: null };
  }

  if (status === "running") {
    return {
      semanticStatus: "degraded" as const,
      semanticReason: "ambiguous_outcome" as const,
    };
  }

  return null;
}

type TerminalLifecycle = Extract<
  OperationLifecycle,
  "succeeded" | "failed" | "cancelled"
>;

async function finishSettle(
  tx: Transaction,
  workspaceId: string,
  claim: SettleClaim,
  lifecycle: TerminalLifecycle,
): Promise<SettledAnalysisRun | null> {
  let version = claim.version;

  if (claim.lifecycle === "queued") {
    const cancelled = await transitionOperation(tx, workspaceId, {
      id: claim.operationId,
      version,
      from: "queued",
      to: "cancelled",
    });

    if (cancelled.status !== "updated") {
      return null;
    }

    await releaseAnalysisRunClaim(tx, workspaceId, claim, "cancelled");

    return {
      lifecycle: "cancelled",
      version: cancelled.operation.version,
      cancelled: true,
    };
  }

  if (claim.lifecycle === "running") {
    const settling = await transitionOperation(tx, workspaceId, {
      id: claim.operationId,
      version,
      from: "running",
      to: "settling",
    });

    if (settling.status !== "updated") {
      return null;
    }

    version = settling.operation.version;
  }

  const terminal = await transitionOperation(tx, workspaceId, {
    id: claim.operationId,
    version,
    from: "settling",
    to: lifecycle,
  });

  if (terminal.status !== "updated") {
    return null;
  }

  await releaseAnalysisRunClaim(tx, workspaceId, claim, lifecycle);

  return {
    lifecycle,
    version: terminal.operation.version,
    cancelled: lifecycle === "cancelled",
  };
}

// claimed_at is the deadline anchor the operations panel reads for its started
// travel entry, so it is preserved while the lease is released.
async function releaseAnalysisRunClaim(
  tx: Transaction,
  workspaceId: string,
  claim: SettleClaim,
  lifecycle: TerminalLifecycle,
) {
  await tx
    .update(operation)
    .set({ claimedBy: null, leaseExpiresAt: null, updatedAt: new Date() })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, claim.operationId),
      ),
    );

  const settled = new Date();

  await tx
    .update(analysisRun)
    .set({
      completedAt: settled,
      cancelledAt:
        lifecycle === "cancelled"
          ? (claim.run.cancelledAt ?? settled)
          : claim.run.cancelledAt,
      ...terminalSemanticStage(claim.run.semanticStatus),
    })
    .where(
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, claim.run.id),
      ),
    );
}

type AnalysisRunItemFunnel = {
  fetched: number;
  datedInWindow: number;
  unique: number;
  admitted: number;
  passedPolicy: number;
  inOutputLane: number;
};

export type AnalysisRunProgress = {
  items: AnalysisRunItemFunnel;
  brandRoutes: Record<FilterDisposition, number>;
  units: Record<ModelUnitStatus, number>;
  selections: number;
  promoIdeas: number;
  semanticCandidates: number | null;
  partial: boolean;
  lateCancellation: boolean;
};

const TERMINAL_LIFECYCLES: readonly OperationLifecycle[] = [
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
];

// The single owner of every derived count. Nothing a query can derive from the
// cascade-owned child rows is stored on the run.
export async function analysisRunProgress(
  executor: Executor,
  workspaceId: string,
  runIds: readonly string[],
): Promise<Record<string, AnalysisRunProgress>> {
  if (runIds.length === 0) {
    return {};
  }

  const ids = [...runIds];

  const [
    runs,
    eligibilities,
    semanticCandidates,
    routes,
    items,
    units,
    outputs,
  ] = await Promise.all([
    executor
      .select({
        id: analysisRun.id,
        semanticStatus: analysisRun.semanticStatus,
        cancelRequestedAt: analysisRun.cancelRequestedAt,
        cancelledAt: analysisRun.cancelledAt,
        lifecycle: operation.lifecycle,
      })
      .from(analysisRun)
      .innerJoin(operation, eq(operation.id, analysisRun.operationId))
      .where(
        and(
          inWorkspace(analysisRun, workspaceId),
          inArray(analysisRun.id, ids),
        ),
      ),
    executor
      .select({
        analysisRunId: analysisRunItem.analysisRunId,
        eligibility: analysisRunItem.eligibility,
        rows: count(),
      })
      .from(analysisRunItem)
      .where(
        and(
          inWorkspace(analysisRunItem, workspaceId),
          inArray(analysisRunItem.analysisRunId, ids),
        ),
      )
      .groupBy(analysisRunItem.analysisRunId, analysisRunItem.eligibility),
    executor
      .select({
        analysisRunId: analysisRunItem.analysisRunId,
        rows: count(),
      })
      .from(analysisRunItem)
      .where(
        and(
          inWorkspace(analysisRunItem, workspaceId),
          inArray(analysisRunItem.analysisRunId, ids),
          eq(analysisRunItem.semanticParticipation, "included"),
        ),
      )
      .groupBy(analysisRunItem.analysisRunId),
    executor
      .select({
        analysisRunId: filterResult.analysisRunId,
        disposition: filterResult.disposition,
        rows: count(),
      })
      .from(filterResult)
      .where(
        and(
          inWorkspace(filterResult, workspaceId),
          inArray(filterResult.analysisRunId, ids),
        ),
      )
      .groupBy(filterResult.analysisRunId, filterResult.disposition),
    executor
      .select({
        analysisRunId: filterResult.analysisRunId,
        admitted: sql<number>`count(distinct ${filterResult.sourceItemId}) filter (where ${filterResult.disposition} <> 'no_media_fit')::int`,
        passedPolicy: sql<number>`count(distinct ${filterResult.sourceItemId}) filter (where ${filterResult.disposition} not in ('no_media_fit', 'low_score'))::int`,
        inOutputLane: sql<number>`count(distinct ${filterResult.sourceItemId}) filter (where ${filterResult.disposition} in ('shortlisted', 'telegram_lane'))::int`,
      })
      .from(filterResult)
      .where(
        and(
          inWorkspace(filterResult, workspaceId),
          inArray(filterResult.analysisRunId, ids),
        ),
      )
      .groupBy(filterResult.analysisRunId),
    executor
      .select({
        analysisRunId: analysisModelUnit.analysisRunId,
        status: analysisModelUnit.status,
        rows: count(),
      })
      .from(analysisModelUnit)
      .where(
        and(
          inWorkspace(analysisModelUnit, workspaceId),
          inArray(analysisModelUnit.analysisRunId, ids),
        ),
      )
      .groupBy(analysisModelUnit.analysisRunId, analysisModelUnit.status),
    executor
      .select({
        analysisRunId: analysisModelUnit.analysisRunId,
        selections: sql<number>`count(distinct ${editorialSelection.id})::int`,
        promoIdeas: sql<number>`count(distinct ${promoIdea.id})::int`,
      })
      .from(analysisModelUnit)
      .leftJoin(
        editorialSelection,
        eq(editorialSelection.analysisModelUnitId, analysisModelUnit.id),
      )
      .leftJoin(
        promoIdea,
        eq(promoIdea.analysisModelUnitId, analysisModelUnit.id),
      )
      .where(
        and(
          inWorkspace(analysisModelUnit, workspaceId),
          inArray(analysisModelUnit.analysisRunId, ids),
        ),
      )
      .groupBy(analysisModelUnit.analysisRunId),
  ]);

  const progress: Record<string, AnalysisRunProgress> = {};

  for (const run of runs) {
    progress[run.id] = {
      items: {
        fetched: 0,
        datedInWindow: 0,
        unique: 0,
        admitted: 0,
        passedPolicy: 0,
        inOutputLane: 0,
      },
      brandRoutes: {
        shortlisted: 0,
        telegram_lane: 0,
        no_media_fit: 0,
        low_score: 0,
        cap_exceeded: 0,
      },
      units: {
        pending: 0,
        running: 0,
        succeeded: 0,
        failed: 0,
        cancelled: 0,
      },
      selections: 0,
      promoIdeas: 0,
      semanticCandidates: run.semanticStatus === "succeeded" ? 0 : null,
      partial: false,
      lateCancellation:
        run.cancelRequestedAt !== null &&
        run.cancelledAt === null &&
        TERMINAL_LIFECYCLES.includes(run.lifecycle),
    };
  }

  for (const row of eligibilities) {
    const entry = progress[row.analysisRunId];
    if (!entry) {
      continue;
    }

    entry.items.fetched += row.rows;

    if (row.eligibility === "candidate" || row.eligibility === "duplicate") {
      entry.items.datedInWindow += row.rows;
    }

    if (row.eligibility === "candidate") {
      entry.items.unique += row.rows;
    }
  }

  for (const row of semanticCandidates) {
    const entry = progress[row.analysisRunId];
    if (entry && entry.semanticCandidates !== null) {
      entry.semanticCandidates = row.rows;
    }
  }

  for (const row of routes) {
    const entry = progress[row.analysisRunId];
    if (entry) {
      entry.brandRoutes[row.disposition] = row.rows;
    }
  }

  for (const row of items) {
    const entry = progress[row.analysisRunId];
    if (entry) {
      entry.items.admitted = row.admitted;
      entry.items.passedPolicy = row.passedPolicy;
      entry.items.inOutputLane = row.inOutputLane;
    }
  }

  for (const row of units) {
    const entry = progress[row.analysisRunId];
    if (entry) {
      entry.units[row.status] = row.rows;
    }
  }

  for (const row of outputs) {
    const entry = progress[row.analysisRunId];
    if (entry) {
      entry.selections = row.selections;
      entry.promoIdeas = row.promoIdeas;
    }
  }

  for (const entry of Object.values(progress)) {
    entry.partial =
      entry.units.succeeded > 0 &&
      entry.units.failed + entry.units.cancelled > 0;
  }

  return progress;
}
