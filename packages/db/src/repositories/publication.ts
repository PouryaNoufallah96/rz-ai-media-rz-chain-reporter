import { randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  type ErrorCode,
  OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
  type PublicationFailureCode,
  type PublishCommandKind,
  type ReconciliationAuthority,
  type ReconciliationDecision,
} from "@rz-chain-reporter/contracts";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lte,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace, liveInWorkspace } from "../filters";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { destinationAccount } from "../schema/destination-account";
import { draftRevision } from "../schema/draft-revision";
import { mediaAsset } from "../schema/media-asset";
import { mediaBrandDestinationAccount } from "../schema/media-brand-destination-account";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { publication } from "../schema/publication";
import { publicationReconciliation } from "../schema/publication-reconciliation";
import { publishCheckpoint } from "../schema/publish-checkpoint";
import { publishOperation } from "../schema/publish-operation";
import { publishingControl } from "../schema/publishing-control";
import { schedule } from "../schema/schedule";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import { appendActivityEvent } from "./activity-event";
import { readActionableApproval } from "./approval";
import { ownedDraftExists, readLiveDraftRevisionOrigin } from "./draft-origin";
import { insertOperationIdentity, readOperationIdentity } from "./operation";
import { allocateOperationAttemptInTransaction } from "./operation-attempt";

type PublicationRow = typeof publication.$inferSelect;

export type PublicationAdmissionFailure =
  | "approval_required"
  | "approval_snapshot_stale"
  | "destination_disabled"
  | "destination_not_mapped"
  | "destination_unbound"
  | "idempotency_mismatch"
  | "not_found"
  | "publication_already_claimed"
  | "publication_already_confirmed"
  | "publication_reconciliation_required"
  | "publishing_paused"
  | "telegram_attestation_required"
  | "version_conflict";

type PublicationAdmissionResult =
  | {
      status: "created" | "replayed";
      operationId: string;
      publication: PublicationRow;
    }
  | { status: PublicationAdmissionFailure };

type AdmissionContext = NonNullable<
  Awaited<ReturnType<typeof loadAdmissionContext>>
>;

export async function admitDirectPublication(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    approvalId: string;
    destinationAccountId: string;
    idempotencyKey: string;
    requestHash: string;
    requestId: string | null;
    scheduleId?: string | null;
    commandKind?: PublishCommandKind;
    expectedRevisionVersion?: number;
    expectedPublicationVersion?: number;
    expectedScheduleVersion?: number;
  },
): Promise<PublicationAdmissionResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const commandKind = input.commandKind ?? "direct";
    const commandType = `publishing:${commandKind}`;
    const replay = await readOperationIdentity(tx, workspaceId, {
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
    });
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        return { status: "idempotency_mismatch" };
      }
      const [existing] = await tx
        .select({ publication })
        .from(publishOperation)
        .innerJoin(
          publication,
          and(
            inWorkspace(publication, workspaceId),
            eq(publication.id, publishOperation.publicationId),
          ),
        )
        .where(
          and(
            inWorkspace(publishOperation, workspaceId),
            eq(publishOperation.operationId, replay.id),
          ),
        );
      if (!existing) throw new Error("publish operation replay is missing");
      return {
        status: "replayed",
        operationId: replay.id,
        publication: existing.publication,
      };
    }

    const expectedRevisionVersion =
      commandKind === "direct" ? input.expectedRevisionVersion : null;
    if (expectedRevisionVersion === undefined) {
      return { status: "version_conflict" };
    }
    const admission = await loadAdmissionContext(
      tx,
      workspaceId,
      input.approvalId,
      input.destinationAccountId,
      expectedRevisionVersion,
      input.actorId,
    );
    if (!admission) return { status: "approval_required" };
    if (admission.status !== "ready") return { status: admission.status };

    if (commandKind === "missed_recovery") {
      const [missed] = await tx
        .select()
        .from(schedule)
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, input.scheduleId ?? ""),
            eq(schedule.version, input.expectedScheduleVersion ?? -1),
            eq(schedule.lifecycle, "missed_requires_confirmation"),
            eq(schedule.approvalId, input.approvalId),
            eq(schedule.destinationAccountId, input.destinationAccountId),
          ),
        )
        .for("update");
      if (!missed) return { status: "publication_already_claimed" };
    }

    const publicationRow = await lockOrCreatePublication(
      tx,
      workspaceId,
      admission,
    );
    const slotFailure = classifySlot(
      publicationRow,
      input.scheduleId,
      input.expectedPublicationVersion,
    );
    if (slotFailure) return { status: slotFailure };

    const operationId = randomUUID();
    await insertOperationIdentity(tx, workspaceId, {
      operationId,
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
    });
    await tx.insert(publishOperation).values({
      operationId,
      workspaceId,
      publicationId: publicationRow.id,
      destinationAccountId: input.destinationAccountId,
      platform: publicationRow.platform,
      draftRevisionId: publicationRow.draftRevisionId,
      selectedFinalMediaAssetId: publicationRow.selectedFinalMediaAssetId,
      scheduleId: input.scheduleId,
      commandKind,
    });
    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId,
      eventType: OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        operationId,
        publicationId: publicationRow.id,
        ...(input.scheduleId ? { scheduleId: input.scheduleId } : {}),
      },
    });
    const [claimed] = await tx
      .update(publication)
      .set({
        lifecycle: "effect_claimed",
        activeOperationId: operationId,
        reservedScheduleId:
          input.scheduleId ?? publicationRow.reservedScheduleId,
        version: publicationRow.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, publicationRow.id),
          eq(publication.version, publicationRow.version),
          input.scheduleId
            ? eq(publication.lifecycle, "reserved")
            : eq(publication.lifecycle, "available"),
        ),
      )
      .returning();
    if (!claimed) return { status: "publication_already_claimed" };

    const activity = await appendActivityEvent(tx, workspaceId, {
      actorId: input.actorId,
      eventType: "publication.requested",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      publicationId: claimed.id,
      operationId,
    });
    if (activity.status === "mismatch") {
      throw new Error("publication activity identity mismatch");
    }
    return { status: "created", operationId, publication: claimed };
  });
}

export async function reservePublication(
  tx: Transaction,
  workspaceId: string,
  input: {
    actorId: string;
    approvalId: string;
    destinationAccountId: string;
    expectedRevisionVersion: number;
    scheduleId: string;
  },
) {
  const admission = await loadAdmissionContext(
    tx,
    workspaceId,
    input.approvalId,
    input.destinationAccountId,
    input.expectedRevisionVersion,
    input.actorId,
  );
  if (!admission) return { status: "approval_required" } as const;
  if (admission.status !== "ready")
    return { status: admission.status } as const;
  const current = await lockOrCreatePublication(tx, workspaceId, admission);
  const failure = classifySlot(current);
  if (failure) return { status: failure } as const;
  const [reserved] = await tx
    .update(publication)
    .set({
      lifecycle: "reserved",
      reservedScheduleId: input.scheduleId,
      version: current.version + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, current.id),
        eq(publication.version, current.version),
        eq(publication.lifecycle, "available"),
      ),
    )
    .returning();
  return reserved
    ? { status: "reserved" as const, publication: reserved, admission }
    : { status: "publication_already_claimed" as const };
}

export async function releaseReservedPublication(
  tx: Transaction,
  workspaceId: string,
  publicationId: string,
  scheduleId: string,
) {
  const [released] = await tx
    .update(publication)
    .set({
      lifecycle: "available",
      reservedScheduleId: null,
      version: sql`${publication.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, publicationId),
        eq(publication.lifecycle, "reserved"),
        eq(publication.reservedScheduleId, scheduleId),
      ),
    )
    .returning();
  return released ?? null;
}

export async function transferPublicationReservation(
  tx: Transaction,
  workspaceId: string,
  publicationId: string,
  fromScheduleId: string,
  toScheduleId: string,
) {
  const [updated] = await tx
    .update(publication)
    .set({
      reservedScheduleId: toScheduleId,
      version: sql`${publication.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, publicationId),
        eq(publication.lifecycle, "reserved"),
        eq(publication.reservedScheduleId, fromScheduleId),
      ),
    )
    .returning();
  return updated ?? null;
}

const PUBLISHING_MISS_WINDOW_MS = 5 * 60_000;
const PUBLISHING_QUEUED_RECOVERY_GRACE_MS = 5_000;

function ownsScheduleEffect(commandKind: PublishCommandKind | null) {
  return commandKind === "scheduled";
}

export function classifyPublicationWake(effectiveAt: Date, now: Date) {
  if (now < effectiveAt) return "not_due" as const;
  return now.getTime() - effectiveAt.getTime() > PUBLISHING_MISS_WINDOW_MS
    ? ("missed" as const)
    : ("due" as const);
}

export async function readPublicationEffectiveAt(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      commandKind: publishOperation.commandKind,
      effectiveAt: schedule.effectiveAt,
      scheduleId: publishOperation.scheduleId,
    })
    .from(publishOperation)
    .leftJoin(
      schedule,
      and(
        inWorkspace(schedule, workspaceId),
        eq(schedule.id, publishOperation.scheduleId),
      ),
    )
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
      ),
    );
  return row
    ? {
        effectiveAt: ownsScheduleEffect(row.commandKind)
          ? row.effectiveAt
          : null,
        scheduleId: row.scheduleId,
      }
    : null;
}

export async function claimPublicationExecution(
  executor: Executor,
  workspaceId: string,
  input: {
    operationId: string;
    publicationId: string;
    claimedBy: string;
    now: Date;
    leaseExpiresAt: Date;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [owned] = await tx
      .select()
      .from(publishOperation)
      .where(
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, input.operationId),
          eq(publishOperation.publicationId, input.publicationId),
        ),
      );
    if (!owned) return { status: "not_found" as const };

    let currentSchedule: typeof schedule.$inferSelect | null = null;
    if (owned.scheduleId && ownsScheduleEffect(owned.commandKind)) {
      const [loaded] = await tx
        .select()
        .from(schedule)
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, owned.scheduleId),
          ),
        )
        .for("update");
      if (!loaded) return { status: "not_found" as const };
      currentSchedule = loaded;
    }
    const [currentPublication] = await tx
      .select()
      .from(publication)
      .where(
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, input.publicationId),
        ),
      )
      .for("update");
    const [currentOperation] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
        ),
      )
      .for("update");
    if (!currentPublication || !currentOperation) {
      return { status: "not_found" as const };
    }
    const current = {
      operation: currentOperation,
      publication: currentPublication,
      publishOperation: owned,
    };
    if (
      !(["queued", "running"] as const).includes(
        current.operation.lifecycle as "queued" | "running",
      )
    ) {
      return { status: "terminal" as const, operation: current.operation };
    }

    if (currentSchedule) {
      const loaded = currentSchedule;
      const wake = classifyPublicationWake(loaded.effectiveAt, input.now);
      if (wake === "not_due") {
        return { status: "not_due" as const, effectiveAt: loaded.effectiveAt };
      }
      if (loaded.lifecycle === "scheduled" && wake === "missed") {
        const [missed] = await tx
          .update(schedule)
          .set({
            lifecycle: "missed_requires_confirmation",
            updatedAt: input.now,
            version: loaded.version + 1,
          })
          .where(
            and(
              inWorkspace(schedule, workspaceId),
              eq(schedule.id, loaded.id),
              eq(schedule.version, loaded.version),
              eq(schedule.lifecycle, "scheduled"),
            ),
          )
          .returning();
        if (!missed) return { status: "busy" as const };
        const [missedOperation] = await tx
          .update(operation)
          .set({
            claimedAt: null,
            claimedBy: null,
            leaseExpiresAt: null,
            lifecycle: "failed",
            updatedAt: input.now,
            version: current.operation.version + 1,
          })
          .where(
            and(
              inWorkspace(operation, workspaceId),
              eq(operation.id, input.operationId),
              eq(operation.lifecycle, current.operation.lifecycle),
              eq(operation.version, current.operation.version),
            ),
          )
          .returning();
        if (!missedOperation) {
          throw new Error("missed schedule operation settlement lost");
        }
        const missedActivity = await appendActivityEvent(tx, workspaceId, {
          actorId: current.operation.actor,
          eventType: "schedule.missed",
          idempotencyKey: `schedule-missed:${loaded.id}`,
          requestHash: `schedule-missed:${loaded.id}:${loaded.version}`,
          scheduleId: loaded.id,
          publicationId: current.publication.id,
          operationId: input.operationId,
          occurredAt: input.now,
        });
        if (missedActivity.status === "mismatch") {
          throw new Error("missed schedule activity identity mismatch");
        }
        return {
          status: "missed" as const,
          operation: missedOperation,
          schedule: missed,
        };
      }
      if (
        loaded.lifecycle !== "scheduled" &&
        loaded.lifecycle !== "effect_claimed"
      ) {
        return { status: "terminal" as const, operation: current.operation };
      }
      if (
        loaded.claimedBy !== null &&
        loaded.claimedBy !== input.claimedBy &&
        loaded.leaseExpiresAt !== null &&
        loaded.leaseExpiresAt > input.now
      ) {
        return { status: "busy" as const };
      }
    }

    if (
      current.operation.claimedBy !== null &&
      current.operation.claimedBy !== input.claimedBy &&
      current.operation.leaseExpiresAt !== null &&
      current.operation.leaseExpiresAt > input.now
    ) {
      return { status: "busy" as const };
    }
    const [claimedOperation] = await tx
      .update(operation)
      .set({
        claimedAt: input.now,
        claimedBy: input.claimedBy,
        leaseExpiresAt: input.leaseExpiresAt,
        lifecycle: "running",
        updatedAt: input.now,
        version: current.operation.version + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, current.operation.version),
          or(
            isNull(operation.claimedBy),
            eq(operation.claimedBy, input.claimedBy),
            lte(operation.leaseExpiresAt, input.now),
          ),
        ),
      )
      .returning();
    if (!claimedOperation) return { status: "busy" as const };

    if (currentSchedule) {
      const [claimedSchedule] = await tx
        .update(schedule)
        .set({
          claimedAt: input.now,
          claimedBy: input.claimedBy,
          leaseExpiresAt: input.leaseExpiresAt,
          lifecycle: "effect_claimed",
          updatedAt: input.now,
          version: currentSchedule.version + 1,
        })
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, currentSchedule.id),
            eq(schedule.version, currentSchedule.version),
            or(
              isNull(schedule.claimedBy),
              eq(schedule.claimedBy, input.claimedBy),
              lte(schedule.leaseExpiresAt, input.now),
            ),
          ),
        )
        .returning();
      if (!claimedSchedule) throw new Error("SCHEDULE_CLAIM_LOST");
    }

    if (current.publication.lifecycle === "reserved") {
      const [claimedPublication] = await tx
        .update(publication)
        .set({
          activeOperationId: input.operationId,
          lifecycle: "effect_claimed",
          updatedAt: input.now,
          version: current.publication.version + 1,
        })
        .where(
          and(
            inWorkspace(publication, workspaceId),
            eq(publication.id, input.publicationId),
            eq(publication.version, current.publication.version),
            eq(publication.lifecycle, "reserved"),
          ),
        )
        .returning();
      if (!claimedPublication) throw new Error("PUBLICATION_CLAIM_LOST");
    } else if (
      current.publication.lifecycle !== "effect_claimed" ||
      current.publication.activeOperationId !== input.operationId
    ) {
      throw new Error("PUBLICATION_SLOT_UNAVAILABLE");
    }

    return {
      status: "claimed" as const,
      operation: claimedOperation,
      scheduleId: currentSchedule?.id ?? null,
    };
  });
}

export async function loadPublicationExecutionContext(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      operation,
      publishOperation,
      publication,
      destination: destinationAccount,
      draft: draftRevision,
      platformDraft,
      mapping: mediaBrandDestinationAccount,
      media: mediaAsset,
      sourceRevision: sourceItemRevision,
      sourceItem,
      schedule,
    })
    .from(publishOperation)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, publishOperation.operationId),
      ),
    )
    .innerJoin(
      publication,
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, publishOperation.publicationId),
      ),
    )
    .innerJoin(
      destinationAccount,
      and(
        inWorkspace(destinationAccount, workspaceId),
        eq(destinationAccount.id, publishOperation.destinationAccountId),
      ),
    )
    .innerJoin(
      draftRevision,
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, publishOperation.draftRevisionId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, draftRevision.platformDraftId),
      ),
    )
    .innerJoin(
      mediaBrandDestinationAccount,
      and(
        inWorkspace(mediaBrandDestinationAccount, workspaceId),
        eq(
          mediaBrandDestinationAccount.mediaBrandId,
          platformDraft.mediaBrandId,
        ),
        eq(
          mediaBrandDestinationAccount.destinationAccountId,
          destinationAccount.id,
        ),
      ),
    )
    .leftJoin(
      mediaAsset,
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, publishOperation.selectedFinalMediaAssetId),
      ),
    )
    .leftJoin(
      copyVariant,
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, draftRevision.originatingCopyVariantId),
      ),
    )
    .leftJoin(
      copyGenerationUnit,
      and(
        inWorkspace(copyGenerationUnit, workspaceId),
        eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
      ),
    )
    .leftJoin(
      copyGeneration,
      and(
        inWorkspace(copyGeneration, workspaceId),
        eq(copyGeneration.operationId, copyGenerationUnit.copyGenerationId),
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
    .leftJoin(
      schedule,
      and(
        inWorkspace(schedule, workspaceId),
        eq(schedule.id, publishOperation.scheduleId),
      ),
    )
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
      ),
    );
  if (!row) return null;

  const [control] = await executor
    .select({ paused: publishingControl.paused })
    .from(publishingControl)
    .where(eq(publishingControl.workspaceId, workspaceId));
  const attempts = await executor
    .select()
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.operationId, operationId),
      ),
    )
    .orderBy(desc(operationAttempt.attemptNumber));
  const checkpoints = await executor
    .select()
    .from(publishCheckpoint)
    .where(
      and(
        inWorkspace(publishCheckpoint, workspaceId),
        eq(publishCheckpoint.operationId, operationId),
      ),
    )
    .orderBy(desc(publishCheckpoint.observedAt));
  return { ...row, attempts, checkpoints, paused: control?.paused ?? false };
}

export async function loadPublicationReconciliationContext(
  executor: Executor,
  workspaceId: string,
  publicationId: string,
) {
  const [current] = await executor
    .select({
      activeOperationId: publication.activeOperationId,
      lifecycle: publication.lifecycle,
      unresolvedAttemptId: publication.unresolvedAttemptId,
      version: publication.version,
    })
    .from(publication)
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, publicationId),
      ),
    );
  if (!current?.activeOperationId) return null;
  const execution = await loadPublicationExecutionContext(
    executor,
    workspaceId,
    current.activeOperationId,
  );
  return execution ? { current, execution } : null;
}

export async function reassertPublicationExecution(
  executor: Executor,
  workspaceId: string,
  input: { operationId: string; claimedBy: string; now: Date },
) {
  const context = await loadPublicationExecutionContext(
    executor,
    workspaceId,
    input.operationId,
  );
  if (!context) return { status: "not_found" as const };
  const actionable = await readActionableApproval(
    executor,
    workspaceId,
    context.publication.approvalId,
  );
  if (
    !actionable ||
    actionable.approval.draftRevisionId !==
      context.publishOperation.draftRevisionId ||
    actionable.approval.selectedFinalMediaAssetId !==
      context.publishOperation.selectedFinalMediaAssetId ||
    context.paused ||
    context.operation.lifecycle !== "running" ||
    context.operation.claimedBy !== input.claimedBy ||
    !context.operation.leaseExpiresAt ||
    context.operation.leaseExpiresAt <= input.now ||
    context.publication.lifecycle !== "effect_claimed" ||
    context.publication.activeOperationId !== input.operationId ||
    !context.destination.enabled ||
    context.destination.deletedAt !== null ||
    context.destination.bindingPresent !== true ||
    context.destination.platform !== context.publishOperation.platform ||
    context.mapping.deletedAt !== null ||
    context.platformDraft.deletedAt !== null ||
    (ownsScheduleEffect(context.publishOperation.commandKind) &&
      (context.schedule === null ||
        context.schedule.lifecycle !== "effect_claimed" ||
        context.schedule.claimedBy !== input.claimedBy ||
        !context.schedule.leaseExpiresAt ||
        context.schedule.leaseExpiresAt <= input.now)) ||
    (context.publishOperation.selectedFinalMediaAssetId !== null &&
      (context.media?.lifecycle !== "verified" ||
        context.media.objectRemovedAt !== null ||
        context.media.actualBytes === null))
  ) {
    return { status: "rejected" as const };
  }
  return { status: "ready" as const, context };
}

export async function beginOrResumePublicationAttempt(
  executor: Executor,
  workspaceId: string,
  input: { operationId: string; claimedBy: string; now: Date },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [claimed] = await tx
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, input.now),
        ),
      )
      .for("update");
    if (!claimed) return null;
    const [latest] = await tx
      .select()
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
        ),
      )
      .orderBy(desc(operationAttempt.attemptNumber))
      .limit(1);
    if (latest?.outcome === null) {
      return {
        id: latest.id,
        number: latest.attemptNumber,
        resumed: true,
      };
    }
    if (latest && latest.outcome !== "failed_retryable") return null;
    const attempt = await allocateOperationAttemptInTransaction(
      tx,
      workspaceId,
      input.operationId,
    );
    return attempt
      ? { id: attempt.id, number: attempt.attemptNumber, resumed: false }
      : null;
  });
}

export async function claimPublicationFinalEffect(
  executor: Executor,
  workspaceId: string,
  input: { operationId: string; attemptId: string; claimedBy: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const now = new Date();
    const [claimedOperation] = await tx
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, now),
        ),
      )
      .for("update");
    if (!claimedOperation) return { status: "not_found" as const };
    const [started] = await tx
      .update(operationAttempt)
      .set({ finalEffectStartedAt: now, updatedAt: now })
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.attemptId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
          isNull(operationAttempt.finalEffectStartedAt),
        ),
      )
      .returning({ startedAt: operationAttempt.finalEffectStartedAt });
    if (started?.startedAt) {
      return { status: "claimed" as const, startedAt: started.startedAt };
    }
    const [existing] = await tx
      .select({ startedAt: operationAttempt.finalEffectStartedAt })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.attemptId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
        ),
      );
    return existing?.startedAt
      ? { status: "already_started" as const, startedAt: existing.startedAt }
      : { status: "not_found" as const };
  });
}

export async function renewPublicationExecutionLease(
  executor: Executor,
  workspaceId: string,
  input: {
    operationId: string;
    claimedBy: string;
    expectedVersion: number;
    now: Date;
    leaseExpiresAt: Date;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [owned] = await tx
      .select({
        commandKind: publishOperation.commandKind,
        scheduleId: publishOperation.scheduleId,
      })
      .from(publishOperation)
      .where(
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, input.operationId),
        ),
      );
    if (!owned) return null;
    const controlsSchedule = ownsScheduleEffect(owned.commandKind);
    if (controlsSchedule && !owned.scheduleId) return null;
    const [currentSchedule] =
      controlsSchedule && owned.scheduleId
        ? await tx
            .select({ id: schedule.id, version: schedule.version })
            .from(schedule)
            .where(
              and(
                inWorkspace(schedule, workspaceId),
                eq(schedule.id, owned.scheduleId),
                eq(schedule.claimedBy, input.claimedBy),
                eq(schedule.lifecycle, "effect_claimed"),
                gt(schedule.leaseExpiresAt, input.now),
              ),
            )
            .for("update")
        : [null];
    if (controlsSchedule && !currentSchedule) return null;
    const [renewed] = await tx
      .update(operation)
      .set({
        leaseExpiresAt: input.leaseExpiresAt,
        updatedAt: input.now,
        version: input.expectedVersion + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, input.expectedVersion),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, input.now),
        ),
      )
      .returning();
    if (!renewed) return null;
    if (currentSchedule) {
      const [renewedSchedule] = await tx
        .update(schedule)
        .set({
          leaseExpiresAt: input.leaseExpiresAt,
          updatedAt: input.now,
          version: currentSchedule.version + 1,
        })
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, currentSchedule.id),
            eq(schedule.version, currentSchedule.version),
            eq(schedule.claimedBy, input.claimedBy),
            eq(schedule.lifecycle, "effect_claimed"),
          ),
        )
        .returning({ id: schedule.id });
      if (!renewedSchedule) throw new Error("SCHEDULE_RENEW_FENCE_LOST");
    }
    return renewed;
  });
}

export async function recordPublicationCheckpoint(
  executor: Executor,
  workspaceId: string,
  input: {
    publicationId: string;
    operationId: string;
    attemptId: string;
    platform: "telegram" | "x" | "instagram";
    kind:
      | "telegram_message"
      | "x_media"
      | "x_post"
      | "instagram_grant"
      | "instagram_container"
      | "instagram_media";
    providerReferenceId: string;
  },
) {
  const [created] = await executor
    .insert(publishCheckpoint)
    .values({
      workspaceId,
      publicationId: input.publicationId,
      operationId: input.operationId,
      operationAttemptId: input.attemptId,
      platform: input.platform,
      kind: input.kind,
      providerReferenceId: input.providerReferenceId,
    })
    .onConflictDoNothing({
      target: [
        publishCheckpoint.workspaceId,
        publishCheckpoint.operationAttemptId,
        publishCheckpoint.kind,
      ],
    })
    .returning();
  if (created) return { status: "created" as const, checkpoint: created };
  const [existing] = await executor
    .select()
    .from(publishCheckpoint)
    .where(
      and(
        inWorkspace(publishCheckpoint, workspaceId),
        eq(publishCheckpoint.operationAttemptId, input.attemptId),
        eq(publishCheckpoint.kind, input.kind),
      ),
    );
  return existing?.providerReferenceId === input.providerReferenceId
    ? { status: "replayed" as const, checkpoint: existing }
    : { status: "mismatch" as const };
}

export async function enqueueStrandedPublicationRecoveries(
  executor: Executor,
  workspaceId: string,
  now: Date,
  limit = 5,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const siblingOutboxEvent = alias(outboxEvent, "sibling_outbox_event");
    const queuedRecoveryCutoff = new Date(
      now.getTime() - PUBLISHING_QUEUED_RECOVERY_GRACE_MS,
    );
    const queuedEvents = await tx
      .select({
        operationId: operation.id,
        publicationId: publication.id,
        scheduleId: schedule.id,
      })
      .from(outboxEvent)
      .innerJoin(
        operation,
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, outboxEvent.operationId),
          eq(operation.lifecycle, "queued"),
        ),
      )
      .innerJoin(
        publishOperation,
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, operation.id),
        ),
      )
      .innerJoin(
        schedule,
        and(
          inWorkspace(schedule, workspaceId),
          eq(schedule.id, publishOperation.scheduleId),
          lte(schedule.effectiveAt, queuedRecoveryCutoff),
        ),
      )
      .innerJoin(
        publication,
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, publishOperation.publicationId),
        ),
      )
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          eq(outboxEvent.eventType, OPERATION_PUBLICATION_REQUESTED_EVENT_NAME),
          isNotNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
          lte(outboxEvent.dispatchedAt, queuedRecoveryCutoff),
          or(
            and(
              eq(publishOperation.commandKind, "scheduled"),
              eq(schedule.lifecycle, "scheduled"),
              eq(publication.lifecycle, "reserved"),
              eq(publication.reservedScheduleId, schedule.id),
            ),
            and(
              eq(publishOperation.commandKind, "missed_recovery"),
              eq(schedule.lifecycle, "missed_requires_confirmation"),
              eq(publication.lifecycle, "effect_claimed"),
              eq(publication.activeOperationId, operation.id),
            ),
          ),
          notExists(
            tx
              .select({ id: siblingOutboxEvent.id })
              .from(siblingOutboxEvent)
              .where(
                and(
                  inWorkspace(siblingOutboxEvent, workspaceId),
                  eq(siblingOutboxEvent.operationId, outboxEvent.operationId),
                  eq(
                    siblingOutboxEvent.eventType,
                    OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
                  ),
                  ne(siblingOutboxEvent.id, outboxEvent.id),
                ),
              ),
          ),
        ),
      )
      .orderBy(schedule.effectiveAt, outboxEvent.id)
      .limit(limit)
      .for("update", { skipLocked: true });
    const queuedRecoveries =
      queuedEvents.length === 0
        ? []
        : await tx
            .insert(outboxEvent)
            .values(
              queuedEvents.map((entry) => ({
                workspaceId,
                operationId: entry.operationId,
                eventType: OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
                schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
                payload: {
                  schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
                  workspaceId,
                  operationId: entry.operationId,
                  publicationId: entry.publicationId,
                  scheduleId: entry.scheduleId,
                },
              })),
            )
            .returning();
    const remaining = limit - queuedRecoveries.length;
    if (remaining === 0) return queuedRecoveries;
    const pending = tx
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          eq(outboxEvent.operationId, operation.id),
          eq(outboxEvent.eventType, OPERATION_PUBLICATION_REQUESTED_EVENT_NAME),
          isNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
        ),
      );
    const stranded = await tx
      .select({
        operationId: operation.id,
        publicationId: publication.id,
        commandKind: publishOperation.commandKind,
        scheduleId: publishOperation.scheduleId,
      })
      .from(operation)
      .innerJoin(
        publishOperation,
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, operation.id),
        ),
      )
      .innerJoin(
        publication,
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, publishOperation.publicationId),
          eq(publication.lifecycle, "effect_claimed"),
          eq(publication.activeOperationId, operation.id),
        ),
      )
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.lifecycle, "running"),
          lte(operation.leaseExpiresAt, now),
          notExists(pending),
        ),
      )
      .orderBy(operation.leaseExpiresAt)
      .limit(remaining)
      .for("update", { skipLocked: true });
    if (stranded.length === 0) return queuedRecoveries;
    const inserted = await tx
      .insert(outboxEvent)
      .values(
        stranded.map((entry) => ({
          workspaceId,
          operationId: entry.operationId,
          eventType: OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          payload: {
            schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
            workspaceId,
            operationId: entry.operationId,
            publicationId: entry.publicationId,
            ...(entry.scheduleId ? { scheduleId: entry.scheduleId } : {}),
          },
        })),
      )
      .returning();
    return [...queuedRecoveries, ...inserted];
  });
}

export async function readPublicationExecutionSummary(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [current] = await executor
    .select({
      attemptCount: operation.attemptSeq,
      operationId: operation.id,
      operationLifecycle: operation.lifecycle,
      operationVersion: operation.version,
      publicationId: publication.id,
      publicationLifecycle: publication.lifecycle,
      scheduleId: publishOperation.scheduleId,
    })
    .from(publishOperation)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, publishOperation.operationId),
      ),
    )
    .innerJoin(
      publication,
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, publishOperation.publicationId),
      ),
    )
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
      ),
    );
  if (!current) return null;
  const [latestAttempt] = await executor
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.operationId, operationId),
      ),
    )
    .orderBy(desc(operationAttempt.attemptNumber))
    .limit(1);
  return {
    ...current,
    latestAttemptOutcome: latestAttempt?.outcome ?? null,
  };
}

export async function readPendingPublicationFollowUps(
  executor: Executor,
  workspaceId: string,
  retryBefore: Date,
  limit = 25,
) {
  const rows = await executor
    .select({
      actorId: operation.actor,
      cacheNotificationCompletedAt:
        publishOperation.cacheNotificationCompletedAt,
      operationId: operation.id,
      operationLifecycle: operation.lifecycle,
      publicationId: publishOperation.publicationId,
      scheduleId: publishOperation.scheduleId,
      settlementActivityStatus: publishOperation.settlementActivityStatus,
    })
    .from(publishOperation)
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, publishOperation.operationId),
      ),
    )
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        inArray(operation.lifecycle, ["succeeded", "failed", "unknown"]),
        lte(publishOperation.updatedAt, retryBefore),
        or(
          inArray(publishOperation.settlementActivityStatus, [
            "pending",
            "failed",
          ]),
          isNull(publishOperation.cacheNotificationCompletedAt),
        ),
      ),
    )
    .orderBy(asc(publishOperation.updatedAt), asc(publishOperation.operationId))
    .limit(limit);
  return rows.map((row) => ({
    actorId: row.actorId,
    activityEventType:
      row.operationLifecycle === "succeeded"
        ? ("publication.confirmed" as const)
        : row.operationLifecycle === "unknown"
          ? ("publication.delivery_unknown" as const)
          : ("publication.failed" as const),
    cacheNotificationDue: row.cacheNotificationCompletedAt === null,
    operationId: row.operationId,
    publicationId: row.publicationId,
    scheduleId: row.scheduleId,
    settlementActivityStatus: row.settlementActivityStatus,
  }));
}

export async function markPublicationCacheNotificationCompleted(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  completedAt: Date,
) {
  const [updated] = await executor
    .update(publishOperation)
    .set({ cacheNotificationCompletedAt: completedAt, updatedAt: completedAt })
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
        isNull(publishOperation.cacheNotificationCompletedAt),
      ),
    )
    .returning({ operationId: publishOperation.operationId });
  return updated ?? null;
}

export async function deferPublicationCacheNotification(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  attemptedAt: Date,
) {
  const [updated] = await executor
    .update(publishOperation)
    .set({ updatedAt: attemptedAt })
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
        isNull(publishOperation.cacheNotificationCompletedAt),
      ),
    )
    .returning({ operationId: publishOperation.operationId });
  return updated ?? null;
}

type PublicationSettlementInput = {
  publicationId: string;
  operationId: string;
  claimedBy: string;
  expectedOperationVersion: number;
} & (
  | {
      outcome: "confirmed";
      attemptId: string;
      checkpoint: {
        kind: "telegram_message" | "x_post" | "instagram_media";
        platform: "telegram" | "x" | "instagram";
        providerReferenceId: string;
      };
      providerResultId: string;
    }
  | {
      outcome: "delivery_unknown";
      attemptId: string;
      failureCode: PublicationFailureCode;
    }
  | {
      outcome: "definite_failure";
      attemptId: string | null;
      failureCode: PublicationFailureCode;
    }
  | {
      outcome: "deferred";
      attemptId: string;
      failureCode: PublicationFailureCode;
      resumeAt: Date;
    }
);

export async function settlePublicationExecution(
  executor: Executor,
  workspaceId: string,
  input: PublicationSettlementInput,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    return settlePublicationExecutionInTransaction(tx, workspaceId, input);
  });
}

export async function settleTimedOutPublicationExecution(
  executor: Executor,
  workspaceId: string,
  input: {
    publicationId: string;
    operationId: string;
    claimedBy: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [currentOperation] = await tx
      .select({ version: operation.version })
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.lifecycle, "running"),
        ),
      );
    if (!currentOperation) return { status: "already_settled" as const };
    const [latestAttempt] = await tx
      .select()
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.operationId, input.operationId),
        ),
      )
      .orderBy(desc(operationAttempt.attemptNumber))
      .limit(1);
    if (latestAttempt?.outcome !== null && latestAttempt !== undefined) {
      return { status: "already_settled" as const };
    }
    const outcome = latestAttempt?.finalEffectStartedAt
      ? "delivery_unknown"
      : "definite_failure";
    const base = {
      claimedBy: input.claimedBy,
      expectedOperationVersion: currentOperation.version,
      operationId: input.operationId,
      publicationId: input.publicationId,
    };
    const settled = latestAttempt?.finalEffectStartedAt
      ? await settlePublicationExecutionInTransaction(tx, workspaceId, {
          ...base,
          outcome: "delivery_unknown",
          attemptId: latestAttempt.id,
          failureCode: "DELIVERY_UNKNOWN",
        })
      : await settlePublicationExecutionInTransaction(tx, workspaceId, {
          ...base,
          outcome: "definite_failure",
          attemptId: latestAttempt?.id ?? null,
          failureCode: "DELIVERY_DEFINITELY_FAILED",
        });
    return settled
      ? {
          status: outcome,
          attemptCount: settled.operation.attemptSeq,
          operationLifecycle: settled.operation.lifecycle,
          operationVersion: settled.operation.version,
        }
      : { status: "already_settled" as const };
  });
}

export async function requestPublicationReconciliation(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    publicationId: string;
    ambiguousAttemptId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
    requestId: string | null;
  },
): Promise<PublicationAdmissionResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const commandType = "publishing:reconciliation";
    const replay = await readOperationIdentity(tx, workspaceId, {
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
    });
    const [current] = await tx
      .select()
      .from(publication)
      .where(
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, input.publicationId),
        ),
      )
      .for("update");
    if (!current) return { status: "approval_required" };
    if (replay) {
      return replay.requestHash === input.requestHash
        ? { status: "replayed", operationId: replay.id, publication: current }
        : { status: "idempotency_mismatch" };
    }
    if (
      !(await readLiveDraftRevisionOrigin(
        tx,
        workspaceId,
        input.actorId,
        current.draftRevisionId,
      ))
    ) {
      return { status: "not_found" };
    }
    if (
      current.lifecycle !== "delivery_unknown" ||
      current.unresolvedAttemptId !== input.ambiguousAttemptId
    ) {
      return { status: "publication_reconciliation_required" };
    }
    if (current.version !== input.expectedVersion) {
      return { status: "version_conflict" };
    }
    if (current.platform === "telegram") {
      return { status: "telegram_attestation_required" };
    }
    const operationId = randomUUID();
    await insertOperationIdentity(tx, workspaceId, {
      operationId,
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
    });
    await tx.insert(outboxEvent).values({
      workspaceId,
      operationId,
      eventType: OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        operationId,
        publicationId: current.id,
        ambiguousAttemptId: input.ambiguousAttemptId,
      },
    });
    return { status: "created", operationId, publication: current };
  });
}

export async function recordPublicationReconciliation(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId?: string | null;
    authority: ReconciliationAuthority;
    publicationId: string;
    ambiguousAttemptId: string;
    expectedVersion: number;
    decision: ReconciliationDecision;
    evidenceCheckpointId?: string | null;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [existing] = await tx
      .select()
      .from(publicationReconciliation)
      .where(
        and(
          inWorkspace(publicationReconciliation, workspaceId),
          input.actorId
            ? eq(publicationReconciliation.actorId, input.actorId)
            : isNull(publicationReconciliation.actorId),
          eq(publicationReconciliation.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.requestHash !== input.requestHash) {
        return { status: "idempotency_mismatch" as const };
      }
      const [current] = await tx
        .select()
        .from(publication)
        .where(
          and(
            inWorkspace(publication, workspaceId),
            eq(publication.id, existing.publicationId),
          ),
        );
      if (!current)
        throw new Error("reconciliation replay publication missing");
      return {
        status: "replayed" as const,
        reconciliation: existing,
        publication: current,
      };
    }
    if (
      (input.authority === "provider" &&
        (!input.evidenceCheckpointId || input.actorId)) ||
      (input.authority === "operator" &&
        (!input.actorId || input.evidenceCheckpointId))
    ) {
      return { status: "evidence_insufficient" as const };
    }
    const [target] = await tx
      .select({
        activeOperationId: publication.activeOperationId,
        commandKind: publishOperation.commandKind,
        scheduleId: publishOperation.scheduleId,
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
          eq(publication.id, input.publicationId),
          eq(publication.version, input.expectedVersion),
        ),
      );
    if (!target) return { status: "version_conflict" as const };
    const controlsSchedule = ownsScheduleEffect(target.commandKind);
    const [lockedSchedule] =
      controlsSchedule && target.scheduleId
        ? await tx
            .select({ id: schedule.id })
            .from(schedule)
            .where(
              and(
                inWorkspace(schedule, workspaceId),
                eq(schedule.id, target.scheduleId),
              ),
            )
            .for("update")
        : [null];
    if (controlsSchedule && (!target.scheduleId || !lockedSchedule)) {
      return { status: "version_conflict" as const };
    }
    const [current] = await tx
      .select()
      .from(publication)
      .where(
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, input.publicationId),
          eq(publication.version, input.expectedVersion),
        ),
      )
      .for("update");
    if (
      current?.lifecycle !== "delivery_unknown" ||
      current.unresolvedAttemptId !== input.ambiguousAttemptId ||
      current.activeOperationId !== target.activeOperationId
    ) {
      return { status: "version_conflict" as const };
    }
    if (
      input.actorId &&
      !(await readLiveDraftRevisionOrigin(
        tx,
        workspaceId,
        input.actorId,
        current.draftRevisionId,
      ))
    ) {
      return { status: "not_found" as const };
    }
    if (
      (input.authority === "provider" && current.platform === "telegram") ||
      (input.authority === "operator" && current.platform !== "telegram")
    ) {
      return {
        status:
          current.platform === "telegram"
            ? ("telegram_attestation_required" as const)
            : ("evidence_insufficient" as const),
      };
    }
    if (!current.activeOperationId) {
      return { status: "evidence_insufficient" as const };
    }
    const [ambiguousAttempt] = await tx
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.ambiguousAttemptId),
          eq(operationAttempt.operationId, current.activeOperationId),
        ),
      );
    if (!ambiguousAttempt) {
      return { status: "evidence_insufficient" as const };
    }
    let providerResultId: string | null = null;
    if (input.evidenceCheckpointId) {
      const [evidence] = await tx
        .select({
          evidenceAuthority: publishCheckpoint.evidenceAuthority,
          id: publishCheckpoint.id,
          platform: publishCheckpoint.platform,
          providerReferenceId: publishCheckpoint.providerReferenceId,
        })
        .from(publishCheckpoint)
        .where(
          and(
            inWorkspace(publishCheckpoint, workspaceId),
            eq(publishCheckpoint.id, input.evidenceCheckpointId),
            eq(publishCheckpoint.publicationId, input.publicationId),
            eq(publishCheckpoint.operationAttemptId, input.ambiguousAttemptId),
          ),
        );
      if (
        evidence?.evidenceAuthority !== "provider" ||
        evidence.platform !== current.platform
      ) {
        return { status: "evidence_insufficient" as const };
      }
      providerResultId = evidence.providerReferenceId;
    }
    const [fact] = await tx
      .insert(publicationReconciliation)
      .values({
        workspaceId,
        publicationId: input.publicationId,
        ambiguousAttemptId: input.ambiguousAttemptId,
        actorId: input.actorId,
        authority: input.authority,
        decision: input.decision,
        evidenceCheckpointId: input.evidenceCheckpointId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      })
      .returning();
    if (!fact) throw new Error("reconciliation insert returned no row");
    const now = new Date();
    const [settled] = await tx
      .update(publication)
      .set(
        input.decision === "delivered"
          ? {
              lifecycle: "confirmed",
              unresolvedAttemptId: null,
              confirmedCheckpointId: input.evidenceCheckpointId,
              confirmedProviderResultId: providerResultId,
              confirmedAt: now,
              version: current.version + 1,
              updatedAt: now,
            }
          : {
              lifecycle: "available",
              activeOperationId: null,
              reservedScheduleId: null,
              unresolvedAttemptId: null,
              version: current.version + 1,
              updatedAt: now,
            },
      )
      .where(
        and(
          inWorkspace(publication, workspaceId),
          eq(publication.id, current.id),
          eq(publication.version, current.version),
          eq(publication.lifecycle, "delivery_unknown"),
        ),
      )
      .returning();
    if (!settled) throw new Error("reconciliation lost publication fence");
    const settledSchedule = await settleScheduleForOperation(
      tx,
      workspaceId,
      current.activeOperationId,
      input.decision === "delivered" ? "completed" : "failed",
      "delivery_unknown",
    );
    if (controlsSchedule && !settledSchedule) {
      throw new Error("reconciliation lost schedule fence");
    }
    await tx
      .update(publishOperation)
      .set({ cacheNotificationCompletedAt: null, updatedAt: now })
      .where(
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, current.activeOperationId),
        ),
      );
    const eventType =
      input.authority === "operator"
        ? input.decision === "delivered"
          ? ("publication.telegram_attested_delivered" as const)
          : ("publication.telegram_attested_not_delivered" as const)
        : input.decision === "delivered"
          ? ("publication.reconciled_delivered" as const)
          : ("publication.reconciled_not_delivered" as const);
    const activity = await appendActivityEvent(tx, workspaceId, {
      actorId: input.actorId,
      eventType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      publicationId: current.id,
    });
    if (activity.status === "mismatch") {
      throw new Error("reconciliation activity identity mismatch");
    }
    return {
      status: "recorded" as const,
      reconciliation: fact,
      publication: settled,
    };
  });
}

export async function rearmSettlementActivity(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [updated] = await executor
    .update(publishOperation)
    .set({
      settlementActivityStatus: "pending",
      settlementActivityFailureCode: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
        eq(publishOperation.settlementActivityStatus, "failed"),
      ),
    )
    .returning();
  return updated ?? null;
}

export async function readPublicationCommandContext(
  executor: Executor,
  workspaceId: string,
  publicationId: string,
) {
  const [row] = await executor
    .select({
      publication,
      destinationAccountId: publishOperation.destinationAccountId,
    })
    .from(publication)
    .leftJoin(
      publishOperation,
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.publicationId, publication.id),
      ),
    )
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, publicationId),
      ),
    )
    .orderBy(sql`${publishOperation.createdAt} desc nulls last`)
    .limit(1);
  return row ?? null;
}

export async function markSettlementActivityFailed(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  failureCode: ErrorCode,
) {
  const [updated] = await executor
    .update(publishOperation)
    .set({
      settlementActivityStatus: "failed",
      settlementActivityFailureCode: failureCode,
      settlementActivityRecordedAt: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
        eq(publishOperation.settlementActivityStatus, "pending"),
      ),
    )
    .returning();
  return updated ?? null;
}

async function settleScheduleForOperation(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
  lifecycle: "completed" | "delivery_unknown" | "failed",
  fromLifecycle: "effect_claimed" | "delivery_unknown" = "effect_claimed",
) {
  const [owned] = await tx
    .select({
      commandKind: publishOperation.commandKind,
      scheduleId: publishOperation.scheduleId,
    })
    .from(publishOperation)
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, operationId),
      ),
    );
  if (!owned?.scheduleId || !ownsScheduleEffect(owned.commandKind)) return null;
  const [updated] = await tx
    .update(schedule)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle,
      updatedAt: new Date(),
      version: sql`${schedule.version} + 1`,
    })
    .where(
      and(
        inWorkspace(schedule, workspaceId),
        eq(schedule.id, owned.scheduleId),
        eq(schedule.lifecycle, fromLifecycle),
      ),
    )
    .returning();
  return updated ?? null;
}

async function settlePublicationExecutionInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: PublicationSettlementInput,
) {
  const [owned] = await tx
    .select()
    .from(publishOperation)
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, input.operationId),
        eq(publishOperation.publicationId, input.publicationId),
      ),
    );
  if (!owned) return null;

  const controlsSchedule = ownsScheduleEffect(owned.commandKind);
  if (controlsSchedule && !owned.scheduleId) return null;
  const [currentSchedule] =
    controlsSchedule && owned.scheduleId
      ? await tx
          .select()
          .from(schedule)
          .where(
            and(
              inWorkspace(schedule, workspaceId),
              eq(schedule.id, owned.scheduleId),
            ),
          )
          .for("update")
      : [null];
  if (controlsSchedule && !currentSchedule) return null;

  const [currentPublication] = await tx
    .select()
    .from(publication)
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, input.publicationId),
      ),
    )
    .for("update");
  const [currentOperation] = await tx
    .select()
    .from(operation)
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.operationId),
      ),
    )
    .for("update");
  if (
    !currentPublication ||
    !currentOperation ||
    currentPublication.lifecycle !== "effect_claimed" ||
    currentPublication.activeOperationId !== input.operationId ||
    currentOperation.lifecycle !== "running" ||
    currentOperation.claimedBy !== input.claimedBy ||
    currentOperation.version !== input.expectedOperationVersion ||
    (currentSchedule !== null &&
      (currentSchedule.lifecycle !== "effect_claimed" ||
        currentSchedule.claimedBy !== input.claimedBy))
  ) {
    return null;
  }

  const now = new Date();
  if (input.attemptId) {
    const [currentAttempt] = await tx
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.attemptId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
        ),
      )
      .for("update");
    if (!currentAttempt) return null;
  }
  let checkpoint: typeof publishCheckpoint.$inferSelect | null = null;
  if (input.outcome === "confirmed") {
    if (input.checkpoint.platform !== owned.platform) return null;
    const [created] = await tx
      .insert(publishCheckpoint)
      .values({
        workspaceId,
        publicationId: input.publicationId,
        operationId: input.operationId,
        operationAttemptId: input.attemptId,
        platform: input.checkpoint.platform,
        kind: input.checkpoint.kind,
        providerReferenceId: input.checkpoint.providerReferenceId,
      })
      .onConflictDoNothing({
        target: [
          publishCheckpoint.workspaceId,
          publishCheckpoint.operationAttemptId,
          publishCheckpoint.kind,
        ],
      })
      .returning();
    if (created) {
      checkpoint = created;
    } else {
      const [existing] = await tx
        .select()
        .from(publishCheckpoint)
        .where(
          and(
            inWorkspace(publishCheckpoint, workspaceId),
            eq(publishCheckpoint.operationAttemptId, input.attemptId),
            eq(publishCheckpoint.kind, input.checkpoint.kind),
          ),
        );
      if (
        !existing ||
        existing.publicationId !== input.publicationId ||
        existing.operationId !== input.operationId ||
        existing.platform !== input.checkpoint.platform ||
        existing.providerReferenceId !== input.checkpoint.providerReferenceId
      ) {
        return null;
      }
      checkpoint = existing;
    }
  }

  let settledAttempt: typeof operationAttempt.$inferSelect | null = null;
  if (input.attemptId) {
    const attemptValues =
      input.outcome === "confirmed"
        ? {
            failureCode: null,
            outcome: "succeeded" as const,
            providerFailureCode: null,
            providerResultId: input.providerResultId,
            updatedAt: now,
          }
        : input.outcome === "delivery_unknown"
          ? {
              failureCode: "INTERNAL_SERVER_ERROR" as const,
              outcome: "ambiguous" as const,
              providerFailureCode: input.failureCode,
              providerResultId: null,
              updatedAt: now,
            }
          : input.outcome === "deferred"
            ? {
                failureCode: "INTERNAL_SERVER_ERROR" as const,
                outcome: "failed_retryable" as const,
                providerFailureCode: input.failureCode,
                providerResultId: null,
                updatedAt: now,
              }
            : {
                failureCode: "INTERNAL_SERVER_ERROR" as const,
                outcome: "failed_terminal" as const,
                providerFailureCode: input.failureCode,
                providerResultId: null,
                updatedAt: now,
              };
    const [updatedAttempt] = await tx
      .update(operationAttempt)
      .set(attemptValues)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, input.attemptId),
          eq(operationAttempt.operationId, input.operationId),
          isNull(operationAttempt.outcome),
        ),
      )
      .returning();
    if (!updatedAttempt) {
      throw new Error("PUBLICATION_ATTEMPT_SETTLEMENT_LOST");
    }
    settledAttempt = updatedAttempt;
  }

  if (input.outcome === "deferred") {
    const [deferredOperation] = await tx
      .update(operation)
      .set({
        leaseExpiresAt: input.resumeAt,
        updatedAt: now,
        version: currentOperation.version + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, currentOperation.version),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.lifecycle, "running"),
        ),
      )
      .returning();
    if (!deferredOperation) throw new Error("PUBLICATION_DEFER_FENCE_LOST");
    if (currentSchedule) {
      const [deferredSchedule] = await tx
        .update(schedule)
        .set({
          leaseExpiresAt: input.resumeAt,
          updatedAt: now,
          version: currentSchedule.version + 1,
        })
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, currentSchedule.id),
            eq(schedule.version, currentSchedule.version),
            eq(schedule.claimedBy, input.claimedBy),
            eq(schedule.lifecycle, "effect_claimed"),
          ),
        )
        .returning();
      if (!deferredSchedule) throw new Error("SCHEDULE_DEFER_FENCE_LOST");
    }
    return {
      attempt: settledAttempt,
      checkpoint,
      operation: deferredOperation,
      publication: currentPublication,
    };
  }

  const publicationValues =
    input.outcome === "confirmed"
      ? {
          confirmedAt: now,
          confirmedCheckpointId: checkpoint?.id ?? null,
          confirmedProviderResultId: input.providerResultId,
          lifecycle: "confirmed" as const,
          unresolvedAttemptId: null,
          updatedAt: now,
          version: currentPublication.version + 1,
        }
      : input.outcome === "delivery_unknown"
        ? {
            lifecycle: "delivery_unknown" as const,
            unresolvedAttemptId: input.attemptId,
            updatedAt: now,
            version: currentPublication.version + 1,
          }
        : {
            activeOperationId: null,
            lifecycle: "available" as const,
            reservedScheduleId: null,
            unresolvedAttemptId: null,
            updatedAt: now,
            version: currentPublication.version + 1,
          };
  const [settledPublication] = await tx
    .update(publication)
    .set(publicationValues)
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.id, input.publicationId),
        eq(publication.version, currentPublication.version),
        eq(publication.lifecycle, "effect_claimed"),
        eq(publication.activeOperationId, input.operationId),
      ),
    )
    .returning();
  if (!settledPublication) throw new Error("PUBLICATION_SETTLEMENT_FENCE_LOST");

  if (currentSchedule) {
    const scheduleLifecycle =
      input.outcome === "confirmed"
        ? ("completed" as const)
        : input.outcome === "delivery_unknown"
          ? ("delivery_unknown" as const)
          : ("failed" as const);
    const [settledSchedule] = await tx
      .update(schedule)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: scheduleLifecycle,
        updatedAt: now,
        version: currentSchedule.version + 1,
      })
      .where(
        and(
          inWorkspace(schedule, workspaceId),
          eq(schedule.id, currentSchedule.id),
          eq(schedule.version, currentSchedule.version),
          eq(schedule.lifecycle, "effect_claimed"),
          eq(schedule.claimedBy, input.claimedBy),
        ),
      )
      .returning();
    if (!settledSchedule) throw new Error("SCHEDULE_SETTLEMENT_FENCE_LOST");
  }

  const operationLifecycle =
    input.outcome === "confirmed"
      ? ("succeeded" as const)
      : input.outcome === "delivery_unknown"
        ? ("unknown" as const)
        : ("failed" as const);
  const [settledOperation] = await tx
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle: operationLifecycle,
      updatedAt: now,
      version: currentOperation.version + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.operationId),
        eq(operation.version, currentOperation.version),
        eq(operation.claimedBy, input.claimedBy),
        eq(operation.lifecycle, "running"),
      ),
    )
    .returning();
  if (!settledOperation) throw new Error("OPERATION_SETTLEMENT_FENCE_LOST");

  const [armed] = await tx
    .update(publishOperation)
    .set({
      cacheNotificationCompletedAt: null,
      settlementActivityFailureCode: null,
      settlementActivityRecordedAt: null,
      settlementActivityStatus: "pending",
      updatedAt: now,
    })
    .where(
      and(
        inWorkspace(publishOperation, workspaceId),
        eq(publishOperation.operationId, input.operationId),
      ),
    )
    .returning({ operationId: publishOperation.operationId });
  if (!armed) throw new Error("PUBLICATION_FOLLOW_UP_ARM_LOST");
  return {
    attempt: settledAttempt,
    checkpoint,
    operation: settledOperation,
    publication: settledPublication,
  };
}

async function loadAdmissionContext(
  tx: Transaction,
  workspaceId: string,
  approvalId: string,
  destinationAccountId: string,
  expectedRevisionVersion: number | null,
  actorId: string,
) {
  const actionable = await readActionableApproval(tx, workspaceId, approvalId);
  if (!actionable) return null;
  if (expectedRevisionVersion !== null) {
    const [draft] = await tx
      .select({
        activeRevisionId: platformDraft.activeRevisionId,
        revisionVersion: platformDraft.revisionVersion,
      })
      .from(platformDraft)
      .where(
        and(
          liveInWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, actionable.platformDraftId),
          ownedDraftExists(workspaceId, actorId),
        ),
      )
      .for("update");
    if (!draft) return { status: "not_found" as const };
    if (
      draft.activeRevisionId !== actionable.approval.draftRevisionId ||
      draft.revisionVersion !== expectedRevisionVersion
    ) {
      return { status: "approval_snapshot_stale" as const };
    }
  } else {
    const [owned] = await tx
      .select({ id: platformDraft.id })
      .from(platformDraft)
      .where(
        and(
          liveInWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, actionable.platformDraftId),
          ownedDraftExists(workspaceId, actorId),
        ),
      );
    if (!owned) return { status: "not_found" as const };
  }
  const [control] = await tx
    .select({ paused: publishingControl.paused })
    .from(publishingControl)
    .where(eq(publishingControl.workspaceId, workspaceId));
  if (control?.paused) return { status: "publishing_paused" as const };
  const [destination] = await tx
    .select({
      id: destinationAccount.id,
      enabled: destinationAccount.enabled,
      bindingPresent: destinationAccount.bindingPresent,
      platform: destinationAccount.platform,
      mappingId: mediaBrandDestinationAccount.id,
    })
    .from(destinationAccount)
    .leftJoin(
      mediaBrandDestinationAccount,
      and(
        liveInWorkspace(mediaBrandDestinationAccount, workspaceId),
        eq(
          mediaBrandDestinationAccount.destinationAccountId,
          destinationAccount.id,
        ),
        eq(mediaBrandDestinationAccount.mediaBrandId, actionable.mediaBrandId),
      ),
    )
    .where(
      and(
        liveInWorkspace(destinationAccount, workspaceId),
        eq(destinationAccount.id, destinationAccountId),
      ),
    );
  if (!destination) return { status: "destination_not_mapped" as const };
  if (
    !destination.mappingId ||
    destination.platform !== actionable.approval.platform
  ) {
    return { status: "destination_not_mapped" as const };
  }
  if (!destination.enabled) return { status: "destination_disabled" as const };
  if (destination.bindingPresent !== true) {
    return { status: "destination_unbound" as const };
  }
  return {
    status: "ready" as const,
    approval: actionable.approval,
    platformDraftId: actionable.platformDraftId,
    mediaBrandId: actionable.mediaBrandId,
    destination,
  };
}

async function lockOrCreatePublication(
  tx: Transaction,
  workspaceId: string,
  context: AdmissionContext & { status: "ready" },
) {
  await tx
    .insert(publication)
    .values({
      workspaceId,
      approvalId: context.approval.id,
      draftRevisionId: context.approval.draftRevisionId,
      platform: context.approval.platform,
      selectedFinalMediaAssetId: context.approval.selectedFinalMediaAssetId,
    })
    .onConflictDoNothing({
      target: [
        publication.workspaceId,
        publication.draftRevisionId,
        publication.platform,
      ],
    });
  const [row] = await tx
    .select()
    .from(publication)
    .where(
      and(
        inWorkspace(publication, workspaceId),
        eq(publication.draftRevisionId, context.approval.draftRevisionId),
        eq(publication.platform, context.approval.platform),
      ),
    )
    .for("update");
  if (!row) throw new Error("publication slot insert returned no row");
  if (
    row.selectedFinalMediaAssetId !== context.approval.selectedFinalMediaAssetId
  ) {
    throw new Error("publication snapshot drifted");
  }
  return row;
}

function classifySlot(
  row: PublicationRow,
  scheduleId?: string | null,
  expectedVersion?: number,
): PublicationAdmissionFailure | null {
  if (expectedVersion !== undefined && row.version !== expectedVersion) {
    return "publication_already_claimed";
  }
  if (row.lifecycle === "confirmed") return "publication_already_confirmed";
  if (row.lifecycle === "delivery_unknown") {
    return "publication_reconciliation_required";
  }
  if (scheduleId) {
    return row.lifecycle === "reserved" && row.reservedScheduleId === scheduleId
      ? null
      : "publication_already_claimed";
  }
  return row.lifecycle === "available" ? null : "publication_already_claimed";
}
