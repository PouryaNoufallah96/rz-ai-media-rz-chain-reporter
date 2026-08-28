import { createHash } from "node:crypto";
import type {
  ContentLocale,
  DraftRevisionCommandKind,
} from "@rz-chain-reporter/contracts";
import { and, asc, eq, isNull, max } from "drizzle-orm";
import { DatabaseError } from "pg";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { draftRevision } from "../schema/draft-revision";
import { draftRevisionCommandReceipt } from "../schema/draft-revision-command-receipt";
import { imageGeneration } from "../schema/image-generation";
import { mediaAsset } from "../schema/media-asset";
import { platformDraft } from "../schema/platform-draft";

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

type RevisionCommandBase = {
  actorId: string;
  platformDraftId: string;
  commandKind: DraftRevisionCommandKind;
  idempotencyKey: string;
  requestHash: string;
  expectedActive: ExpectedActive;
};

export type ExecuteDraftRevisionCommandInput = RevisionCommandBase &
  (
    | {
        commandKind: "apply_copy_variant";
        copyVariantId: string;
      }
    | {
        commandKind: "submit_content";
        content: RevisionContent;
      }
    | {
        commandKind: "adopt_image";
        finalMediaAssetId: string;
      }
    | { commandKind: "remove_image" }
    | { commandKind: "select_revision"; draftRevisionId: string }
  );

export type ExecuteDraftRevisionCommandResult =
  | {
      status: "appended" | "no_op" | "replayed";
      appendedRevision: boolean;
      revision: RevisionRow;
    }
  | {
      status:
        | "idempotency_mismatch"
        | "media_content_mismatch"
        | "media_invalid"
        | "not_found"
        | "version_conflict";
    };

export async function readDraftRevisionCommandContext(
  executor: Executor,
  workspaceId: string,
  platformDraftId: string,
  expectedRevisionId?: string | null,
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

      const active = await readRevision(
        tx,
        workspaceId,
        input.platformDraftId,
        draft.activeRevisionId,
      );

      let matching: RevisionRow | null;
      let desired: DesiredRevision;
      if (input.commandKind === "select_revision") {
        matching = await readRevision(
          tx,
          workspaceId,
          input.platformDraftId,
          input.draftRevisionId,
        );
        if (!matching) return { status: "not_found" } as const;
        desired = matching;
      } else {
        const resolved = await resolveDesiredRevision(
          tx,
          workspaceId,
          input,
          active,
        );
        if (resolved.status !== "resolved") return resolved;
        desired = resolved.revision;
        matching =
          active && sameRevisionMaterial(active, desired)
            ? active
            : await readMatchingRevision(
                tx,
                workspaceId,
                input.platformDraftId,
                desired,
              );
      }
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
            await savepoint
              .update(platformDraft)
              .set({
                activeRevisionId: revision.id,
                revisionVersion: draft.revisionVersion + 1,
                updatedAt: new Date(),
              })
              .where(
                and(
                  inWorkspace(platformDraft, workspaceId),
                  eq(platformDraft.id, input.platformDraftId),
                ),
              );
          }

          await savepoint.insert(draftRevisionCommandReceipt).values({
            workspaceId,
            actorId: input.actorId,
            platformDraftId: input.platformDraftId,
            commandKind: input.commandKind,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
            resultingDraftRevisionId: revision.id,
            appendedRevision: shouldAppend,
          });

          return revision;
        });

        return {
          status: shouldAppend ? "appended" : "no_op",
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
    actorId: string;
    draftRevisionId: string;
    finalMediaAssetId: string;
    operationId: string;
    platformDraftId: string;
    expectedRevisionVersion: number;
  },
) {
  const expectedActive = {
    id: input.draftRevisionId,
    version: input.expectedRevisionVersion,
  };
  const semanticPayload = {
    commandKind: "adopt_image" as const,
    platformDraftId: input.platformDraftId,
    expectedActive,
    finalMediaAssetId: input.finalMediaAssetId,
  };
  return executeDraftRevisionCommand(executor, workspaceId, {
    ...semanticPayload,
    actorId: input.actorId,
    idempotencyKey: input.operationId,
    requestHash: createHash("sha256")
      .update(JSON.stringify(semanticPayload))
      .digest("hex"),
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

async function readMatchingRevision(
  executor: Transaction,
  workspaceId: string,
  platformDraftId: string,
  desired: DesiredRevision,
) {
  const [revision] = await executor
    .select()
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
        eq(draftRevision.contentLocale, desired.contentLocale),
        eq(draftRevision.headline, desired.headline),
        eq(draftRevision.body, desired.body),
        eq(draftRevision.hashtags, [...desired.hashtags]),
        desired.selectedFinalMediaAssetId === null
          ? isNull(draftRevision.selectedFinalMediaAssetId)
          : eq(
              draftRevision.selectedFinalMediaAssetId,
              desired.selectedFinalMediaAssetId,
            ),
      ),
    )
    .orderBy(asc(draftRevision.revisionNumber))
    .limit(1);
  return revision ?? null;
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
  | { status: "media_content_mismatch" | "media_invalid" | "not_found" };

async function resolveDesiredRevision(
  executor: Transaction,
  workspaceId: string,
  input: Exclude<
    ExecuteDraftRevisionCommandInput,
    { commandKind: "select_revision" }
  >,
  active: RevisionRow | null,
): Promise<ResolvedRevision> {
  if (input.commandKind === "submit_content") {
    if (!active) return { status: "not_found" };
    const canonicalHashtag = active.hashtags[0];
    if (!canonicalHashtag) return { status: "not_found" };
    const content = normalizeContent(input.content);
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
      originatingCopyVariantId: active.originatingCopyVariantId,
      selectedFinalMediaAssetId: active.selectedFinalMediaAssetId,
    };
    if (
      desired.selectedFinalMediaAssetId &&
      !sameRevisionCopy(active, desired) &&
      (await checkSelectedMedia(
        executor,
        workspaceId,
        input.platformDraftId,
        desired.selectedFinalMediaAssetId,
        desired,
      )) !== "matched"
    ) {
      desired.selectedFinalMediaAssetId = null;
    }
    return {
      status: "resolved",
      revision: desired,
    };
  }

  if (input.commandKind !== "apply_copy_variant") {
    if (!active) return { status: "not_found" };
    if (input.commandKind === "remove_image") {
      return { status: "resolved", revision: carryContent(active, null) };
    }
    const mediaStatus = await checkSelectedMedia(
      executor,
      workspaceId,
      input.platformDraftId,
      input.finalMediaAssetId,
      active,
    );
    if (mediaStatus !== "matched") return { status: mediaStatus };
    return {
      status: "resolved",
      revision: carryContent(active, input.finalMediaAssetId),
    };
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
        eq(copyGeneration.platformDraftId, input.platformDraftId),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, input.copyVariantId),
      ),
    );
  if (!variant) return { status: "not_found" };
  const content = normalizeContent(variant);
  return {
    status: "resolved",
    revision: {
      ...content,
      originatingCopyVariantId: variant.id,
      selectedFinalMediaAssetId:
        active && sameRevisionCopy(active, content)
          ? active.selectedFinalMediaAssetId
          : null,
    },
  };
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
  content: RevisionContent,
): Promise<"matched" | "media_invalid" | "media_content_mismatch"> {
  const [asset] = await executor
    .select({ kind: mediaAsset.kind })
    .from(mediaAsset)
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, finalMediaAssetId),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
      ),
    );
  if (!asset || (asset.kind !== "image" && asset.kind !== "image_final")) {
    return "media_invalid";
  }
  if (asset.kind === "image") return "matched";

  const [source] = await executor
    .select({
      contentLocale: draftRevision.contentLocale,
      headline: draftRevision.headline,
      body: draftRevision.body,
      hashtags: draftRevision.hashtags,
    })
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
  if (!source) return "media_invalid";
  return sameRevisionCopy(source, content)
    ? "matched"
    : "media_content_mismatch";
}

function sameRevisionMaterial(revision: RevisionRow, desired: DesiredRevision) {
  return (
    sameRevisionCopy(revision, desired) &&
    revision.selectedFinalMediaAssetId === desired.selectedFinalMediaAssetId
  );
}

function sameRevisionCopy(left: RevisionContent, right: RevisionContent) {
  return (
    left.contentLocale === right.contentLocale &&
    left.headline === right.headline &&
    left.body === right.body &&
    sameStrings(left.hashtags, right.hashtags)
  );
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
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
