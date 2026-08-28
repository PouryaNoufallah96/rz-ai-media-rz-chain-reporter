import { and, eq, sql } from "drizzle-orm";

import { type Executor, withWorkspaceContext } from "../executor";
import { activityEvent } from "../schema/activity-event";
import { publishingControl } from "../schema/publishing-control";
import { appendActivityEvent } from "./activity-event";

export async function setPublishingPaused(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    paused: boolean;
    reasonCode: string | null;
    expectedVersion: number;
    idempotencyKey: string;
    requestHash: string;
  },
) {
  const eventType = input.paused
    ? ("publishing.paused" as const)
    : ("publishing.resumed" as const);
  return executor.transaction(async (tx) => {
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
      return { status: "idempotency_mismatch" as const };
    }
    if (activity.status === "replayed") {
      const [current] = await tx
        .select()
        .from(publishingControl)
        .where(eq(publishingControl.workspaceId, workspaceId));
      if (!current) throw new Error("publishing control replay is missing");
      return { status: "replayed" as const, control: current };
    }

    if (input.expectedVersion === 0) {
      const [created] = await tx
        .insert(publishingControl)
        .values({
          workspaceId,
          paused: input.paused,
          pausedBy: input.paused ? input.actorId : null,
          pausedAt: input.paused ? new Date() : null,
          reasonCode: input.paused ? input.reasonCode : null,
        })
        .onConflictDoNothing({ target: publishingControl.workspaceId })
        .returning();
      if (created) return { status: "updated" as const, control: created };
    }

    const [updated] = await tx
      .update(publishingControl)
      .set({
        paused: input.paused,
        pausedBy: input.paused ? input.actorId : null,
        pausedAt: input.paused ? new Date() : null,
        reasonCode: input.paused ? input.reasonCode : null,
        version: input.expectedVersion + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(publishingControl.workspaceId, workspaceId),
          eq(publishingControl.version, input.expectedVersion),
        ),
      )
      .returning();
    if (!updated) {
      await tx
        .delete(activityEvent)
        .where(eq(activityEvent.id, activity.event.id));
      return { status: "version_conflict" as const };
    }
    await tx
      .update(activityEvent)
      .set({ requestHash: input.requestHash })
      .where(eq(activityEvent.id, activity.event.id));
    return { status: "updated" as const, control: updated };
  });
}
