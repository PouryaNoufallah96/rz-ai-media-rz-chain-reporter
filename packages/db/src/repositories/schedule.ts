import { randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { and, eq, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { activityEvent } from "../schema/activity-event";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { publishOperation } from "../schema/publish-operation";
import { schedule } from "../schema/schedule";
import { appendActivityEvent } from "./activity-event";
import { insertOperationIdentity, readOperationIdentity } from "./operation";
import {
  type PublicationAdmissionFailure,
  releaseReservedPublication,
  reservePublication,
  transferPublicationReservation,
} from "./publication";

type ScheduleRow = typeof schedule.$inferSelect;

type ScheduleFailure =
  | PublicationAdmissionFailure
  | "destination_disabled"
  | "destination_not_mapped"
  | "destination_unbound"
  | "idempotency_mismatch"
  | "not_found"
  | "publication_already_claimed"
  | "publication_already_confirmed"
  | "publication_reconciliation_required"
  | "publishing_paused"
  | "schedule_effect_already_started"
  | "schedule_in_past"
  | "version_conflict";

type ScheduleCommandResult =
  | {
      status: "created" | "updated" | "replayed";
      schedule: ScheduleRow;
      operationId?: string;
    }
  | { status: ScheduleFailure };

export async function createSchedule(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    approvalId: string;
    expectedRevisionVersion: number;
    destinationAccountId: string;
    scheduledAt: Date;
    timezone: string;
    idempotencyKey: string;
    requestHash: string;
    requestId: string | null;
    predecessorScheduleId?: string | null;
  },
): Promise<ScheduleCommandResult> {
  if (input.scheduledAt.getTime() <= Date.now()) {
    return { status: "schedule_in_past" };
  }
  return executor.transaction(async (tx): Promise<ScheduleCommandResult> => {
    await withWorkspaceContext(tx, workspaceId);
    const commandType = "publishing:scheduled";
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
        .select({ schedule })
        .from(schedule)
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.originatingOperationId, replay.id),
          ),
        );
      if (!existing) throw new Error("schedule replay is missing");
      return {
        status: "replayed",
        schedule: existing.schedule,
        operationId: replay.id,
      };
    }

    const scheduleId = randomUUID();
    const operationId = randomUUID();
    const reservation = await reservePublication(tx, workspaceId, {
      approvalId: input.approvalId,
      destinationAccountId: input.destinationAccountId,
      expectedRevisionVersion: input.expectedRevisionVersion,
      scheduleId,
    });
    if (reservation.status !== "reserved") {
      return { status: reservation.status };
    }
    await insertOperationIdentity(tx, workspaceId, {
      operationId,
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
    });
    const [created] = await tx
      .insert(schedule)
      .values({
        id: scheduleId,
        workspaceId,
        approvalId: reservation.admission.approval.id,
        publicationId: reservation.publication.id,
        draftRevisionId: reservation.admission.approval.draftRevisionId,
        platform: reservation.admission.approval.platform,
        selectedFinalMediaAssetId:
          reservation.admission.approval.selectedFinalMediaAssetId,
        destinationAccountId: input.destinationAccountId,
        originatingOperationId: operationId,
        predecessorScheduleId: input.predecessorScheduleId,
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
        effectiveAt: input.scheduledAt,
        createdBy: input.actorId,
      })
      .returning();
    if (!created) throw new Error("schedule insert returned no row");
    await tx.insert(publishOperation).values({
      operationId,
      workspaceId,
      publicationId: reservation.publication.id,
      destinationAccountId: input.destinationAccountId,
      platform: reservation.publication.platform,
      draftRevisionId: reservation.publication.draftRevisionId,
      selectedFinalMediaAssetId:
        reservation.publication.selectedFinalMediaAssetId,
      scheduleId: created.id,
      commandKind: "scheduled",
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
        publicationId: reservation.publication.id,
        scheduleId: created.id,
      },
    });
    const activity = await appendActivityEvent(tx, workspaceId, {
      actorId: input.actorId,
      eventType: "schedule.created",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      scheduleId: created.id,
      publicationId: created.publicationId,
      operationId,
    });
    if (activity.status === "mismatch") {
      throw new Error("schedule activity identity mismatch");
    }
    return { status: "created", schedule: created, operationId };
  });
}

export async function cancelSchedule(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    scheduleId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<ScheduleCommandResult> {
  return mutateScheduleIdentity(
    executor,
    workspaceId,
    input,
    "schedule.cancelled",
    async (tx, current) => {
      if (current.lifecycle !== "scheduled") {
        return {
          status:
            current.lifecycle === "effect_claimed"
              ? ("schedule_effect_already_started" as const)
              : ("version_conflict" as const),
        };
      }
      const now = new Date();
      const released = await releaseReservedPublication(
        tx,
        workspaceId,
        current.publicationId,
        current.id,
      );
      if (!released) {
        return { status: "schedule_effect_already_started" as const };
      }
      await settlePredecessorOperation(tx, workspaceId, current, now);
      const [updated] = await tx
        .update(schedule)
        .set({
          lifecycle: "cancelled",
          version: current.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, current.id),
            eq(schedule.version, current.version),
            eq(schedule.lifecycle, "scheduled"),
          ),
        )
        .returning();
      if (!updated) throw new Error("schedule cancellation lost");
      return { status: "updated" as const, schedule: updated };
    },
  );
}

export async function rescheduleSchedule(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    scheduleId: string;
    expectedVersion: number;
    scheduledAt: Date;
    timezone: string;
    idempotencyKey: string;
    requestHash: string;
    requestId: string | null;
  },
): Promise<ScheduleCommandResult> {
  if (input.scheduledAt.getTime() <= Date.now()) {
    return { status: "schedule_in_past" };
  }
  return executor.transaction(async (tx): Promise<ScheduleCommandResult> => {
    await withWorkspaceContext(tx, workspaceId);
    const commandType = "publishing:scheduled";
    const replay = await readOperationIdentity(tx, workspaceId, {
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
    });
    if (replay) {
      if (replay.requestHash !== input.requestHash) {
        return { status: "idempotency_mismatch" };
      }
      const [successor] = await tx
        .select()
        .from(schedule)
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.originatingOperationId, replay.id),
          ),
        );
      if (!successor) throw new Error("reschedule replay is missing");
      return {
        status: "replayed",
        schedule: successor,
        operationId: replay.id,
      };
    }
    const [current] = await tx
      .select()
      .from(schedule)
      .where(
        and(
          inWorkspace(schedule, workspaceId),
          eq(schedule.id, input.scheduleId),
          eq(schedule.version, input.expectedVersion),
        ),
      )
      .for("update");
    if (!current) return { status: "version_conflict" };
    if (
      current.lifecycle !== "scheduled" &&
      current.lifecycle !== "missed_requires_confirmation"
    ) {
      return { status: "schedule_effect_already_started" };
    }
    const successorId = randomUUID();
    const operationId = randomUUID();
    const transferred = await transferPublicationReservation(
      tx,
      workspaceId,
      current.publicationId,
      current.id,
      successorId,
    );
    if (!transferred) return { status: "schedule_effect_already_started" };
    const now = new Date();
    await settlePredecessorOperation(tx, workspaceId, current, now);
    await insertOperationIdentity(tx, workspaceId, {
      operationId,
      actor: input.actorId,
      commandType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
    });
    const [predecessor] = await tx
      .update(schedule)
      .set({
        lifecycle: "rescheduled",
        updatedAt: now,
        version: current.version + 1,
      })
      .where(
        and(
          inWorkspace(schedule, workspaceId),
          eq(schedule.id, current.id),
          eq(schedule.version, current.version),
        ),
      )
      .returning();
    if (!predecessor) throw new Error("schedule rescheduling lost");
    const [successor] = await tx
      .insert(schedule)
      .values({
        id: successorId,
        workspaceId,
        approvalId: current.approvalId,
        publicationId: current.publicationId,
        draftRevisionId: current.draftRevisionId,
        platform: current.platform,
        selectedFinalMediaAssetId: current.selectedFinalMediaAssetId,
        destinationAccountId: current.destinationAccountId,
        originatingOperationId: operationId,
        predecessorScheduleId: current.id,
        scheduledAt: input.scheduledAt,
        timezone: input.timezone,
        effectiveAt: input.scheduledAt,
        createdBy: input.actorId,
      })
      .returning();
    if (!successor)
      throw new Error("successor schedule insert returned no row");
    await tx.insert(publishOperation).values({
      operationId,
      workspaceId,
      publicationId: current.publicationId,
      destinationAccountId: current.destinationAccountId,
      platform: current.platform,
      draftRevisionId: current.draftRevisionId,
      selectedFinalMediaAssetId: current.selectedFinalMediaAssetId,
      scheduleId: successor.id,
      commandKind: "scheduled",
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
        publicationId: current.publicationId,
        scheduleId: successor.id,
      },
    });
    const activity = await appendActivityEvent(tx, workspaceId, {
      actorId: input.actorId,
      eventType: "schedule.rescheduled",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      scheduleId: current.id,
      publicationId: current.publicationId,
      operationId,
    });
    if (activity.status === "mismatch") {
      throw new Error("reschedule activity identity mismatch");
    }
    return { status: "created", schedule: successor, operationId };
  });
}

export async function readMissedSchedule(
  executor: Executor,
  workspaceId: string,
  scheduleId: string,
) {
  const [row] = await executor
    .select()
    .from(schedule)
    .where(
      and(inWorkspace(schedule, workspaceId), eq(schedule.id, scheduleId)),
    );
  return row ?? null;
}

async function settlePredecessorOperation(
  tx: Transaction,
  workspaceId: string,
  current: ScheduleRow,
  now: Date,
) {
  if (!current.originatingOperationId) {
    throw new Error("schedule predecessor operation is missing");
  }
  const [currentOperation] = await tx
    .select()
    .from(operation)
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, current.originatingOperationId),
      ),
    )
    .for("update");
  if (!currentOperation) {
    throw new Error("schedule predecessor operation is missing");
  }
  if (current.lifecycle === "missed_requires_confirmation") {
    if (
      currentOperation.lifecycle === "queued" ||
      currentOperation.lifecycle === "running" ||
      currentOperation.lifecycle === "settling"
    ) {
      throw new Error("missed schedule predecessor operation is not terminal");
    }
    return currentOperation;
  }
  const [cancelled] = await tx
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle: "cancelled",
      updatedAt: now,
      version: currentOperation.version + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, currentOperation.id),
        eq(operation.lifecycle, "queued"),
        eq(operation.version, currentOperation.version),
      ),
    )
    .returning();
  if (!cancelled) {
    throw new Error("schedule predecessor operation cancellation lost");
  }
  return cancelled;
}

async function mutateScheduleIdentity(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    scheduleId: string;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
  },
  eventType: "schedule.cancelled",
  mutate: (
    tx: Transaction,
    current: ScheduleRow,
  ) => Promise<ScheduleCommandResult>,
) {
  return executor.transaction(async (tx): Promise<ScheduleCommandResult> => {
    await withWorkspaceContext(tx, workspaceId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${input.actorId}:${eventType}:${input.idempotencyKey}`}, 0))`,
    );
    const activity = await appendActivityEvent(tx, workspaceId, {
      actorId: input.actorId,
      eventType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
    });
    if (activity.status === "mismatch") {
      return { status: "idempotency_mismatch" };
    }
    if (activity.status === "replayed") {
      const [replay] = await tx
        .select()
        .from(schedule)
        .where(
          and(
            inWorkspace(schedule, workspaceId),
            eq(schedule.id, activity.event.scheduleId ?? input.scheduleId),
          ),
        );
      if (!replay) throw new Error("schedule mutation replay is missing");
      return { status: "replayed", schedule: replay };
    }
    const [current] = await tx
      .select()
      .from(schedule)
      .where(
        and(
          inWorkspace(schedule, workspaceId),
          eq(schedule.id, input.scheduleId),
          eq(schedule.version, input.expectedVersion),
        ),
      )
      .for("update");
    if (!current) {
      await tx
        .delete(activityEvent)
        .where(eq(activityEvent.id, activity.event.id));
      return { status: "version_conflict" };
    }
    const result = await mutate(tx, current);
    if (result.status === "updated") {
      await tx
        .update(activityEvent)
        .set({
          scheduleId: result.schedule.id,
          publicationId: result.schedule.publicationId,
        })
        .where(eq(activityEvent.id, activity.event.id));
    } else {
      await tx
        .delete(activityEvent)
        .where(eq(activityEvent.id, activity.event.id));
    }
    return result;
  });
}
