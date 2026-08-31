import type { ContentLocale } from "@rz-chain-reporter/contracts";
import { and, asc, eq, isNull, max, sql } from "drizzle-orm";
import { DatabaseError } from "pg";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { approval } from "../schema/approval";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { draftRevision } from "../schema/draft-revision";
import { draftRevisionCommandReceipt } from "../schema/draft-revision-command-receipt";
import { imageGeneration } from "../schema/image-generation";
import { mediaAsset } from "../schema/media-asset";
import { operation } from "../schema/operation";
import { platformDraft } from "../schema/platform-draft";
import { readCopyVariantLocalizations } from "./copy-variant-localization";
import { ownedDraftExists } from "./draft-origin";
import {
  retainSelectedMedia,
  scheduleDetachedMediaCleanup,
} from "./media-asset";

const RECEIPT_IDENTITY_CONSTRAINT =
  "uq_draft_revision_command_receipt_identity";

type RevisionRow = typeof draftRevision.$inferSelect;
type ReceiptRow = typeof draftRevisionCommandReceipt.$inferSelect;

type ExpectedActive = {
  id: string | null;
  version: number;
};

type RevisionContent = {
  contentLocale: ContentLocale;
  headline: string;
  body: string;
  hashtags: readonly string[];
};

export type DraftRevisionSource =
  | { kind: "copy_variant"; id: string; contentLocale: ContentLocale }
  | { kind: "draft_revision"; id: string };

type RevisionCommandBase = {
  actorId: string;
  platformDraftId: string;
  commandKind:
    | "submit_content"
    | "select_revision"
    | "adopt_image"
    | "remove_image";
  idempotencyKey: string;
  requestHash: string;
  expectedActive: ExpectedActive;
};

export type ExecuteDraftRevisionCommandInput = RevisionCommandBase &
  (
    | {
        commandKind: "submit_content";
        source?: DraftRevisionSource;
        content: RevisionContent;
      }
    | {
        commandKind: "select_revision";
        draftRevisionId: string;
      }
    | {
        commandKind: "adopt_image";
        finalMediaAssetId: string;
        expectedImageIntentVersion: number;
      }
    | {
        commandKind: "remove_image";
        expectedImageIntentVersion: number;
      }
  );

export type ExecuteDraftRevisionCommandResult =
  | {
      status: "appended" | "no_op" | "replayed" | "selected" | "updated";
      appendedRevision: boolean;
      revision: RevisionRow;
    }
  | {
      status:
        | "idempotency_mismatch"
        | "media_content_mismatch"
        | "media_invalid"
        | "media_locked"
        | "not_found"
        | "validation_failed"
        | "version_conflict";
    };

export async function readDraftRevisionCommandContext(
  executor: Executor,
  workspaceId: string,
  platformDraftId: string,
  actorId: string,
  expectedRevisionId?: string | null,
  source?: DraftRevisionSource,
) {
  const [draft] = await executor
    .select({
      id: platformDraft.id,
      platform: platformDraft.platform,
      activeRevisionId: platformDraft.activeRevisionId,
      revisionVersion: platformDraft.revisionVersion,
    })
    .from(platformDraft)
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, platformDraftId),
        isNull(platformDraft.deletedAt),
        ownedDraftExists(workspaceId, actorId),
      ),
    );
  if (!draft) return null;
  const active = await readRevision(
    executor,
    workspaceId,
    platformDraftId,
    draft.activeRevisionId,
  );
  return {
    ...draft,
    active,
    expectedRevision:
      expectedRevisionId === draft.activeRevisionId
        ? active
        : await readRevision(
            executor,
            workspaceId,
            platformDraftId,
            expectedRevisionId ?? null,
          ),
    sourceRevision: source
      ? await readRevisionSource(executor, workspaceId, platformDraftId, source)
      : null,
  };
}

export async function executeDraftRevisionCommand(
  executor: Executor,
  workspaceId: string,
  input: ExecuteDraftRevisionCommandInput,
): Promise<ExecuteDraftRevisionCommandResult> {
  const fastReceipt = await readReceipt(executor, workspaceId, input);
  if (fastReceipt)
    return replayReceipt(executor, workspaceId, input, fastReceipt);

  try {
    return await executor.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);

      const existing = await readReceipt(tx, workspaceId, input);
      if (existing) return replayReceipt(tx, workspaceId, input, existing);

      const [draft] = await tx
        .select({
          id: platformDraft.id,
          activeRevisionId: platformDraft.activeRevisionId,
          revisionVersion: platformDraft.revisionVersion,
        })
        .from(platformDraft)
        .where(
          and(
            inWorkspace(platformDraft, workspaceId),
            eq(platformDraft.id, input.platformDraftId),
            isNull(platformDraft.deletedAt),
            ownedDraftExists(workspaceId, input.actorId),
          ),
        )
        .for("update");
      if (!draft) return { status: "not_found" } as const;

      const serializedReceipt = await readReceipt(tx, workspaceId, input);
      if (serializedReceipt) {
        return replayReceipt(tx, workspaceId, input, serializedReceipt);
      }

      if (
        draft.activeRevisionId !== input.expectedActive.id ||
        draft.revisionVersion !== input.expectedActive.version
      ) {
        return { status: "version_conflict" } as const;
      }

      const active = await lockRevision(
        tx,
        workspaceId,
        input.platformDraftId,
        draft.activeRevisionId,
      );

      if (input.commandKind === "select_revision") {
        const target =
          active?.id === input.draftRevisionId
            ? active
            : await lockRevision(
                tx,
                workspaceId,
                input.platformDraftId,
                input.draftRevisionId,
              );
        if (!target) return { status: "not_found" } as const;
        const selected = target.id !== draft.activeRevisionId;
        if (selected) {
          await updateCurrentRevision(tx, workspaceId, draft, target.id);
        }
        await insertReceipt(tx, workspaceId, input, target, false);
        return {
          status: selected ? "selected" : "no_op",
          appendedRevision: false,
          revision: target,
        } as const;
      }

      if (
        input.commandKind === "adopt_image" ||
        input.commandKind === "remove_image"
      ) {
        if (!active) return { status: "not_found" } as const;
        if (active.imageIntentVersion !== input.expectedImageIntentVersion) {
          return { status: "version_conflict" } as const;
        }
        if (await revisionHasApproval(tx, workspaceId, active.id)) {
          return { status: "media_locked" } as const;
        }
        const finalMediaAssetId =
          input.commandKind === "adopt_image" ? input.finalMediaAssetId : null;
        if (
          finalMediaAssetId &&
          (await checkSelectedMedia(
            tx,
            workspaceId,
            input.platformDraftId,
            finalMediaAssetId,
          )) !== "matched"
        ) {
          return { status: "media_invalid" } as const;
        }
        const [updated] = await tx
          .update(draftRevision)
          .set({
            selectedFinalMediaAssetId: finalMediaAssetId,
            imageIntentVersion: active.imageIntentVersion + 1,
          })
          .where(
            and(
              inWorkspace(draftRevision, workspaceId),
              eq(draftRevision.id, active.id),
              eq(draftRevision.imageIntentVersion, active.imageIntentVersion),
            ),
          )
          .returning();
        if (!updated) return { status: "version_conflict" } as const;
        if (finalMediaAssetId) {
          await retainSelectedMedia(tx, workspaceId, finalMediaAssetId);
        }
        if (
          active.selectedFinalMediaAssetId &&
          active.selectedFinalMediaAssetId !== finalMediaAssetId
        ) {
          await scheduleDetachedMediaCleanup(
            tx,
            workspaceId,
            active.selectedFinalMediaAssetId,
          );
        }
        await insertReceipt(tx, workspaceId, input, updated, false);
        return {
          status: "updated",
          appendedRevision: false,
          revision: updated,
        } as const;
      }

      const resolved = await resolveDesiredRevision(
        tx,
        workspaceId,
        input,
        active,
      );
      if (resolved.status !== "resolved") return resolved;
      const desired = resolved.revision;
      const matching = await readMatchingRevision(
        tx,
        workspaceId,
        input.platformDraftId,
        desired,
        active?.id ?? null,
      );
      const shouldAppend = matching === null;

      try {
        const saved = await tx.transaction(async (savepoint) => {
          const revision =
            matching ??
            (await insertRevision(savepoint, workspaceId, {
              ...desired,
              authoredBy: input.actorId,
              platformDraftId: input.platformDraftId,
              revisionNumber: await nextRevisionNumber(
                savepoint,
                workspaceId,
                input.platformDraftId,
              ),
            }));

          if (revision.id !== draft.activeRevisionId) {
            await updateCurrentRevision(
              savepoint,
              workspaceId,
              draft,
              revision.id,
            );
          }

          await insertReceipt(
            savepoint,
            workspaceId,
            input,
            revision,
            shouldAppend,
          );

          return revision;
        });

        return {
          status: shouldAppend
            ? "appended"
            : matching?.id === draft.activeRevisionId
              ? "no_op"
              : "selected",
          appendedRevision: shouldAppend,
          revision: saved,
        };
      } catch (error) {
        if (!isReceiptIdentityConflict(error)) throw error;
        const winner = await readReceipt(tx, workspaceId, input);
        if (!winner) throw error;
        return replayReceipt(tx, workspaceId, input, winner);
      }
    });
  } catch (error) {
    if (!isReceiptIdentityConflict(error)) throw error;
    return readDraftRevisionReceiptInFreshTransaction(
      executor,
      workspaceId,
      input,
      error,
    );
  }
}

export function attachGeneratedFinalToRevision(
  executor: Executor,
  workspaceId: string,
  input: {
    finalMediaAssetId: string;
    operationId: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [generation] = await tx
      .select({
        draftRevisionId: imageGeneration.draftRevisionId,
        expectedImageIntentVersion: imageGeneration.expectedImageIntentVersion,
        finalMediaAssetId: imageGeneration.finalMediaAssetId,
        platformDraftId: draftRevision.platformDraftId,
      })
      .from(imageGeneration)
      .innerJoin(
        draftRevision,
        and(
          inWorkspace(draftRevision, workspaceId),
          eq(draftRevision.id, imageGeneration.draftRevisionId),
        ),
      )
      .where(
        and(
          inWorkspace(imageGeneration, workspaceId),
          eq(imageGeneration.operationId, input.operationId),
        ),
      );
    if (
      !generation ||
      generation.expectedImageIntentVersion === null ||
      generation.finalMediaAssetId !== input.finalMediaAssetId
    ) {
      return { status: "not_found" } as const;
    }

    const [draft] = await tx
      .select({ id: platformDraft.id })
      .from(platformDraft)
      .where(
        and(
          inWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, generation.platformDraftId),
          isNull(platformDraft.deletedAt),
        ),
      )
      .for("update");
    if (!draft) return { status: "not_found" } as const;

    const revision = await lockRevision(
      tx,
      workspaceId,
      generation.platformDraftId,
      generation.draftRevisionId,
    );
    if (!revision) return { status: "not_found" } as const;
    if (revision.imageIntentVersion !== generation.expectedImageIntentVersion) {
      await scheduleDetachedMediaCleanup(
        tx,
        workspaceId,
        input.finalMediaAssetId,
      );
      return { status: "superseded" } as const;
    }
    if (await revisionHasApproval(tx, workspaceId, revision.id)) {
      await scheduleDetachedMediaCleanup(
        tx,
        workspaceId,
        input.finalMediaAssetId,
      );
      return { status: "media_locked" } as const;
    }
    if (
      (await checkSelectedMedia(
        tx,
        workspaceId,
        generation.platformDraftId,
        input.finalMediaAssetId,
      )) !== "matched"
    ) {
      return { status: "media_invalid" } as const;
    }
    if (revision.selectedFinalMediaAssetId === input.finalMediaAssetId) {
      return { status: "replayed", revision } as const;
    }

    const [updated] = await tx
      .update(draftRevision)
      .set({ selectedFinalMediaAssetId: input.finalMediaAssetId })
      .where(
        and(
          inWorkspace(draftRevision, workspaceId),
          eq(draftRevision.id, revision.id),
          eq(
            draftRevision.imageIntentVersion,
            generation.expectedImageIntentVersion,
          ),
        ),
      )
      .returning();
    if (!updated) return { status: "superseded" } as const;
    await retainSelectedMedia(tx, workspaceId, input.finalMediaAssetId);
    if (
      revision.selectedFinalMediaAssetId &&
      revision.selectedFinalMediaAssetId !== input.finalMediaAssetId
    ) {
      await scheduleDetachedMediaCleanup(
        tx,
        workspaceId,
        revision.selectedFinalMediaAssetId,
      );
    }
    return { status: "attached", revision: updated } as const;
  });
}

export async function readDraftRevisionReceiptInFreshTransaction(
  executor: Executor,
  workspaceId: string,
  input: ExecuteDraftRevisionCommandInput,
  conflict: unknown,
): Promise<ExecuteDraftRevisionCommandResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const winner = await readReceipt(tx, workspaceId, input);
    if (!winner) throw conflict;
    return replayReceipt(tx, workspaceId, input, winner);
  });
}

async function readReceipt(
  executor: Executor | Transaction,
  workspaceId: string,
  input: Pick<
    ExecuteDraftRevisionCommandInput,
    "actorId" | "commandKind" | "idempotencyKey"
  >,
) {
  const [receipt] = await executor
    .select()
    .from(draftRevisionCommandReceipt)
    .where(
      and(
        inWorkspace(draftRevisionCommandReceipt, workspaceId),
        eq(draftRevisionCommandReceipt.actorId, input.actorId),
        eq(draftRevisionCommandReceipt.commandKind, input.commandKind),
        eq(draftRevisionCommandReceipt.idempotencyKey, input.idempotencyKey),
      ),
    );
  return receipt ?? null;
}

async function replayReceipt(
  executor: Executor | Transaction,
  workspaceId: string,
  input: Pick<ExecuteDraftRevisionCommandInput, "requestHash">,
  receipt: ReceiptRow,
): Promise<ExecuteDraftRevisionCommandResult> {
  if (receipt.requestHash !== input.requestHash) {
    return { status: "idempotency_mismatch" };
  }
  const [revision] = await executor
    .select()
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, receipt.resultingDraftRevisionId),
      ),
    );
  if (!revision) throw new Error("draft revision receipt result is missing");
  return {
    status: "replayed",
    appendedRevision: receipt.appendedRevision,
    revision,
  };
}

async function readRevision(
  executor: Executor | Transaction,
  workspaceId: string,
  platformDraftId: string,
  revisionId: string | null,
) {
  if (!revisionId) return null;
  const [revision] = await executor
    .select()
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
        eq(draftRevision.id, revisionId),
      ),
    );
  return revision ?? null;
}

async function lockRevision(
  executor: Transaction,
  workspaceId: string,
  platformDraftId: string,
  revisionId: string | null,
) {
  if (!revisionId) return null;
  const [revision] = await executor
    .select()
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
        eq(draftRevision.id, revisionId),
      ),
    )
    .for("update");
  return revision ?? null;
}

async function updateCurrentRevision(
  tx: Transaction,
  workspaceId: string,
  draft: {
    id: string;
    activeRevisionId: string | null;
    revisionVersion: number;
  },
  revisionId: string,
) {
  const [updated] = await tx
    .update(platformDraft)
    .set({
      activeRevisionId: revisionId,
      projectionVersion: sql`${platformDraft.projectionVersion} + 1`,
      revisionVersion: draft.revisionVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, draft.id),
        draft.activeRevisionId === null
          ? isNull(platformDraft.activeRevisionId)
          : eq(platformDraft.activeRevisionId, draft.activeRevisionId),
        eq(platformDraft.revisionVersion, draft.revisionVersion),
      ),
    )
    .returning({ id: platformDraft.id });
  if (!updated) throw new Error("platform draft revision pointer changed");
}

async function revisionHasApproval(
  tx: Transaction,
  workspaceId: string,
  draftRevisionId: string,
) {
  const [row] = await tx
    .select({ id: approval.id })
    .from(approval)
    .where(
      and(
        inWorkspace(approval, workspaceId),
        eq(approval.draftRevisionId, draftRevisionId),
      ),
    )
    .limit(1);
  return Boolean(row);
}

async function insertReceipt(
  tx: Transaction,
  workspaceId: string,
  input: ExecuteDraftRevisionCommandInput,
  revision: RevisionRow,
  appendedRevision: boolean,
) {
  await tx.insert(draftRevisionCommandReceipt).values({
    workspaceId,
    actorId: input.actorId,
    platformDraftId: input.platformDraftId,
    commandKind: input.commandKind,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    resultingDraftRevisionId: revision.id,
    appendedRevision,
  });
}

async function readRevisionSource(
  executor: Executor | Transaction,
  workspaceId: string,
  platformDraftId: string,
  source: DraftRevisionSource,
): Promise<DesiredRevision | null> {
  if (source.kind === "draft_revision") {
    const revision = await readRevision(
      executor,
      workspaceId,
      platformDraftId,
      source.id,
    );
    return revision
      ? carryContent(revision, revision.selectedFinalMediaAssetId)
      : null;
  }

  const [variant] = await executor
    .select({
      id: copyVariant.id,
      contentLocale: copyVariant.contentLocale,
      headline: copyVariant.headline,
      body: copyVariant.body,
      hashtags: copyVariant.hashtags,
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
        eq(copyGeneration.platformDraftId, platformDraftId),
      ),
    )
    .innerJoin(
      operation,
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, copyGeneration.operationId),
        eq(operation.lifecycle, "succeeded"),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, source.id),
        eq(copyVariant.contentLocale, copyGeneration.requestedContentLocale),
        sql`(
          (
            ${operation.commandType} in (
              'copy-generation:route',
              'copy-generation:regenerate',
              'copy-generation:refresh_article'
            )
            and not exists (
              select 1
              from copy_generation newer_generation
              inner join operation newer_operation
                on newer_operation.id = newer_generation.operation_id
                and newer_operation.workspace_id = newer_generation.workspace_id
              where newer_generation.workspace_id = ${copyGeneration.workspaceId}
                and newer_generation.platform_draft_id = ${copyGeneration.platformDraftId}
                and newer_generation.requested_content_locale = ${copyGeneration.requestedContentLocale}
                and newer_operation.lifecycle = 'succeeded'
                and newer_operation.command_type in (
                  'copy-generation:route',
                  'copy-generation:regenerate',
                  'copy-generation:refresh_article'
                )
                and (newer_generation.created_at, newer_generation.operation_id)
                  > (${copyGeneration.createdAt}, ${copyGeneration.operationId})
            )
          )
          or (
            ${operation.commandType} = 'copy-generation:retry_failed'
            and exists (
              select 1
              from copy_generation prior_generation
              inner join operation prior_operation
                on prior_operation.id = prior_generation.operation_id
                and prior_operation.workspace_id = prior_generation.workspace_id
              where prior_generation.workspace_id = ${copyGeneration.workspaceId}
                and prior_generation.platform_draft_id = ${copyGeneration.platformDraftId}
                and prior_generation.requested_content_locale = ${copyGeneration.requestedContentLocale}
                and prior_operation.lifecycle = 'succeeded'
                and prior_operation.command_type in (
                  'copy-generation:route',
                  'copy-generation:regenerate',
                  'copy-generation:refresh_article'
                )
                and (prior_generation.created_at, prior_generation.operation_id)
                  < (${copyGeneration.createdAt}, ${copyGeneration.operationId})
            )
            and not exists (
              select 1
              from copy_generation later_generation
              inner join operation later_operation
                on later_operation.id = later_generation.operation_id
                and later_operation.workspace_id = later_generation.workspace_id
              where later_generation.workspace_id = ${copyGeneration.workspaceId}
                and later_generation.platform_draft_id = ${copyGeneration.platformDraftId}
                and later_generation.requested_content_locale = ${copyGeneration.requestedContentLocale}
                and later_operation.lifecycle = 'succeeded'
                and later_operation.command_type in (
                  'copy-generation:route',
                  'copy-generation:regenerate',
                  'copy-generation:refresh_article'
                )
                and (later_generation.created_at, later_generation.operation_id)
                  > (${copyGeneration.createdAt}, ${copyGeneration.operationId})
            )
          )
        )`,
      ),
    );
  if (!variant) return null;
  const localized =
    variant.contentLocale === source.contentLocale
      ? variant
      : (
          await readCopyVariantLocalizations(
            executor,
            workspaceId,
            [variant.id],
            source.contentLocale,
          )
        )[0];
  if (!localized) return null;
  return {
    ...normalizeContent(localized),
    originatingCopyVariantId: variant.id,
    selectedFinalMediaAssetId: null,
  };
}

async function readMatchingRevision(
  executor: Transaction,
  workspaceId: string,
  platformDraftId: string,
  desired: DesiredRevision,
  preferredRevisionId: string | null,
) {
  const source = await readCopySourceIdentity(
    executor,
    workspaceId,
    desired.originatingCopyVariantId,
  );
  if (!source) return null;
  const [revision] = await executor
    .select()
    .from(draftRevision)
    .innerJoin(
      copyVariant,
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, draftRevision.originatingCopyVariantId),
      ),
    )
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
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
        eq(draftRevision.contentLocale, desired.contentLocale),
        eq(draftRevision.headline, desired.headline),
        eq(draftRevision.body, desired.body),
        eq(draftRevision.hashtags, [...desired.hashtags]),
        eq(copyGeneration.limited, source.limited),
        source.sourceItemRevisionId === null
          ? isNull(copyGeneration.sourceItemRevisionId)
          : eq(
              copyGeneration.sourceItemRevisionId,
              source.sourceItemRevisionId,
            ),
        source.sourceItemEnrichmentId === null
          ? isNull(copyGeneration.sourceItemEnrichmentId)
          : eq(
              copyGeneration.sourceItemEnrichmentId,
              source.sourceItemEnrichmentId,
            ),
        source.pageContentHash === null
          ? isNull(copyGeneration.pageContentHash)
          : eq(copyGeneration.pageContentHash, source.pageContentHash),
      ),
    )
    .orderBy(
      preferredRevisionId === null
        ? sql`1`
        : sql`case when ${draftRevision.id} = ${preferredRevisionId} then 0 else 1 end`,
      asc(draftRevision.revisionNumber),
    )
    .limit(1);
  return revision?.draft_revision ?? null;
}

async function readCopySourceIdentity(
  executor: Executor | Transaction,
  workspaceId: string,
  copyVariantId: string,
) {
  const [source] = await executor
    .select({
      limited: copyGeneration.limited,
      pageContentHash: copyGeneration.pageContentHash,
      sourceItemEnrichmentId: copyGeneration.sourceItemEnrichmentId,
      sourceItemRevisionId: copyGeneration.sourceItemRevisionId,
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
    .where(
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, copyVariantId),
      ),
    );
  return source ?? null;
}

async function nextRevisionNumber(
  executor: Transaction,
  workspaceId: string,
  platformDraftId: string,
) {
  const [row] = await executor
    .select({ number: max(draftRevision.revisionNumber) })
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
      ),
    );
  return (row?.number ?? 0) + 1;
}

type DesiredRevision = {
  contentLocale: ContentLocale;
  headline: string;
  body: string;
  hashtags: readonly string[];
  originatingCopyVariantId: string;
  selectedFinalMediaAssetId: string | null;
};

type ResolvedRevision =
  | { status: "resolved"; revision: DesiredRevision }
  | {
      status:
        | "media_content_mismatch"
        | "media_invalid"
        | "not_found"
        | "validation_failed";
    };

async function resolveDesiredRevision(
  executor: Transaction,
  workspaceId: string,
  input: ExecuteDraftRevisionCommandInput,
  active: RevisionRow | null,
): Promise<ResolvedRevision> {
  if (input.commandKind === "submit_content") {
    const source = input.source
      ? await readRevisionSource(
          executor,
          workspaceId,
          input.platformDraftId,
          input.source,
        )
      : active
        ? carryContent(active, active.selectedFinalMediaAssetId)
        : null;
    if (!source) return { status: "not_found" };
    const content = normalizeContent(input.content);
    if (content.contentLocale !== source.contentLocale) {
      return { status: "validation_failed" };
    }
    const canonicalHashtag = source.hashtags[0];
    if (!canonicalHashtag) return { status: "validation_failed" };
    const hashtags = [
      canonicalHashtag,
      ...content.hashtags.filter(
        (hashtag) =>
          hashtag.toLocaleLowerCase() !== canonicalHashtag.toLocaleLowerCase(),
      ),
    ];
    const desired = {
      ...content,
      hashtags,
      originatingCopyVariantId: source.originatingCopyVariantId,
      selectedFinalMediaAssetId: active?.selectedFinalMediaAssetId ?? null,
    };
    return {
      status: "resolved",
      revision: desired,
    };
  }
  return { status: "not_found" };
}

function carryContent(
  revision: RevisionRow,
  selectedFinalMediaAssetId: string | null,
): DesiredRevision {
  return {
    contentLocale: revision.contentLocale,
    headline: revision.headline,
    body: revision.body,
    hashtags: revision.hashtags,
    originatingCopyVariantId: revision.originatingCopyVariantId,
    selectedFinalMediaAssetId,
  };
}

function normalizeContent(content: RevisionContent): RevisionContent {
  return {
    contentLocale: content.contentLocale,
    headline: content.headline.trim(),
    body: content.body.trim(),
    hashtags: content.hashtags.map((hashtag) => hashtag.trim()),
  };
}

async function checkSelectedMedia(
  executor: Transaction,
  workspaceId: string,
  platformDraftId: string,
  finalMediaAssetId: string,
): Promise<"matched" | "media_invalid"> {
  const [asset] = await executor
    .select({
      id: mediaAsset.id,
      kind: mediaAsset.kind,
      cleanupAfter: mediaAsset.cleanupAfter,
      version: mediaAsset.version,
    })
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, finalMediaAssetId),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
      ),
    )
    .for("update");
  if (!asset || (asset.kind !== "image" && asset.kind !== "image_final")) {
    return "media_invalid";
  }
  if (asset.kind === "image") {
    if (asset.cleanupAfter) {
      await executor
        .update(mediaAsset)
        .set({ cleanupAfter: null, version: asset.version + 1 })
        .where(
          and(
            inWorkspace(mediaAsset, workspaceId),
            eq(mediaAsset.id, asset.id),
            eq(mediaAsset.version, asset.version),
          ),
        );
    }
    return "matched";
  }

  const [source] = await executor
    .select({ id: imageGeneration.operationId })
    .from(imageGeneration)
    .innerJoin(
      draftRevision,
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, imageGeneration.draftRevisionId),
        eq(draftRevision.platformDraftId, platformDraftId),
      ),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.finalMediaAssetId, finalMediaAssetId),
      ),
    );
  return source ? "matched" : "media_invalid";
}

async function insertRevision(
  tx: Transaction,
  workspaceId: string,
  input: {
    platformDraftId: string;
    revisionNumber: number;
    contentLocale: ContentLocale;
    headline: string;
    body: string;
    hashtags: readonly string[];
    originatingCopyVariantId: string;
    selectedFinalMediaAssetId: string | null;
    authoredBy: string;
  },
) {
  const [revision] = await tx
    .insert(draftRevision)
    .values({ ...input, hashtags: [...input.hashtags], workspaceId })
    .returning();
  if (!revision) throw new Error("draft revision insert returned no row");
  return revision;
}

function isReceiptIdentityConflict(error: unknown) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (current instanceof DatabaseError) {
      return (
        current.code === "23505" &&
        current.constraint === RECEIPT_IDENTITY_CONSTRAINT
      );
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}
