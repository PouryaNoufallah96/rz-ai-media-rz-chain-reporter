import {
  type AttemptOutcome,
  COPY_VARIANT_TRANSLATION_COMMAND_TYPE,
  type ContentLocale,
  type DispatchState,
  DURABLE_EVENT_SCHEMA_VERSION,
  type ErrorCode,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
  type OperationLifecycle,
  type Platform,
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
import { inWorkspace, liveInWorkspace } from "../filters";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { copyVariantLocalization } from "../schema/copy-variant-localization";
import { copyVariantLocalizationRequest } from "../schema/copy-variant-localization-request";
import { editorialSelection } from "../schema/editorial-selection";
import { filterResult } from "../schema/filter-result";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { promoIdea } from "../schema/promo-idea";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import { markPendingAttemptUsageUnknown } from "./ai-usage-event";
import { ownedDraftExists } from "./draft-origin";
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

export type CopyVariantTranslationSource = {
  body: string;
  contentLocale: ContentLocale;
  copyVariantId: string;
  hashtags: string[];
  headline: string;
  mediaBrandKey: string;
  platform: Platform;
  platformDraftId: string;
  publishSource: { attribution: string; canonicalUrl: string } | null;
};

export type CopyVariantTranslationLocalization = {
  body: string;
  hashtags: readonly string[];
  headline: string;
};

export type StartCopyVariantTranslationInput = {
  actor: string;
  contentLocale: ContentLocale;
  copyVariantId: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
};

export type StartCopyVariantTranslationResult =
  | {
      lifecycle: OperationLifecycle;
      operationId: string;
      status: "created" | "replayed";
    }
  | {
      status: "already_available" | "idempotency_mismatch" | "not_found";
    };

export type LoadCopyVariantTranslationRequestResult =
  | {
      actor: string;
      analysisRunId: string;
      contentLocale: ContentLocale;
      operationId: string;
      source: CopyVariantTranslationSource;
      status: "ready";
    }
  | { status: "not_found" };

export type CopyVariantTranslationClaimFence = {
  claimedBy: string;
  expectedVersion: number;
};

export type CopyVariantTranslationStatus = {
  copyVariantId: string;
  dispatchState: DispatchState;
  lifecycle: OperationLifecycle;
  operationId: string;
};

export async function readCopyVariantLocalizations(
  executor: Executor,
  workspaceId: string,
  copyVariantIds: readonly string[],
  contentLocale: ContentLocale,
) {
  if (copyVariantIds.length === 0) return [];

  return executor
    .select()
    .from(copyVariantLocalization)
    .where(
      and(
        inWorkspace(copyVariantLocalization, workspaceId),
        inArray(copyVariantLocalization.copyVariantId, copyVariantIds),
        eq(copyVariantLocalization.contentLocale, contentLocale),
      ),
    )
    .orderBy(asc(copyVariantLocalization.copyVariantId));
}

export async function startCopyVariantTranslation(
  executor: Executor,
  workspaceId: string,
  input: StartCopyVariantTranslationInput,
): Promise<StartCopyVariantTranslationResult> {
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
      sql`select pg_advisory_xact_lock(hashtext('copy-variant-translation-command'), hashtext(${`${workspaceId}:${input.copyVariantId}:${input.contentLocale}`}))`,
    );

    const serializedReplay = await readOperationIdentity(
      tx,
      workspaceId,
      identity,
    );
    if (serializedReplay) return replay(serializedReplay, input.requestHash);

    const initialSource = await loadAuthoritativeSource(
      tx,
      workspaceId,
      input.copyVariantId,
      input.actor,
    );
    if (!initialSource) return { status: "not_found" };

    const [lockedDraft] = await tx
      .select({ id: platformDraft.id })
      .from(platformDraft)
      .where(
        and(
          inWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, initialSource.source.platformDraftId),
        ),
      )
      .for("update");
    if (!lockedDraft) return { status: "not_found" };

    const source = await loadAuthoritativeSource(
      tx,
      workspaceId,
      input.copyVariantId,
      input.actor,
    );
    if (!source) return { status: "not_found" };
    if (
      source.source.contentLocale === input.contentLocale ||
      (await localizationExists(
        tx,
        workspaceId,
        input.copyVariantId,
        input.contentLocale,
      ))
    ) {
      return { status: "already_available" };
    }

    const inProgress = await readInProgressRequest(
      tx,
      workspaceId,
      input.copyVariantId,
      input.contentLocale,
    );
    if (inProgress) {
      if (inProgress.lifecycle === "queued" && inProgress.exhaustedAt) {
        const rearmed = await rearmOutboxEventInTransaction(tx, workspaceId, {
          id: inProgress.outboxId,
        });
        if (!rearmed) {
          throw new Error("copy variant translation dispatch rearm lost");
        }
      }
      return {
        status: "replayed",
        operationId: inProgress.operationId,
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

    await tx.insert(copyVariantLocalizationRequest).values({
      operationId: created.id,
      workspaceId,
      copyVariantId: input.copyVariantId,
      contentLocale: input.contentLocale,
    });
    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId: created.id,
      eventType: OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
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

export async function loadCopyVariantTranslationRequest(
  executor: Executor,
  workspaceId: string,
  operationId: string,
): Promise<LoadCopyVariantTranslationRequestResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [request] = await tx
      .select({
        actor: operation.actor,
        contentLocale: copyVariantLocalizationRequest.contentLocale,
        copyVariantId: copyVariantLocalizationRequest.copyVariantId,
      })
      .from(copyVariantLocalizationRequest)
      .innerJoin(
        operation,
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, copyVariantLocalizationRequest.operationId),
          eq(operation.commandType, COPY_VARIANT_TRANSLATION_COMMAND_TYPE),
        ),
      )
      .where(
        and(
          inWorkspace(copyVariantLocalizationRequest, workspaceId),
          eq(copyVariantLocalizationRequest.operationId, operationId),
        ),
      );
    if (!request) return { status: "not_found" };

    const loaded = await loadAuthoritativeSource(
      tx,
      workspaceId,
      request.copyVariantId,
      request.actor,
    );
    return loaded
      ? {
          status: "ready",
          operationId,
          actor: request.actor,
          analysisRunId: loaded.analysisRunId,
          contentLocale: request.contentLocale,
          source: loaded.source,
        }
      : { status: "not_found" };
  });
}

export async function readCopyVariantTranslationStatuses(
  executor: Executor,
  workspaceId: string,
  actorId: string,
  copyVariantIds: readonly string[],
  contentLocale: ContentLocale,
): Promise<CopyVariantTranslationStatus[]> {
  if (copyVariantIds.length === 0) return [];

  const rows = await executor
    .selectDistinctOn([copyVariantLocalizationRequest.copyVariantId], {
      copyVariantId: copyVariantLocalizationRequest.copyVariantId,
      dispatchAttemptCount: outboxEvent.dispatchAttemptCount,
      dispatchedAt: outboxEvent.dispatchedAt,
      exhaustedAt: outboxEvent.exhaustedAt,
      lifecycle: operation.lifecycle,
      operationId: operation.id,
    })
    .from(copyVariantLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, copyVariantLocalizationRequest.operationId),
        eq(operation.actor, actorId),
        eq(operation.commandType, COPY_VARIANT_TRANSLATION_COMMAND_TYPE),
      ),
    )
    .leftJoin(
      outboxEvent,
      and(
        inWorkspace(outboxEvent, workspaceId),
        eq(outboxEvent.operationId, operation.id),
        eq(
          outboxEvent.eventType,
          OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
        ),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariantLocalizationRequest, workspaceId),
        inArray(copyVariantLocalizationRequest.copyVariantId, copyVariantIds),
        eq(copyVariantLocalizationRequest.contentLocale, contentLocale),
      ),
    )
    .orderBy(
      asc(copyVariantLocalizationRequest.copyVariantId),
      desc(copyVariantLocalizationRequest.createdAt),
      desc(copyVariantLocalizationRequest.operationId),
    );

  return rows.map((row) => ({
    copyVariantId: row.copyVariantId,
    dispatchState: translationDispatchState(row),
    lifecycle: row.lifecycle,
    operationId: row.operationId,
  }));
}

export async function claimCopyVariantTranslation(
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
    .select({ operationId: copyVariantLocalizationRequest.operationId })
    .from(copyVariantLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, copyVariantLocalizationRequest.operationId),
        eq(operation.commandType, COPY_VARIANT_TRANSLATION_COMMAND_TYPE),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariantLocalizationRequest, workspaceId),
        eq(copyVariantLocalizationRequest.operationId, input.operationId),
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

export async function allocateCopyVariantTranslationAttempt(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  attemptId: string,
  claimFence: CopyVariantTranslationClaimFence,
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
      sql`select pg_advisory_xact_lock(hashtext('copy-variant-translation-attempt'), hashtext(${operationId}))`,
    );
    const [operationExisting] = await tx
      .select()
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.operationId, operationId),
        ),
      )
      .orderBy(asc(operationAttempt.attemptNumber))
      .limit(1);
    if (operationExisting) {
      return operationExisting.id === attemptId
        ? {
            status: "allocated" as const,
            attempt: operationExisting,
            reused: true,
          }
        : { status: "attempt_id_conflict" as const };
    }

    const [idExisting] = await tx
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(eq(operationAttempt.id, attemptId));
    if (idExisting) return { status: "attempt_id_conflict" as const };

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
      throw new Error("copy variant translation attempt numbering failed");
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
      throw new Error("copy variant translation attempt allocation failed");
    }
    return { status: "allocated" as const, attempt, reused: false };
  });
}

export type CompleteCopyVariantTranslationInput = {
  claimFence: CopyVariantTranslationClaimFence;
  localization: CopyVariantTranslationLocalization;
  operationAttemptId: string;
  operationId: string;
};

export async function completeCopyVariantTranslation(
  executor: Executor,
  workspaceId: string,
  input: CompleteCopyVariantTranslationInput,
) {
  return executor.transaction((tx) =>
    completeCopyVariantTranslationInTransaction(tx, workspaceId, input),
  );
}

export async function completeCopyVariantTranslationInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: CompleteCopyVariantTranslationInput,
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
  if (!completeLocalization(input.localization)) {
    return { status: "invalid_output" as const };
  }

  const loaded = await loadAuthoritativeSource(
    tx,
    workspaceId,
    current.copyVariantId,
    current.actor,
  );
  if (!loaded || loaded.source.contentLocale === current.contentLocale) {
    return { status: "invalid_output" as const };
  }
  const attempt = await lockPendingAttempt(
    tx,
    workspaceId,
    input.operationId,
    input.operationAttemptId,
  );
  if (!attempt) return { status: "invalid_output" as const };

  await tx
    .insert(copyVariantLocalization)
    .values({
      workspaceId,
      copyVariantId: current.copyVariantId,
      contentLocale: current.contentLocale,
      operationAttemptId: input.operationAttemptId,
      headline: input.localization.headline,
      body: input.localization.body,
      hashtags: [...input.localization.hashtags],
    })
    .onConflictDoNothing();
  if (
    !(await localizationExists(
      tx,
      workspaceId,
      current.copyVariantId,
      current.contentLocale,
    ))
  ) {
    throw new Error("copy variant localization conflict returned no row");
  }

  const settledAttempt = await settleOperationAttempt(tx, workspaceId, {
    id: input.operationAttemptId,
    outcome: "succeeded",
  });
  if (!settledAttempt) {
    throw new Error("copy variant translation attempt settlement lost");
  }

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
  if (!settled) {
    throw new Error("copy variant translation claim lost under lock");
  }
  return { status: "persisted" as const, ...settled };
}

export type FailCopyVariantTranslationInput = {
  claimFence: CopyVariantTranslationClaimFence;
  failureCode: ErrorCode;
  operationAttemptId: string;
  operationId: string;
  outcome: Extract<AttemptOutcome, "ambiguous" | "failed_terminal">;
};

export async function failCopyVariantTranslation(
  executor: Executor,
  workspaceId: string,
  input: FailCopyVariantTranslationInput,
) {
  return executor.transaction((tx) =>
    failCopyVariantTranslationInTransaction(tx, workspaceId, input),
  );
}

export async function failCopyVariantTranslationInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: FailCopyVariantTranslationInput,
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

  const attempt = await lockPendingAttempt(
    tx,
    workspaceId,
    input.operationId,
    input.operationAttemptId,
  );
  if (!attempt) return { status: "invalid_output" as const };

  const settledAttempt = await settleOperationAttempt(tx, workspaceId, {
    id: input.operationAttemptId,
    outcome: input.outcome,
    failureCode: input.failureCode,
  });
  if (!settledAttempt) {
    throw new Error("copy variant translation attempt settlement lost");
  }

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
  if (!settled) {
    throw new Error("copy variant translation claim lost under lock");
  }
  return { status: "settled" as const, ...settled };
}

export async function settleCopyVariantTranslationFailure(
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
          "copy variant translation failure attempt allocation failed",
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
          "copy variant translation failure attempt settlement lost",
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
        "copy variant translation failure settlement lost under lock",
      );
    }
    return { status: "settled" as const, ...settled };
  });
}

export async function listStaleCopyVariantTranslations(
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
    .from(copyVariantLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, copyVariantLocalizationRequest.operationId),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariantLocalizationRequest, workspaceId),
        eq(operation.commandType, COPY_VARIANT_TRANSLATION_COMMAND_TYPE),
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

export function settleStaleCopyVariantTranslation(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string | null;
    expectedVersion: number;
    now: Date;
    operationId: string;
  },
) {
  return settleCopyVariantTranslationFailure(executor, workspaceId, {
    claimedBy: input.claimedBy,
    expectedVersion: input.expectedVersion,
    failureCode: "INTERNAL_SERVER_ERROR",
    operationId: input.operationId,
    staleBefore: input.now,
  });
}

async function loadAuthoritativeSource(
  executor: Executor,
  workspaceId: string,
  copyVariantId: string,
  actorId: string,
) {
  const [row] = await executor
    .select({
      analysisRunId: sql<string>`coalesce(${filterResult.analysisRunId}, ${analysisRun.id})`,
      attribution: sourceItem.attribution,
      body: copyVariant.body,
      canonicalUrl: sourceItemRevision.canonicalUrl,
      contentLocale: copyVariant.contentLocale,
      copyVariantId: copyVariant.id,
      hashtags: copyVariant.hashtags,
      headline: copyVariant.headline,
      mediaBrandKey: mediaBrand.key,
      platform: platformDraft.platform,
      platformDraftId: platformDraft.id,
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
        eq(copyGeneration.operationId, copyGenerationUnit.copyGenerationId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        liveInWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, copyGeneration.platformDraftId),
      ),
    )
    .innerJoin(
      mediaBrand,
      and(
        liveInWorkspace(mediaBrand, workspaceId),
        eq(mediaBrand.id, platformDraft.mediaBrandId),
      ),
    )
    .leftJoin(
      filterResult,
      and(
        inWorkspace(filterResult, workspaceId),
        eq(filterResult.id, platformDraft.telegramFilterResultId),
      ),
    )
    .leftJoin(
      editorialSelection,
      and(
        inWorkspace(editorialSelection, workspaceId),
        eq(editorialSelection.id, platformDraft.editorialSelectionId),
      ),
    )
    .leftJoin(
      promoIdea,
      and(
        inWorkspace(promoIdea, workspaceId),
        eq(promoIdea.id, platformDraft.promoIdeaId),
      ),
    )
    .leftJoin(
      analysisModelUnit,
      and(
        inWorkspace(analysisModelUnit, workspaceId),
        or(
          eq(analysisModelUnit.id, editorialSelection.analysisModelUnitId),
          eq(analysisModelUnit.id, promoIdea.analysisModelUnitId),
        ),
      ),
    )
    .leftJoin(
      analysisRun,
      and(
        inWorkspace(analysisRun, workspaceId),
        eq(analysisRun.id, analysisModelUnit.analysisRunId),
      ),
    )
    .leftJoin(
      sourceItemRevision,
      and(
        inWorkspace(sourceItemRevision, workspaceId),
        eq(sourceItemRevision.id, copyGeneration.sourceItemRevisionId),
      ),
    )
    .leftJoin(
      sourceItem,
      and(
        inWorkspace(sourceItem, workspaceId),
        eq(sourceItem.id, sourceItemRevision.sourceItemId),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, copyVariantId),
        ownedDraftExists(workspaceId, actorId, platformDraft.id),
      ),
    );
  if (!row?.analysisRunId) return null;

  return {
    analysisRunId: row.analysisRunId,
    source: {
      body: row.body,
      contentLocale: row.contentLocale,
      copyVariantId: row.copyVariantId,
      hashtags: row.hashtags,
      headline: row.headline,
      mediaBrandKey: row.mediaBrandKey,
      platform: row.platform,
      platformDraftId: row.platformDraftId,
      publishSource:
        row.attribution && row.canonicalUrl
          ? { attribution: row.attribution, canonicalUrl: row.canonicalUrl }
          : null,
    } satisfies CopyVariantTranslationSource,
  };
}

async function localizationExists(
  executor: Executor,
  workspaceId: string,
  copyVariantId: string,
  contentLocale: ContentLocale,
) {
  const [row] = await executor
    .select({ id: copyVariantLocalization.id })
    .from(copyVariantLocalization)
    .where(
      and(
        inWorkspace(copyVariantLocalization, workspaceId),
        eq(copyVariantLocalization.copyVariantId, copyVariantId),
        eq(copyVariantLocalization.contentLocale, contentLocale),
      ),
    );
  return Boolean(row);
}

async function readInProgressRequest(
  executor: Executor,
  workspaceId: string,
  copyVariantId: string,
  contentLocale: ContentLocale,
) {
  const [row] = await executor
    .select({
      exhaustedAt: outboxEvent.exhaustedAt,
      lifecycle: operation.lifecycle,
      operationId: operation.id,
      outboxId: outboxEvent.id,
    })
    .from(copyVariantLocalizationRequest)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, copyVariantLocalizationRequest.operationId),
        eq(operation.commandType, COPY_VARIANT_TRANSLATION_COMMAND_TYPE),
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
          OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
        ),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariantLocalizationRequest, workspaceId),
        eq(copyVariantLocalizationRequest.copyVariantId, copyVariantId),
        eq(copyVariantLocalizationRequest.contentLocale, contentLocale),
      ),
    )
    .orderBy(
      desc(copyVariantLocalizationRequest.createdAt),
      desc(copyVariantLocalizationRequest.operationId),
    )
    .limit(1);
  return row ?? null;
}

async function lockTranslationOperation(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
) {
  const [current] = await tx
    .select({
      actor: operation.actor,
      claimedBy: operation.claimedBy,
      contentLocale: copyVariantLocalizationRequest.contentLocale,
      copyVariantId: copyVariantLocalizationRequest.copyVariantId,
      leaseExpiresAt: operation.leaseExpiresAt,
      lifecycle: operation.lifecycle,
      version: operation.version,
    })
    .from(operation)
    .innerJoin(
      copyVariantLocalizationRequest,
      and(
        inWorkspace(copyVariantLocalizationRequest, workspaceId),
        eq(copyVariantLocalizationRequest.operationId, operation.id),
      ),
    )
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, operationId),
        eq(operation.commandType, COPY_VARIANT_TRANSLATION_COMMAND_TYPE),
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
  claimFence: CopyVariantTranslationClaimFence,
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

function completeLocalization(input: CopyVariantTranslationLocalization) {
  return (
    input.headline.trim().length > 0 &&
    input.body.trim().length > 0 &&
    input.hashtags.length > 0 &&
    input.hashtags.every((hashtag) => hashtag.trim().length > 0)
  );
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

function operationIdentity(input: StartCopyVariantTranslationInput) {
  return {
    actor: input.actor,
    commandType: COPY_VARIANT_TRANSLATION_COMMAND_TYPE,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    requestId: input.requestId,
  };
}

function replay(
  existing: typeof operation.$inferSelect,
  requestHash: string,
): StartCopyVariantTranslationResult {
  return existing.requestHash === requestHash
    ? {
        status: "replayed",
        operationId: existing.id,
        lifecycle: existing.lifecycle,
      }
    : { status: "idempotency_mismatch" };
}
