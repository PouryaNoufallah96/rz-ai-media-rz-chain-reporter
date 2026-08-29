import type { ActivityEventType } from "@rz-chain-reporter/contracts";
import { and, eq, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { activityEvent } from "../schema/activity-event";
import { publishOperation } from "../schema/publish-operation";

type ActivityEventRow = typeof activityEvent.$inferSelect;

type AppendActivityInput = {
  actorId?: string | null;
  eventType: ActivityEventType;
  idempotencyKey: string;
  requestHash: string;
  platformDraftId?: string | null;
  savedCardId?: string | null;
  approvalId?: string | null;
  scheduleId?: string | null;
  publicationId?: string | null;
  operationId?: string | null;
  occurredAt?: Date;
};

type AppendActivityResult =
  | { status: "created" | "replayed"; event: ActivityEventRow }
  | { status: "mismatch" };

type PublicationSettlementActivityInput = {
  actorId: string;
  eventType: Extract<
    ActivityEventType,
    | "publication.confirmed"
    | "publication.delivery_unknown"
    | "publication.failed"
  >;
  idempotencyKey: string;
  operationId: string;
  publicationId: string;
  requestHash: string;
  scheduleId?: string | null;
  occurredAt: Date;
};

export async function lockActivityIdentity(
  executor: Executor | Transaction,
  workspaceId: string,
  eventType: ActivityEventType,
  idempotencyKey: string,
) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${eventType}:${idempotencyKey}`}, 0))`,
  );
}

export async function appendActivityEvent(
  executor: Executor | Transaction,
  workspaceId: string,
  input: AppendActivityInput,
): Promise<AppendActivityResult> {
  const [existing] = await executor
    .select()
    .from(activityEvent)
    .where(
      and(
        inWorkspace(activityEvent, workspaceId),
        eq(activityEvent.eventType, input.eventType),
        eq(activityEvent.idempotencyKey, input.idempotencyKey),
      ),
    );
  if (existing) {
    return existing.requestHash === input.requestHash
      ? { status: "replayed", event: existing }
      : { status: "mismatch" };
  }

  const [created] = await executor
    .insert(activityEvent)
    .values({
      workspaceId,
      actorId: input.actorId,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      platformDraftId: input.platformDraftId,
      savedCardId: input.savedCardId,
      approvalId: input.approvalId,
      scheduleId: input.scheduleId,
      publicationId: input.publicationId,
      operationId: input.operationId,
      occurredAt: input.occurredAt,
    })
    .returning();
  if (!created) throw new Error("activity event insert returned no row");
  return { status: "created", event: created };
}

export async function recordPublicationSettlementActivity(
  executor: Executor,
  workspaceId: string,
  input: PublicationSettlementActivityInput,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(publishOperation)
      .where(
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, input.operationId),
        ),
      )
      .for("update");
    if (!current) throw new Error("PUBLICATION_ACTIVITY_OPERATION_MISSING");

    const activity = await appendActivityEvent(tx, workspaceId, input);
    if (activity.status === "mismatch") {
      throw new Error("PUBLICATION_ACTIVITY_MISMATCH");
    }
    const recordedAt = activity.event.occurredAt;
    if (current.settlementActivityStatus === "recorded") {
      if (
        current.settlementActivityRecordedAt?.getTime() !== recordedAt.getTime()
      ) {
        throw new Error("PUBLICATION_ACTIVITY_REPLAY_MISMATCH");
      }
      return {
        status: "replayed" as const,
        event: activity.event,
        operation: current,
      };
    }
    if (current.settlementActivityStatus !== "pending") {
      throw new Error("PUBLICATION_ACTIVITY_NOT_PENDING");
    }
    const [updated] = await tx
      .update(publishOperation)
      .set({
        settlementActivityStatus: "recorded",
        settlementActivityFailureCode: null,
        settlementActivityRecordedAt: recordedAt,
        updatedAt: recordedAt,
      })
      .where(
        and(
          inWorkspace(publishOperation, workspaceId),
          eq(publishOperation.operationId, input.operationId),
          eq(publishOperation.settlementActivityStatus, "pending"),
        ),
      )
      .returning();
    if (!updated) throw new Error("PUBLICATION_ACTIVITY_RECORDING_LOST");
    return {
      status: activity.status,
      event: activity.event,
      operation: updated,
    };
  });
}
