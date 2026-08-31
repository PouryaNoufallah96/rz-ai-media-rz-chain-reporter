import {
  type AttemptOutcome,
  type CardOriginReference,
  type ContentLocale,
  type DispatchState,
  DURABLE_EVENT_SCHEMA_VERSION,
  type ErrorCode,
  OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
  type OperationLifecycle,
  PRESENTATION_TRANSLATION_COMMAND_TYPE,
} from "@rz-chain-reporter/contracts";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  lte,
  or,
  sql,
} from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { analysisRunItem } from "../schema/analysis-run-item";
import { editorialPresentationLocalizationRequest } from "../schema/editorial-presentation-localization-request";
import { editorialSelection } from "../schema/editorial-selection";
import { filterResult } from "../schema/filter-result";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { promoIdea } from "../schema/promo-idea";
import { sourceItemRevision } from "../schema/source-item-revision";
import { markPendingAttemptUsageUnknown } from "./ai-usage-event";
import {
  type EditorialPresentationLocalizationKey,
  type PersistEditorialPresentationLocalizationInput,
  persistEditorialPresentationLocalizations,
  readEditorialPresentationLocalizations,
} from "./editorial-presentation-localization";
import {
  claimOperationExecution,
  insertOperationIdentity,
  readOperationIdentity,
  resolveOperationIdentityConflict,
} from "./operation";
import {
  allocateOperationAttemptInTransaction,
  settleOperationAttempt,
} from "./operation-attempt";
import { rearmOutboxEventInTransaction } from "./outbox-relay";

type SourceRevisionContent = {
  contentLocale: ContentLocale;
  sourceItemRevisionId: string;
  summary: string | null;
  title: string;
};

export type EditorialPresentationTranslationCard =
  | {
      kind: "editorial_selection";
      editorialSelectionId: string;
      reasoning: string | null;
      source: SourceRevisionContent;
    }
  | {
      kind: "telegram_filter_result";
      telegramFilterResultId: string;
      source: SourceRevisionContent;
    }
  | {
      angle: string;
      description: string;
      kind: "promo_idea";
      promoIdeaId: string;
      title: string;
    };

export type EditorialPresentationTranslationSubject =
  | ({ kind: "source_item_revision" } & SourceRevisionContent)
  | {
      contentLocale: "en";
      editorialSelectionId: string;
      kind: "editorial_selection";
      reasoning: string;
    }
  | {
      angle: string;
      contentLocale: "en";
      description: string;
      kind: "promo_idea";
      promoIdeaId: string;
      title: string;
    };

export type StartEditorialPresentationTranslationInput = {
  actor: string;
  idempotencyKey: string;
  origin: CardOriginReference;
  presentationLocale: ContentLocale;
  requestHash: string;
  requestId: string | null;
};

export type StartEditorialPresentationTranslationResult =
  | {
      lifecycle: OperationLifecycle;
      operationId: string;
      status: "created" | "replayed";
    }
  | {
      status: "already_available";
    }
  | { status: "idempotency_mismatch" }
  | { status: "invalid_origin" }
  | { status: "not_found" };

export type LoadEditorialPresentationTranslationRequestResult =
  | {
      actor: string;
      analysisRunId: string;
      card: EditorialPresentationTranslationCard;
      missingSubjects: EditorialPresentationTranslationSubject[];
      operationId: string;
      origin: CardOriginReference;
      platformDraftIds: string[];
      presentationLocale: ContentLocale;
      status: "ready";
    }
  | { status: "invalid_origin" | "not_found" };

export type EditorialPresentationTranslationClaimFence = {
  claimedBy: string;
  expectedVersion: number;
};

export type EditorialPresentationTranslationStatus = {
  dispatchState: DispatchState;
  lifecycle: OperationLifecycle;
  operationId: string;
  origin: CardOriginReference;
};

export type EditorialPresentationTranslationWrite =
  | {
      kind: "source_item_revision";
      sourceItemRevisionId: string;
      summary: string | null;
      title: string;
    }
  | {
      editorialSelectionId: string;
      kind: "editorial_selection";
      reasoning: string;
    }
  | {
      angle: string;
      description: string;
      kind: "promo_idea";
      promoIdeaId: string;
      title: string;
    };

export async function startEditorialPresentationTranslation(
  executor: Executor,
  workspaceId: string,
  input: StartEditorialPresentationTranslationInput,
): Promise<StartEditorialPresentationTranslationResult> {
  const identity = operationIdentity(input);
  const fastReplay = await readOperationIdentity(
    executor,
    workspaceId,
    identity,
  );
  if (fastReplay) return replay(fastReplay, input.requestHash);

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('presentation-translation-command'), hashtext(${`${workspaceId}:${originIdentity(input.origin)}:${input.presentationLocale}`}))`,
    );

    const serializedReplay = await readOperationIdentity(
      tx,
      workspaceId,
      identity,
    );
    if (serializedReplay) return replay(serializedReplay, input.requestHash);

    const loaded = await loadAuthoritativeCard(tx, workspaceId, input.origin);
    if (loaded.status !== "found") return { status: loaded.status };
    if (loaded.value.actor !== input.actor) return { status: "not_found" };

    const missingSubjects = await loadMissingSubjects(
      tx,
      workspaceId,
      loaded.value.card,
      input.presentationLocale,
    );
    if (missingSubjects.length === 0) {
      return { status: "already_available" };
    }

    const inProgress = await readInProgressRequest(
      tx,
      workspaceId,
      input.origin,
      input.presentationLocale,
    );
    if (inProgress) {
      if (inProgress.lifecycle === "queued" && inProgress.exhaustedAt) {
        const rearmed = await rearmOutboxEventInTransaction(tx, workspaceId, {
          id: inProgress.outboxId,
        });
        if (!rearmed) {
          throw new Error("presentation translation dispatch rearm lost");
        }
      }
      return {
        status: "replayed",
        operationId: inProgress.id,
        lifecycle: inProgress.lifecycle,
      };
    }

    let created: typeof operation.$inferSelect;
    try {
      created = await insertOperationIdentity(tx, workspaceId, identity);
    } catch (error) {
      const conflict = await resolveOperationIdentityConflict(
        tx,
        workspaceId,
        identity,
        error,
      );
      if (conflict.status === "mismatch") {
        return { status: "idempotency_mismatch" };
      }
      return {
        status: "replayed",
        operationId: conflict.operation.id,
        lifecycle: conflict.operation.lifecycle,
      };
    }

    await tx.insert(editorialPresentationLocalizationRequest).values({
      operationId: created.id,
      workspaceId,
      presentationLocale: input.presentationLocale,
      ...originColumns(input.origin),
    });
    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId: created.id,
      eventType: OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        operationId: created.id,
      },
    });

    return {
      status: "created",
      operationId: created.id,
      lifecycle: created.lifecycle,
    };
  });
}

export async function loadEditorialPresentationTranslationRequest(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<LoadEditorialPresentationTranslationRequestResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    const [request] = await tx
      .select({
        actor: operation.actor,
        editorialSelectionId:
          editorialPresentationLocalizationRequest.editorialSelectionId,
        presentationLocale:
          editorialPresentationLocalizationRequest.presentationLocale,
        promoIdeaId: editorialPresentationLocalizationRequest.promoIdeaId,
        telegramFilterResultId:
          editorialPresentationLocalizationRequest.telegramFilterResultId,
      })
      .from(editorialPresentationLocalizationRequest)
      .innerJoin(
        operation,
        and(
          inWorkspace(operation, workspaceId),
          eq(
            operation.id,
            editorialPresentationLocalizationRequest.operationId,
          ),
          eq(operation.commandType, PRESENTATION_TRANSLATION_COMMAND_TYPE),
        ),
      )
      .where(
        and(
          inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
          eq(editorialPresentationLocalizationRequest.operationId, operationId),
        ),
      );
    if (!request) return { status: "not_found" };

    const origin = originFromRequest(request);
    if (!origin) return { status: "invalid_origin" };
    const loaded = await loadAuthoritativeCard(tx, workspaceId, origin);
    if (loaded.status !== "found") return { status: loaded.status };
    if (loaded.value.actor !== request.actor) return { status: "not_found" };

    return {
      status: "ready",
      operationId,
      actor: request.actor,
      analysisRunId: loaded.value.analysisRunId,
      origin,
      platformDraftIds: await readPlatformDraftIds(tx, workspaceId, origin),
      presentationLocale: request.presentationLocale,
      card: loaded.value.card,
      missingSubjects: await loadMissingSubjects(
        tx,
        workspaceId,
        loaded.value.card,
        request.presentationLocale,
      ),
    };
  });
}

export async function readEditorialPresentationTranslationPlatformDraftIds(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [request] = await tx
      .select({
        editorialSelectionId:
          editorialPresentationLocalizationRequest.editorialSelectionId,
        promoIdeaId: editorialPresentationLocalizationRequest.promoIdeaId,
        telegramFilterResultId:
          editorialPresentationLocalizationRequest.telegramFilterResultId,
      })
      .from(editorialPresentationLocalizationRequest)
      .where(
        and(
          inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
          eq(editorialPresentationLocalizationRequest.operationId, operationId),
        ),
      );
    const origin = request ? originFromRequest(request) : null;
    return origin ? readPlatformDraftIds(tx, workspaceId, origin) : [];
  });
}

export async function readEditorialPresentationTranslationStatuses(
  executor: Executor,
  workspaceId: string,
  actorId: string,
  origins: readonly CardOriginReference[],
  presentationLocale: ContentLocale,
): Promise<EditorialPresentationTranslationStatus[]> {
  const editorialSelectionIds = [
    ...new Set(
      origins.flatMap((origin) =>
        origin.kind === "editorial_selection"
          ? [origin.editorialSelectionId]
          : [],
      ),
    ),
  ];
  const telegramFilterResultIds = [
    ...new Set(
      origins.flatMap((origin) =>
        origin.kind === "telegram_filter_result"
          ? [origin.telegramFilterResultId]
          : [],
      ),
    ),
  ];
  const promoIdeaIds = [
    ...new Set(
      origins.flatMap((origin) =>
        origin.kind === "promo_idea" ? [origin.promoIdeaId] : [],
      ),
    ),
  ];
  const originPredicate = or(
    editorialSelectionIds.length > 0
      ? inArray(
          editorialPresentationLocalizationRequest.editorialSelectionId,
          editorialSelectionIds,
        )
      : undefined,
    telegramFilterResultIds.length > 0
      ? inArray(
          editorialPresentationLocalizationRequest.telegramFilterResultId,
          telegramFilterResultIds,
        )
      : undefined,
    promoIdeaIds.length > 0
      ? inArray(
          editorialPresentationLocalizationRequest.promoIdeaId,
          promoIdeaIds,
        )
      : undefined,
  );
  if (!originPredicate) return [];

  const rows = await executor
    .selectDistinctOn(
      [
        editorialPresentationLocalizationRequest.editorialSelectionId,
        editorialPresentationLocalizationRequest.telegramFilterResultId,
        editorialPresentationLocalizationRequest.promoIdeaId,
      ],
      {
        dispatchAttemptCount: outboxEvent.dispatchAttemptCount,
        dispatchedAt: outboxEvent.dispatchedAt,
        editorialSelectionId:
          editorialPresentationLocalizationRequest.editorialSelectionId,
        exhaustedAt: outboxEvent.exhaustedAt,
        lifecycle: operation.lifecycle,
        operationId: operation.id,
        promoIdeaId: editorialPresentationLocalizationRequest.promoIdeaId,
        telegramFilterResultId:
          editorialPresentationLocalizationRequest.telegramFilterResultId,
      },
    )
    .from(editorialPresentationLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, editorialPresentationLocalizationRequest.operationId),
        eq(operation.actor, actorId),
        eq(operation.commandType, PRESENTATION_TRANSLATION_COMMAND_TYPE),
      ),
    )
    .leftJoin(
      outboxEvent,
      and(
        inWorkspace(outboxEvent, workspaceId),
        eq(outboxEvent.operationId, operation.id),
        eq(
          outboxEvent.eventType,
          OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
        ),
      ),
    )
    .where(
      and(
        inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
        eq(
          editorialPresentationLocalizationRequest.presentationLocale,
          presentationLocale,
        ),
        originPredicate,
      ),
    )
    .orderBy(
      asc(editorialPresentationLocalizationRequest.editorialSelectionId),
      asc(editorialPresentationLocalizationRequest.telegramFilterResultId),
      asc(editorialPresentationLocalizationRequest.promoIdeaId),
      desc(editorialPresentationLocalizationRequest.createdAt),
      desc(editorialPresentationLocalizationRequest.operationId),
    );

  return rows.flatMap((row) => {
    const origin = originFromRequest(row);
    return origin
      ? [
          {
            dispatchState: translationDispatchState(row),
            lifecycle: row.lifecycle,
            operationId: row.operationId,
            origin,
          },
        ]
      : [];
  });
}

export async function claimEditorialPresentationTranslation(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string;
    leaseExpiresAt: Date;
    now: Date;
    operationId: string;
  },
) {
  const [request] = await executor
    .select({
      operationId: editorialPresentationLocalizationRequest.operationId,
    })
    .from(editorialPresentationLocalizationRequest)
    .where(
      and(
        inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
        eq(
          editorialPresentationLocalizationRequest.operationId,
          input.operationId,
        ),
      ),
    );
  if (!request) return { status: "not_found" as const };

  const claimed = await claimOperationExecution(executor, workspaceId, {
    id: input.operationId,
    claimedBy: input.claimedBy,
    leaseExpiresAt: input.leaseExpiresAt,
    now: input.now,
  });
  if (claimed.status === "terminal") {
    return {
      status: "settled" as const,
      lifecycle: claimed.operation.lifecycle,
      operation: claimed.operation,
    };
  }
  return claimed;
}

export async function allocateEditorialPresentationTranslationAttempt(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  attemptId: string,
  claimFence: EditorialPresentationTranslationClaimFence,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockTranslationOperation(
      tx,
      workspaceId,
      operationId,
    );
    if (!current) return { status: "not_found" as const };
    if (!ownsTranslationClaim(current, claimFence)) {
      return {
        status: "claim_lost" as const,
        lifecycle: current.lifecycle,
      };
    }
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('presentation-translation-attempt'), hashtext(${attemptId}))`,
    );
    const [existing] = await tx
      .select()
      .from(operationAttempt)
      .where(eq(operationAttempt.id, attemptId));
    if (existing) {
      return existing.workspaceId === workspaceId &&
        existing.operationId === operationId
        ? { status: "allocated" as const, attempt: existing, reused: true }
        : { status: "attempt_id_conflict" as const };
    }

    const [numbered] = await tx
      .update(operation)
      .set({
        attemptSeq: sql`${operation.attemptSeq} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(inWorkspace(operation, workspaceId), eq(operation.id, operationId)),
      )
      .returning({ attemptNumber: operation.attemptSeq });
    if (!numbered) {
      throw new Error("presentation translation attempt numbering failed");
    }
    const [attempt] = await tx
      .insert(operationAttempt)
      .values({
        id: attemptId,
        workspaceId,
        operationId,
        attemptNumber: numbered.attemptNumber,
      })
      .returning();
    if (!attempt) {
      throw new Error("presentation translation attempt allocation failed");
    }
    return { status: "allocated" as const, attempt, reused: false };
  });
}

export async function completeEditorialPresentationTranslation(
  executor: Executor,
  workspaceId: string,
  input: CompleteEditorialPresentationTranslationInput,
) {
  return executor.transaction((tx) =>
    completeEditorialPresentationTranslationInTransaction(
      tx,
      workspaceId,
      input,
    ),
  );
}

export type CompleteEditorialPresentationTranslationInput = {
  claimFence: EditorialPresentationTranslationClaimFence;
  localizations: readonly EditorialPresentationTranslationWrite[];
  operationAttemptId: string;
  operationId: string;
};

export async function completeEditorialPresentationTranslationInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: CompleteEditorialPresentationTranslationInput,
) {
  await withWorkspaceContext(tx, workspaceId);
  const current = await lockTranslationOperation(
    tx,
    workspaceId,
    input.operationId,
  );
  if (!current) return { status: "not_found" as const };
  if (current.lifecycle === "succeeded") {
    return {
      status: "settled" as const,
      lifecycle: current.lifecycle,
      version: current.version,
    };
  }
  if (!ownsTranslationClaim(current, input.claimFence)) {
    return {
      status: "claim_lost" as const,
      lifecycle: current.lifecycle,
      version: current.version,
    };
  }
  const ownedAttempt = await lockPendingAttempt(
    tx,
    workspaceId,
    input.operationId,
    input.operationAttemptId,
  );
  if (!ownedAttempt) return { status: "invalid_output" as const };

  const origin = originFromRequest(current);
  if (!origin) return { status: "invalid_output" as const };
  const loaded = await loadAuthoritativeCard(tx, workspaceId, origin);
  if (loaded.status !== "found" || loaded.value.actor !== current.actor) {
    return { status: "invalid_output" as const };
  }
  const required = requiredSubjects(
    loaded.value.card,
    current.presentationLocale,
  );
  const missing = await loadMissingSubjects(
    tx,
    workspaceId,
    loaded.value.card,
    current.presentationLocale,
  );
  if (!validTranslationWrites(input.localizations, required, missing)) {
    return { status: "invalid_output" as const };
  }

  await persistEditorialPresentationLocalizations(
    tx,
    workspaceId,
    input.localizations.map((localization) =>
      persistedLocalizationInput(
        localization,
        current.presentationLocale,
        input.operationAttemptId,
      ),
    ),
  );
  const unresolved = await loadMissingSubjects(
    tx,
    workspaceId,
    loaded.value.card,
    current.presentationLocale,
  );
  if (unresolved.length > 0) {
    throw new Error("presentation translation bundle remained incomplete");
  }
  const attempt = await settleOperationAttempt(tx, workspaceId, {
    id: input.operationAttemptId,
    outcome: "succeeded",
  });
  if (!attempt)
    throw new Error("presentation translation attempt settlement lost");

  const now = new Date();
  const [settled] = await tx
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle: "succeeded",
      updatedAt: now,
      version: current.version + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.operationId),
        eq(operation.claimedBy, input.claimFence.claimedBy),
        eq(operation.version, input.claimFence.expectedVersion),
        eq(operation.lifecycle, "running"),
        gt(operation.leaseExpiresAt, now),
      ),
    )
    .returning({
      lifecycle: operation.lifecycle,
      version: operation.version,
    });
  if (!settled)
    throw new Error("presentation translation claim lost under lock");
  return { status: "persisted" as const, ...settled };
}

export async function failEditorialPresentationTranslation(
  executor: Executor,
  workspaceId: string,
  input: FailEditorialPresentationTranslationInput,
) {
  return executor.transaction((tx) =>
    failEditorialPresentationTranslationInTransaction(tx, workspaceId, input),
  );
}

export type FailEditorialPresentationTranslationInput = {
  claimFence: EditorialPresentationTranslationClaimFence;
  failureCode: ErrorCode;
  operationAttemptId: string;
  operationId: string;
  outcome: Extract<AttemptOutcome, "ambiguous" | "failed_terminal">;
};

export async function failEditorialPresentationTranslationInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: FailEditorialPresentationTranslationInput,
) {
  await withWorkspaceContext(tx, workspaceId);
  const current = await lockTranslationOperation(
    tx,
    workspaceId,
    input.operationId,
  );
  if (!current) return { status: "not_found" as const };
  if (["failed", "unknown"].includes(current.lifecycle)) {
    return {
      status: "settled" as const,
      lifecycle: current.lifecycle,
      version: current.version,
    };
  }
  if (!ownsTranslationClaim(current, input.claimFence)) {
    return {
      status: "claim_lost" as const,
      lifecycle: current.lifecycle,
      version: current.version,
    };
  }

  const ownedAttempt = await lockPendingAttempt(
    tx,
    workspaceId,
    input.operationId,
    input.operationAttemptId,
  );
  if (!ownedAttempt) return { status: "invalid_output" as const };

  const attempt = await settleOperationAttempt(tx, workspaceId, {
    id: input.operationAttemptId,
    outcome: input.outcome,
    failureCode: input.failureCode,
  });
  if (!attempt)
    throw new Error("presentation translation attempt settlement lost");

  const now = new Date();
  const [settled] = await tx
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle: input.outcome === "ambiguous" ? "unknown" : "failed",
      updatedAt: now,
      version: current.version + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.operationId),
        eq(operation.claimedBy, input.claimFence.claimedBy),
        eq(operation.version, input.claimFence.expectedVersion),
        eq(operation.lifecycle, "running"),
        gt(operation.leaseExpiresAt, now),
      ),
    )
    .returning({
      lifecycle: operation.lifecycle,
      version: operation.version,
    });
  if (!settled)
    throw new Error("presentation translation claim lost under lock");
  return { status: "settled" as const, ...settled };
}

export async function settleEditorialPresentationTranslationFailure(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string | null;
    expectedVersion?: number;
    failureCode: ErrorCode;
    operationId: string;
    staleBefore?: Date;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockTranslationOperation(
      tx,
      workspaceId,
      input.operationId,
    );
    if (!current) return { status: "not_found" as const };
    if (
      ["succeeded", "failed", "cancelled", "unknown"].includes(
        current.lifecycle,
      )
    ) {
      return {
        status: "settled" as const,
        lifecycle: current.lifecycle,
        version: current.version,
      };
    }
    if (
      current.lifecycle !== "queued" &&
      current.claimedBy !== input.claimedBy
    ) {
      return {
        status: "claim_lost" as const,
        lifecycle: current.lifecycle,
        version: current.version,
      };
    }
    if (
      input.expectedVersion !== undefined &&
      current.version !== input.expectedVersion
    ) {
      return {
        status: "claim_lost" as const,
        lifecycle: current.lifecycle,
        version: current.version,
      };
    }
    if (
      input.staleBefore !== undefined &&
      current.leaseExpiresAt !== null &&
      current.leaseExpiresAt > input.staleBefore
    ) {
      return {
        status: "claim_lost" as const,
        lifecycle: current.lifecycle,
        version: current.version,
      };
    }

    const pendingAttempts = await tx
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
        ),
      )
      .orderBy(desc(operationAttempt.attemptNumber))
      .for("update");
    if (pendingAttempts.length === 0) {
      const attempt = await allocateOperationAttemptInTransaction(
        tx,
        workspaceId,
        input.operationId,
      );
      if (!attempt) {
        throw new Error(
          "presentation translation failure attempt allocation failed",
        );
      }
      pendingAttempts.push({ id: attempt.id });
    }
    const ambiguousUsage = await tx
      .select({ operationAttemptId: aiUsageEvent.operationAttemptId })
      .from(aiUsageEvent)
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          eq(aiUsageEvent.operationId, input.operationId),
          inArray(
            aiUsageEvent.operationAttemptId,
            pendingAttempts.map((attempt) => attempt.id),
          ),
          inArray(aiUsageEvent.status, ["pending", "unknown"]),
        ),
      )
      .for("update");
    const ambiguousAttemptIds = new Set(
      ambiguousUsage.map((usage) => usage.operationAttemptId),
    );
    for (const attempt of pendingAttempts) {
      const ambiguous = ambiguousAttemptIds.has(attempt.id);
      if (ambiguous) {
        await markPendingAttemptUsageUnknown(tx, workspaceId, attempt.id);
      }
      const settled = await settleOperationAttempt(tx, workspaceId, {
        id: attempt.id,
        outcome: ambiguous ? "ambiguous" : "failed_terminal",
        failureCode: input.failureCode,
      });
      if (!settled) {
        throw new Error(
          "presentation translation failure attempt settlement lost",
        );
      }
    }

    const now = new Date();
    const [settled] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: ambiguousAttemptIds.size > 0 ? "unknown" : "failed",
        updatedAt: now,
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, current.version),
          inArray(operation.lifecycle, ["queued", "running", "settling"]),
        ),
      )
      .returning({
        lifecycle: operation.lifecycle,
        version: operation.version,
      });
    if (!settled) {
      throw new Error(
        "presentation translation failure settlement lost under lock",
      );
    }
    return { status: "settled" as const, ...settled };
  });
}

export async function listStaleEditorialPresentationTranslations(
  executor: Executor,
  workspaceId: string,
  input: { limit: number; now: Date },
) {
  return executor
    .select({
      claimedBy: operation.claimedBy,
      operationId: operation.id,
      operationVersion: operation.version,
    })
    .from(editorialPresentationLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, editorialPresentationLocalizationRequest.operationId),
      ),
    )
    .where(
      and(
        inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
        eq(operation.commandType, PRESENTATION_TRANSLATION_COMMAND_TYPE),
        eq(operation.lifecycle, "running"),
        or(
          isNull(operation.leaseExpiresAt),
          lte(operation.leaseExpiresAt, input.now),
        ),
      ),
    )
    .orderBy(asc(operation.createdAt), asc(operation.id))
    .limit(input.limit);
}

export function settleStaleEditorialPresentationTranslation(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string | null;
    expectedVersion: number;
    now: Date;
    operationId: string;
  },
) {
  return settleEditorialPresentationTranslationFailure(executor, workspaceId, {
    claimedBy: input.claimedBy,
    expectedVersion: input.expectedVersion,
    failureCode: "INTERNAL_SERVER_ERROR",
    operationId: input.operationId,
    staleBefore: input.now,
  });
}

type AuthoritativeCard = {
  actor: string;
  analysisRunId: string;
  card: EditorialPresentationTranslationCard;
};

async function lockTranslationOperation(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
) {
  const [current] = await tx
    .select({
      actor: operation.actor,
      claimedBy: operation.claimedBy,
      editorialSelectionId:
        editorialPresentationLocalizationRequest.editorialSelectionId,
      leaseExpiresAt: operation.leaseExpiresAt,
      lifecycle: operation.lifecycle,
      presentationLocale:
        editorialPresentationLocalizationRequest.presentationLocale,
      promoIdeaId: editorialPresentationLocalizationRequest.promoIdeaId,
      telegramFilterResultId:
        editorialPresentationLocalizationRequest.telegramFilterResultId,
      version: operation.version,
    })
    .from(operation)
    .innerJoin(
      editorialPresentationLocalizationRequest,
      and(
        inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
        eq(editorialPresentationLocalizationRequest.operationId, operation.id),
      ),
    )
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, operationId),
        eq(operation.commandType, PRESENTATION_TRANSLATION_COMMAND_TYPE),
      ),
    )
    .for("update");
  return current ?? null;
}

async function lockPendingAttempt(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
  operationAttemptId: string,
) {
  const [attempt] = await tx
    .select({ id: operationAttempt.id })
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.id, operationAttemptId),
        eq(operationAttempt.operationId, operationId),
        isNull(operationAttempt.outcome),
      ),
    )
    .for("update");
  return attempt ?? null;
}

function ownsTranslationClaim(
  current: NonNullable<Awaited<ReturnType<typeof lockTranslationOperation>>>,
  claimFence: EditorialPresentationTranslationClaimFence,
) {
  const now = new Date();
  return (
    current.lifecycle === "running" &&
    current.claimedBy === claimFence.claimedBy &&
    current.version === claimFence.expectedVersion &&
    current.leaseExpiresAt !== null &&
    current.leaseExpiresAt > now
  );
}

async function loadAuthoritativeCard(
  tx: Transaction,
  workspaceId: string,
  origin: CardOriginReference,
): Promise<
  | { status: "found"; value: AuthoritativeCard }
  | { status: "invalid_origin" | "not_found" }
> {
  if (origin.kind === "editorial_selection") {
    const [row] = await tx
      .select({
        actor: operation.actor,
        analysisRunId: analysisModelUnit.analysisRunId,
        contentLocale: sourceItemRevision.contentLocale,
        reasoning: editorialSelection.reasoning,
        sourceItemRevisionId: sourceItemRevision.id,
        summary: sourceItemRevision.summary,
        title: sourceItemRevision.title,
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
        and(
          inWorkspace(analysisRun, workspaceId),
          eq(analysisRun.id, analysisModelUnit.analysisRunId),
        ),
      )
      .innerJoin(
        operation,
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, analysisRun.operationId),
        ),
      )
      .innerJoin(
        analysisRunItem,
        and(
          inWorkspace(analysisRunItem, workspaceId),
          eq(analysisRunItem.analysisRunId, analysisModelUnit.analysisRunId),
          eq(analysisRunItem.sourceItemId, editorialSelection.sourceItemId),
        ),
      )
      .innerJoin(
        sourceItemRevision,
        and(
          inWorkspace(sourceItemRevision, workspaceId),
          eq(sourceItemRevision.id, analysisRunItem.sourceItemRevisionId),
          eq(sourceItemRevision.sourceItemId, analysisRunItem.sourceItemId),
        ),
      )
      .where(
        and(
          inWorkspace(editorialSelection, workspaceId),
          eq(editorialSelection.id, origin.editorialSelectionId),
        ),
      );
    if (!row) return { status: "not_found" };
    return {
      status: "found",
      value: {
        actor: row.actor,
        analysisRunId: row.analysisRunId,
        card: {
          kind: origin.kind,
          editorialSelectionId: origin.editorialSelectionId,
          reasoning: row.reasoning,
          source: sourceContent(row),
        },
      },
    };
  }

  if (origin.kind === "promo_idea") {
    const [row] = await tx
      .select({
        actor: operation.actor,
        analysisRunId: analysisModelUnit.analysisRunId,
        angle: promoIdea.angle,
        description: promoIdea.description,
        title: promoIdea.title,
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
        and(
          inWorkspace(analysisRun, workspaceId),
          eq(analysisRun.id, analysisModelUnit.analysisRunId),
        ),
      )
      .innerJoin(
        operation,
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, analysisRun.operationId),
        ),
      )
      .where(
        and(
          inWorkspace(promoIdea, workspaceId),
          eq(promoIdea.id, origin.promoIdeaId),
        ),
      );
    if (!row) return { status: "not_found" };
    return {
      status: "found",
      value: {
        actor: row.actor,
        analysisRunId: row.analysisRunId,
        card: {
          kind: origin.kind,
          promoIdeaId: origin.promoIdeaId,
          title: row.title,
          description: row.description,
          angle: row.angle,
        },
      },
    };
  }

  const [row] = await tx
    .select({
      actor: operation.actor,
      analysisRunId: filterResult.analysisRunId,
      contentLocale: sourceItemRevision.contentLocale,
      disposition: filterResult.disposition,
      sourceItemRevisionId: sourceItemRevision.id,
      summary: sourceItemRevision.summary,
      title: sourceItemRevision.title,
    })
    .from(filterResult)
    .innerJoin(
      analysisRun,
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, filterResult.analysisRunId),
      ),
    )
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, analysisRun.operationId),
      ),
    )
    .innerJoin(
      analysisRunItem,
      and(
        inWorkspace(analysisRunItem, workspaceId),
        eq(analysisRunItem.analysisRunId, filterResult.analysisRunId),
        eq(analysisRunItem.sourceItemId, filterResult.sourceItemId),
      ),
    )
    .innerJoin(
      sourceItemRevision,
      and(
        inWorkspace(sourceItemRevision, workspaceId),
        eq(sourceItemRevision.id, analysisRunItem.sourceItemRevisionId),
        eq(sourceItemRevision.sourceItemId, analysisRunItem.sourceItemId),
      ),
    )
    .where(
      and(
        inWorkspace(filterResult, workspaceId),
        eq(filterResult.id, origin.telegramFilterResultId),
      ),
    );
  if (!row) return { status: "not_found" };
  if (row.disposition !== "telegram_lane") {
    return { status: "invalid_origin" };
  }
  return {
    status: "found",
    value: {
      actor: row.actor,
      analysisRunId: row.analysisRunId,
      card: {
        kind: origin.kind,
        telegramFilterResultId: origin.telegramFilterResultId,
        source: sourceContent(row),
      },
    },
  };
}

function sourceContent(row: SourceRevisionContent): SourceRevisionContent {
  return {
    sourceItemRevisionId: row.sourceItemRevisionId,
    contentLocale: row.contentLocale,
    title: row.title,
    summary: row.summary,
  };
}

async function loadMissingSubjects(
  tx: Transaction,
  workspaceId: string,
  card: EditorialPresentationTranslationCard,
  presentationLocale: ContentLocale,
) {
  const required = requiredSubjects(card, presentationLocale);
  if (required.length === 0) return [];

  const rows = await readEditorialPresentationLocalizations(
    tx,
    workspaceId,
    required.map((subject) => localizationKey(subject, presentationLocale)),
  );
  const existing = new Set(rows.map(localizationRowIdentity));
  return required.filter(
    (subject) =>
      !existing.has(
        localizationKeyIdentity(localizationKey(subject, presentationLocale)),
      ),
  );
}

function requiredSubjects(
  card: EditorialPresentationTranslationCard,
  presentationLocale: ContentLocale,
): EditorialPresentationTranslationSubject[] {
  if (card.kind === "promo_idea") {
    return presentationLocale === "en"
      ? []
      : [
          {
            kind: card.kind,
            promoIdeaId: card.promoIdeaId,
            contentLocale: "en",
            title: card.title,
            description: card.description,
            angle: card.angle,
          },
        ];
  }

  const source =
    card.source.contentLocale === presentationLocale
      ? []
      : [{ kind: "source_item_revision" as const, ...card.source }];
  if (card.kind === "telegram_filter_result") return source;

  return [
    ...source,
    ...(presentationLocale === "en" || card.reasoning === null
      ? []
      : [
          {
            kind: card.kind,
            editorialSelectionId: card.editorialSelectionId,
            contentLocale: "en" as const,
            reasoning: card.reasoning,
          },
        ]),
  ];
}

async function readInProgressRequest(
  tx: Transaction,
  workspaceId: string,
  origin: CardOriginReference,
  presentationLocale: ContentLocale,
) {
  const [row] = await tx
    .select({
      exhaustedAt: outboxEvent.exhaustedAt,
      id: operation.id,
      lifecycle: operation.lifecycle,
      outboxId: outboxEvent.id,
    })
    .from(editorialPresentationLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, editorialPresentationLocalizationRequest.operationId),
        inArray(operation.lifecycle, ["queued", "running", "settling"]),
      ),
    )
    .innerJoin(
      outboxEvent,
      and(
        inWorkspace(outboxEvent, workspaceId),
        eq(outboxEvent.operationId, operation.id),
        eq(
          outboxEvent.eventType,
          OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
        ),
      ),
    )
    .where(
      and(
        inWorkspace(editorialPresentationLocalizationRequest, workspaceId),
        eq(
          editorialPresentationLocalizationRequest.presentationLocale,
          presentationLocale,
        ),
        requestOriginPredicate(origin),
      ),
    )
    .orderBy(
      desc(editorialPresentationLocalizationRequest.createdAt),
      desc(editorialPresentationLocalizationRequest.operationId),
    )
    .limit(1);
  return row ?? null;
}

function translationDispatchState(input: {
  dispatchAttemptCount: number | null;
  dispatchedAt: Date | null;
  exhaustedAt: Date | null;
}): DispatchState {
  if (input.exhaustedAt) return "exhausted";
  if (input.dispatchedAt) return "dispatched";
  return (input.dispatchAttemptCount ?? 0) > 0 ? "delayed" : "undispatched";
}

function operationIdentity(input: StartEditorialPresentationTranslationInput) {
  return {
    actor: input.actor,
    commandType: PRESENTATION_TRANSLATION_COMMAND_TYPE,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    requestId: input.requestId,
  };
}

function replay(
  existing: typeof operation.$inferSelect,
  requestHash: string,
): StartEditorialPresentationTranslationResult {
  return existing.requestHash === requestHash
    ? {
        status: "replayed",
        operationId: existing.id,
        lifecycle: existing.lifecycle,
      }
    : { status: "idempotency_mismatch" };
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

function requestOriginPredicate(origin: CardOriginReference) {
  if (origin.kind === "editorial_selection") {
    return eq(
      editorialPresentationLocalizationRequest.editorialSelectionId,
      origin.editorialSelectionId,
    );
  }
  if (origin.kind === "telegram_filter_result") {
    return eq(
      editorialPresentationLocalizationRequest.telegramFilterResultId,
      origin.telegramFilterResultId,
    );
  }
  return eq(
    editorialPresentationLocalizationRequest.promoIdeaId,
    origin.promoIdeaId,
  );
}

async function readPlatformDraftIds(
  executor: Executor | Transaction,
  workspaceId: string,
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
  const rows = await executor
    .select({ id: platformDraft.id })
    .from(platformDraft)
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        isNull(platformDraft.deletedAt),
        originPredicate,
      ),
    )
    .orderBy(asc(platformDraft.id));
  return rows.map((row) => row.id);
}

function originFromRequest(request: {
  editorialSelectionId: string | null;
  promoIdeaId: string | null;
  telegramFilterResultId: string | null;
}): CardOriginReference | null {
  if (request.editorialSelectionId) {
    return {
      kind: "editorial_selection",
      editorialSelectionId: request.editorialSelectionId,
    };
  }
  if (request.telegramFilterResultId) {
    return {
      kind: "telegram_filter_result",
      telegramFilterResultId: request.telegramFilterResultId,
    };
  }
  return request.promoIdeaId
    ? { kind: "promo_idea", promoIdeaId: request.promoIdeaId }
    : null;
}

function originIdentity(origin: CardOriginReference) {
  if (origin.kind === "editorial_selection") {
    return `${origin.kind}:${origin.editorialSelectionId}`;
  }
  if (origin.kind === "telegram_filter_result") {
    return `${origin.kind}:${origin.telegramFilterResultId}`;
  }
  return `${origin.kind}:${origin.promoIdeaId}`;
}

function localizationKey(
  subject: EditorialPresentationTranslationSubject,
  presentationLocale: ContentLocale,
): EditorialPresentationLocalizationKey {
  if (subject.kind === "source_item_revision") {
    return {
      kind: subject.kind,
      sourceItemRevisionId: subject.sourceItemRevisionId,
      presentationLocale,
    };
  }
  if (subject.kind === "editorial_selection") {
    return {
      kind: subject.kind,
      editorialSelectionId: subject.editorialSelectionId,
      presentationLocale,
    };
  }
  return {
    kind: subject.kind,
    promoIdeaId: subject.promoIdeaId,
    presentationLocale,
  };
}

function validTranslationWrites(
  writes: readonly EditorialPresentationTranslationWrite[],
  required: readonly EditorialPresentationTranslationSubject[],
  missing: readonly EditorialPresentationTranslationSubject[],
) {
  const writeIdentities = writes.map(translationWriteIdentity);
  if (new Set(writeIdentities).size !== writeIdentities.length) return false;

  const allowed = new Set(required.map(translationSubjectIdentity));
  const supplied = new Set(writeIdentities);
  return (
    writeIdentities.every((identity) => allowed.has(identity)) &&
    missing.every((subject) =>
      supplied.has(translationSubjectIdentity(subject)),
    )
  );
}

function persistedLocalizationInput(
  localization: EditorialPresentationTranslationWrite,
  presentationLocale: ContentLocale,
  operationAttemptId: string,
): PersistEditorialPresentationLocalizationInput {
  const base = { operationAttemptId, presentationLocale };
  if (localization.kind === "source_item_revision") {
    return {
      ...base,
      kind: localization.kind,
      sourceItemRevisionId: localization.sourceItemRevisionId,
      title: localization.title,
      summary: localization.summary,
    };
  }
  if (localization.kind === "editorial_selection") {
    return {
      ...base,
      kind: localization.kind,
      editorialSelectionId: localization.editorialSelectionId,
      reasoning: localization.reasoning,
    };
  }
  return {
    ...base,
    kind: localization.kind,
    promoIdeaId: localization.promoIdeaId,
    title: localization.title,
    description: localization.description,
    angle: localization.angle,
  };
}

function translationSubjectIdentity(
  subject: EditorialPresentationTranslationSubject,
) {
  if (subject.kind === "source_item_revision") {
    return `${subject.kind}:${subject.sourceItemRevisionId}`;
  }
  if (subject.kind === "editorial_selection") {
    return `${subject.kind}:${subject.editorialSelectionId}`;
  }
  return `${subject.kind}:${subject.promoIdeaId}`;
}

function translationWriteIdentity(
  write: EditorialPresentationTranslationWrite,
) {
  if (write.kind === "source_item_revision") {
    return `${write.kind}:${write.sourceItemRevisionId}`;
  }
  if (write.kind === "editorial_selection") {
    return `${write.kind}:${write.editorialSelectionId}`;
  }
  return `${write.kind}:${write.promoIdeaId}`;
}

function localizationKeyIdentity(key: EditorialPresentationLocalizationKey) {
  if (key.kind === "source_item_revision") {
    return `${key.kind}:${key.sourceItemRevisionId}:${key.presentationLocale}`;
  }
  if (key.kind === "editorial_selection") {
    return `${key.kind}:${key.editorialSelectionId}:${key.presentationLocale}`;
  }
  return `${key.kind}:${key.promoIdeaId}:${key.presentationLocale}`;
}

function localizationRowIdentity(
  row: Awaited<
    ReturnType<typeof readEditorialPresentationLocalizations>
  >[number],
) {
  if (row.sourceItemRevisionId) {
    return `source_item_revision:${row.sourceItemRevisionId}:${row.presentationLocale}`;
  }
  if (row.editorialSelectionId) {
    return `editorial_selection:${row.editorialSelectionId}:${row.presentationLocale}`;
  }
  if (row.promoIdeaId) {
    return `promo_idea:${row.promoIdeaId}:${row.presentationLocale}`;
  }
  throw new Error("presentation localization has no subject");
}
