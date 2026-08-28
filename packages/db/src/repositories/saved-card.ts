import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import { classifyDbError } from "../db-error";
import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace, liveInWorkspace } from "../filters";
import { activityEvent } from "../schema/activity-event";
import { platformDraft } from "../schema/platform-draft";
import { savedCard } from "../schema/saved-card";
import { appendActivityEvent } from "./activity-event";

type SavedCardRow = typeof savedCard.$inferSelect;

type SavedCardCommandResult =
  | { status: "created" | "updated" | "replayed"; savedCard: SavedCardRow }
  | {
      status:
        | "already_active"
        | "idempotency_mismatch"
        | "not_found"
        | "version_conflict";
    };

export async function savePlatformDraft(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    platformDraftId: string;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<SavedCardCommandResult> {
  return executor
    .transaction(async (tx): Promise<SavedCardCommandResult> => {
      await withWorkspaceContext(tx, workspaceId);
      await lockIdentity(tx, workspaceId, input.actorId, input.idempotencyKey);
      const activity = await appendActivityEvent(tx, workspaceId, {
        actorId: input.actorId,
        eventType: "saved_card.saved",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      });
      if (activity.status === "mismatch") {
        return { status: "idempotency_mismatch" };
      }
      if (activity.status === "replayed") {
        const replay = await readSavedCard(
          tx,
          workspaceId,
          activity.event.savedCardId,
        );
        if (!replay) throw new Error("saved card replay target is missing");
        return { status: "replayed", savedCard: replay };
      }

      const [draft] = await tx
        .select({ id: platformDraft.id })
        .from(platformDraft)
        .where(
          and(
            liveInWorkspace(platformDraft, workspaceId),
            eq(platformDraft.id, input.platformDraftId),
          ),
        );
      if (!draft) throw new Error("saved card target disappeared");

      const [active] = await tx
        .select()
        .from(savedCard)
        .where(
          and(
            inWorkspace(savedCard, workspaceId),
            eq(savedCard.savedBy, input.actorId),
            eq(savedCard.platformDraftId, input.platformDraftId),
            isNull(savedCard.discardedAt),
          ),
        )
        .for("update");
      if (active) throw new Error("saved card active identity conflict");

      const [created] = await tx
        .insert(savedCard)
        .values({
          workspaceId,
          platformDraftId: input.platformDraftId,
          savedBy: input.actorId,
        })
        .returning();
      if (!created) throw new Error("saved card insert returned no row");
      await tx
        .update(activityEvent)
        .set({
          savedCardId: created.id,
          platformDraftId: input.platformDraftId,
        })
        .where(eq(activityEvent.id, activity.event.id));
      return { status: "created", savedCard: created };
    })
    .catch((error: unknown): SavedCardCommandResult => {
      if (
        error instanceof Error &&
        error.message === "saved card target disappeared"
      ) {
        return { status: "not_found" } as const;
      }
      if (
        error instanceof Error &&
        error.message === "saved card active identity conflict"
      ) {
        return { status: "already_active" } as const;
      }
      const failure = classifyDbError(error);
      if (
        failure?.kind === "code" &&
        failure.code === "SAVED_CARD_ALREADY_ACTIVE"
      ) {
        return { status: "already_active" } as const;
      }
      throw error;
    });
}

export async function mutateSavedCard(
  executor: Executor,
  workspaceId: string,
  input: {
    actorId: string;
    savedCardId: string;
    expectedVersion: number;
    action: "discard" | "restore";
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<SavedCardCommandResult> {
  const eventType =
    input.action === "discard"
      ? ("saved_card.discarded" as const)
      : ("saved_card.restored" as const);
  return executor
    .transaction(async (tx): Promise<SavedCardCommandResult> => {
      await withWorkspaceContext(tx, workspaceId);
      await lockIdentity(tx, workspaceId, input.actorId, input.idempotencyKey);
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
        const replay = await readSavedCard(
          tx,
          workspaceId,
          activity.event.savedCardId,
        );
        if (!replay) throw new Error("saved card replay target is missing");
        return { status: "replayed", savedCard: replay };
      }

      const desiredDiscardedAt = input.action === "discard" ? new Date() : null;
      const statePredicate =
        input.action === "discard"
          ? isNull(savedCard.discardedAt)
          : isNotNull(savedCard.discardedAt);
      const [updated] = await tx
        .update(savedCard)
        .set({
          discardedAt: desiredDiscardedAt,
          version: input.expectedVersion + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            inWorkspace(savedCard, workspaceId),
            eq(savedCard.id, input.savedCardId),
            eq(savedCard.savedBy, input.actorId),
            eq(savedCard.version, input.expectedVersion),
            statePredicate,
          ),
        )
        .returning();
      if (!updated) {
        const current = await readSavedCard(tx, workspaceId, input.savedCardId);
        await tx
          .delete(activityEvent)
          .where(eq(activityEvent.id, activity.event.id));
        return { status: current ? "version_conflict" : "not_found" };
      }
      await tx
        .update(activityEvent)
        .set({
          savedCardId: updated.id,
          platformDraftId: updated.platformDraftId,
        })
        .where(eq(activityEvent.id, activity.event.id));
      return { status: "updated", savedCard: updated };
    })
    .catch((error: unknown): SavedCardCommandResult => {
      const failure = classifyDbError(error);
      if (
        failure?.kind === "code" &&
        failure.code === "SAVED_CARD_ALREADY_ACTIVE"
      ) {
        return { status: "already_active" };
      }
      throw error;
    });
}

async function readSavedCard(
  executor: Executor | Transaction,
  workspaceId: string,
  id: string | null,
) {
  if (!id) return null;
  const [row] = await executor
    .select()
    .from(savedCard)
    .where(and(inWorkspace(savedCard, workspaceId), eq(savedCard.id, id)));
  return row ?? null;
}

async function lockIdentity(
  executor: Executor,
  workspaceId: string,
  actorId: string,
  idempotencyKey: string,
) {
  await executor.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`${workspaceId}:${actorId}:${idempotencyKey}`}, 0))`,
  );
}
