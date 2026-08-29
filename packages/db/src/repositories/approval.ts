import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace, liveInWorkspace } from "../filters";
import { activityEvent } from "../schema/activity-event";
import { approval } from "../schema/approval";
import { draftRevision } from "../schema/draft-revision";
import { imageGeneration } from "../schema/image-generation";
import { mediaAsset } from "../schema/media-asset";
import { operation } from "../schema/operation";
import { platformDraft } from "../schema/platform-draft";
import { appendActivityEvent, lockActivityIdentity } from "./activity-event";
import { ownedDraftExists } from "./draft-origin";

type ApprovalRow = typeof approval.$inferSelect;

type ApprovalCommandResult =
  | { status: "created" | "replayed"; approval: ApprovalRow }
  | {
      status:
        | "idempotency_mismatch"
        | "image_generation_in_progress"
        | "media_not_publishable"
        | "not_found"
        | "snapshot_stale"
        | "text_only_not_supported";
    };

export async function grantApproval(
  executor: Executor | Transaction,
  workspaceId: string,
  input: {
    actorId: string;
    draftRevisionId: string;
    expectedRevisionVersion: number;
    selectedFinalMediaAssetId: string | null;
    idempotencyKey: string;
    requestHash: string;
  },
): Promise<ApprovalCommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await lockActivityIdentity(
      tx,
      workspaceId,
      "approval.granted",
      input.idempotencyKey,
    );
    const [receipt] = await tx
      .select({ event: activityEvent, approval })
      .from(activityEvent)
      .leftJoin(
        approval,
        and(
          inWorkspace(approval, workspaceId),
          eq(approval.id, activityEvent.approvalId),
        ),
      )
      .where(
        and(
          inWorkspace(activityEvent, workspaceId),
          eq(activityEvent.eventType, "approval.granted"),
          eq(activityEvent.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (receipt) {
      if (
        receipt.event.actorId !== input.actorId ||
        receipt.event.requestHash !== input.requestHash
      ) {
        return { status: "idempotency_mismatch" };
      }
      if (!receipt.approval) throw new Error("approval receipt result missing");
      return { status: "replayed", approval: receipt.approval };
    }
    const [existing] = await tx
      .select()
      .from(approval)
      .where(
        and(
          inWorkspace(approval, workspaceId),
          eq(approval.approvedBy, input.actorId),
          eq(approval.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      return existing.requestHash === input.requestHash
        ? { status: "replayed", approval: existing }
        : { status: "idempotency_mismatch" };
    }

    const [located] = await tx
      .select({
        draftRevisionId: draftRevision.id,
        platformDraftId: draftRevision.platformDraftId,
      })
      .from(draftRevision)
      .where(
        and(
          inWorkspace(draftRevision, workspaceId),
          eq(draftRevision.id, input.draftRevisionId),
        ),
      );
    if (!located) return { status: "not_found" };
    const [draft] = await tx
      .select({
        activeRevisionId: platformDraft.activeRevisionId,
        revisionVersion: platformDraft.revisionVersion,
        platform: platformDraft.platform,
      })
      .from(platformDraft)
      .where(
        and(
          liveInWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, located.platformDraftId),
          ownedDraftExists(workspaceId, input.actorId),
        ),
      )
      .for("update");
    if (!draft) return { status: "not_found" };
    const [snapshot] = await tx
      .select({
        draftRevisionId: draftRevision.id,
        selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
      })
      .from(draftRevision)
      .where(
        and(
          inWorkspace(draftRevision, workspaceId),
          eq(draftRevision.id, input.draftRevisionId),
          eq(draftRevision.platformDraftId, located.platformDraftId),
        ),
      )
      .for("update");
    if (!snapshot) return { status: "not_found" };
    if (
      draft.activeRevisionId !== input.draftRevisionId ||
      draft.revisionVersion !== input.expectedRevisionVersion ||
      snapshot.selectedFinalMediaAssetId !== input.selectedFinalMediaAssetId
    ) {
      return { status: "snapshot_stale" };
    }
    const [inFlightImage] = await tx
      .select({ id: imageGeneration.operationId })
      .from(imageGeneration)
      .innerJoin(
        operation,
        and(
          eq(operation.id, imageGeneration.operationId),
          eq(operation.workspaceId, imageGeneration.workspaceId),
        ),
      )
      .where(
        and(
          inWorkspace(imageGeneration, workspaceId),
          eq(imageGeneration.draftRevisionId, input.draftRevisionId),
          inArray(operation.lifecycle, ["queued", "running", "settling"]),
        ),
      )
      .limit(1);
    if (inFlightImage) return { status: "image_generation_in_progress" };
    if (
      draft.platform === "instagram" &&
      input.selectedFinalMediaAssetId === null
    ) {
      return { status: "text_only_not_supported" };
    }
    if (
      input.selectedFinalMediaAssetId &&
      !(await isPublishableSelectedMedia(
        tx,
        workspaceId,
        input.draftRevisionId,
        input.selectedFinalMediaAssetId,
      ))
    ) {
      return { status: "media_not_publishable" };
    }

    const [admitted] = await tx
      .select()
      .from(approval)
      .where(
        and(
          inWorkspace(approval, workspaceId),
          eq(approval.draftRevisionId, input.draftRevisionId),
          eq(approval.platform, draft.platform),
        ),
      );
    if (admitted) {
      if (
        admitted.selectedFinalMediaAssetId !== input.selectedFinalMediaAssetId
      ) {
        return { status: "snapshot_stale" };
      }
      const activity = await appendActivityEvent(tx, workspaceId, {
        actorId: input.actorId,
        eventType: "approval.granted",
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
        approvalId: admitted.id,
      });
      if (activity.status === "mismatch") {
        throw new Error("approval activity identity mismatch");
      }
      return { status: "replayed", approval: admitted };
    }

    const [created] = await tx
      .insert(approval)
      .values({
        workspaceId,
        draftRevisionId: input.draftRevisionId,
        platform: draft.platform,
        selectedFinalMediaAssetId: input.selectedFinalMediaAssetId,
        approvedBy: input.actorId,
        idempotencyKey: input.idempotencyKey,
        requestHash: input.requestHash,
      })
      .onConflictDoNothing({
        target: [
          approval.workspaceId,
          approval.draftRevisionId,
          approval.platform,
        ],
      })
      .returning();
    const approved =
      created ??
      (
        await tx
          .select()
          .from(approval)
          .where(
            and(
              inWorkspace(approval, workspaceId),
              eq(approval.draftRevisionId, input.draftRevisionId),
              eq(approval.platform, draft.platform),
            ),
          )
      )[0];
    if (!approved) throw new Error("approval insert returned no row");

    const activity = await appendActivityEvent(tx, workspaceId, {
      actorId: input.actorId,
      eventType: "approval.granted",
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      approvalId: approved.id,
    });
    if (activity.status === "mismatch") {
      throw new Error("approval activity identity mismatch");
    }
    return {
      status: created ? "created" : "replayed",
      approval: approved,
    };
  });
}

export async function readActionableApproval(
  executor: Executor | Transaction,
  workspaceId: string,
  approvalId: string,
) {
  const [row] = await executor
    .select({
      approval,
      platformDraftId: draftRevision.platformDraftId,
      mediaBrandId: platformDraft.mediaBrandId,
      currentSelectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
    })
    .from(approval)
    .innerJoin(
      draftRevision,
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, approval.draftRevisionId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        liveInWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, draftRevision.platformDraftId),
      ),
    )
    .where(
      and(inWorkspace(approval, workspaceId), eq(approval.id, approvalId)),
    );
  if (!row) return null;
  return row.currentSelectedFinalMediaAssetId ===
    row.approval.selectedFinalMediaAssetId
    ? row
    : null;
}

async function isPublishableSelectedMedia(
  executor: Executor,
  workspaceId: string,
  draftRevisionId: string,
  mediaAssetId: string,
) {
  const generatedRevision = alias(draftRevision, "generated_revision");
  const [row] = await executor
    .select({ id: mediaAsset.id })
    .from(mediaAsset)
    .leftJoin(
      imageGeneration,
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.finalMediaAssetId, mediaAsset.id),
      ),
    )
    .leftJoin(
      generatedRevision,
      and(
        inWorkspace(generatedRevision, workspaceId),
        eq(generatedRevision.id, imageGeneration.draftRevisionId),
      ),
    )
    .innerJoin(
      draftRevision,
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, draftRevisionId),
      ),
    )
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
        or(
          eq(mediaAsset.kind, "image"),
          and(
            eq(mediaAsset.kind, "image_final"),
            eq(
              generatedRevision.platformDraftId,
              draftRevision.platformDraftId,
            ),
          ),
        ),
      ),
    );
  return row !== undefined;
}
