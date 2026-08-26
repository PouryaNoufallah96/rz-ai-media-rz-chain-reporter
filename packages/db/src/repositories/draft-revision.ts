import { createHash } from "node:crypto";
import type {
  ContentLocale,
  DraftRevisionCommandKind,
} from "@rz-chain-reporter/contracts";
import { and, desc, eq, isNull } from "drizzle-orm";
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

type ExpectedLatest = {
  id: string | null;
  revisionNumber: number | null;
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
  expectedLatest: ExpectedLatest;
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
) {
  const [draft] = await executor
    .select({ id: platformDraft.id, platform: platformDraft.platform })
    .from(platformDraft)
    .where(
      and(
        inWorkspace(platformDraft, workspaceId),
        eq(platformDraft.id, platformDraftId),
        isNull(platformDraft.deletedAt),
      ),
    );
  if (!draft) return null;
  return {
    ...draft,
    latest: await readLatestRevision(executor, workspaceId, platformDraftId),
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
        .select({ id: platformDraft.id })
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

      const latest = await readLatestRevision(
        tx,
        workspaceId,
        input.platformDraftId,
      );
      if (!matchesExpectedLatest(latest, input.expectedLatest)) {
        return { status: "version_conflict" } as const;
      }

      const resolved = await resolveDesiredRevision(
        tx,
        workspaceId,
        input,
        latest,
      );
      if (resolved.status !== "resolved") return resolved;
      const desired = resolved.revision;

      const updatesImageOnly =
        input.commandKind === "adopt_image" ||
        input.commandKind === "remove_image";
      const shouldAppend =
        !updatesImageOnly && revisionMaterialDiffers(latest, input, desired);
      const shouldUpdateImage =
        updatesImageOnly &&
        latest?.selectedFinalMediaAssetId !== desired.selectedFinalMediaAssetId;
      if (!shouldAppend && !latest) return { status: "not_found" } as const;

      try {
        const saved = await tx.transaction(async (savepoint) => {
          const revision = shouldAppend
            ? await insertRevision(savepoint, workspaceId, {
                ...desired,
                authoredBy: input.actorId,
                platformDraftId: input.platformDraftId,
                revisionNumber: (latest?.revisionNumber ?? 0) + 1,
              })
            : shouldUpdateImage && latest
              ? await updateRevisionImage(
                  savepoint,
                  workspaceId,
                  latest.id,
                  desired.selectedFinalMediaAssetId,
                )
              : latest;
          if (!revision) throw new Error("revision command has no result");

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
    revisionNumber: number;
  },
) {
  const expectedLatest = {
    id: input.draftRevisionId,
    revisionNumber: input.revisionNumber,
  };
  const semanticPayload = {
    commandKind: "adopt_image" as const,
    platformDraftId: input.platformDraftId,
    expectedLatest,
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

async function readLatestRevision(
  executor: Executor | Transaction,
  workspaceId: string,
  platformDraftId: string,
) {
  const [revision] = await executor
    .select()
    .from(draftRevision)
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
      ),
    )
    .orderBy(desc(draftRevision.revisionNumber))
    .limit(1);
  return revision ?? null;
}

function matchesExpectedLatest(
  latest: RevisionRow | null,
  expected: ExpectedLatest,
) {
  return latest
    ? latest.id === expected.id &&
        latest.revisionNumber === expected.revisionNumber
    : expected.id === null && expected.revisionNumber === null;
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
  input: ExecuteDraftRevisionCommandInput,
  latest: RevisionRow | null,
): Promise<ResolvedRevision> {
  if (input.commandKind === "submit_content") {
    if (!latest) return { status: "not_found" };
    const canonicalHashtag = latest.hashtags[0];
    if (!canonicalHashtag) return { status: "not_found" };
    const hashtags = [
      canonicalHashtag,
      ...input.content.hashtags.filter(
        (hashtag) =>
          hashtag.toLocaleLowerCase() !== canonicalHashtag.toLocaleLowerCase(),
      ),
    ];
    return {
      status: "resolved",
      revision: {
        ...input.content,
        hashtags,
        originatingCopyVariantId: latest.originatingCopyVariantId,
        selectedFinalMediaAssetId: null,
      },
    };
  }

  if (input.commandKind !== "apply_copy_variant") {
    if (!latest) return { status: "not_found" };
    if (input.commandKind === "remove_image") {
      return { status: "resolved", revision: carryContent(latest, null) };
    }
    const [final] = await executor
      .select({
        contentLocale: draftRevision.contentLocale,
        headline: draftRevision.headline,
        body: draftRevision.body,
        hashtags: draftRevision.hashtags,
      })
      .from(mediaAsset)
      .innerJoin(
        imageGeneration,
        and(
          inWorkspace(imageGeneration, workspaceId),
          eq(imageGeneration.finalMediaAssetId, mediaAsset.id),
        ),
      )
      .innerJoin(
        draftRevision,
        and(
          inWorkspace(draftRevision, workspaceId),
          eq(draftRevision.id, imageGeneration.draftRevisionId),
          eq(draftRevision.platformDraftId, input.platformDraftId),
        ),
      )
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, input.finalMediaAssetId),
          eq(mediaAsset.kind, "image_final"),
          eq(mediaAsset.lifecycle, "verified"),
          isNull(mediaAsset.objectRemovedAt),
        ),
      );
    if (!final) return { status: "media_invalid" };
    if (
      final.contentLocale !== latest.contentLocale ||
      final.headline !== latest.headline ||
      final.body !== latest.body ||
      !sameStrings(final.hashtags, latest.hashtags)
    ) {
      return { status: "media_content_mismatch" };
    }
    return {
      status: "resolved",
      revision: carryContent(latest, input.finalMediaAssetId),
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
  return {
    status: "resolved",
    revision: {
      contentLocale: variant.contentLocale,
      headline: variant.headline,
      body: variant.body,
      hashtags: variant.hashtags,
      originatingCopyVariantId: variant.id,
      selectedFinalMediaAssetId: null,
    },
  };
}

function carryContent(
  latest: RevisionRow,
  selectedFinalMediaAssetId: string | null,
): DesiredRevision {
  return {
    contentLocale: latest.contentLocale,
    headline: latest.headline,
    body: latest.body,
    hashtags: latest.hashtags,
    originatingCopyVariantId: latest.originatingCopyVariantId,
    selectedFinalMediaAssetId,
  };
}

function revisionMaterialDiffers(
  latest: RevisionRow | null,
  input: ExecuteDraftRevisionCommandInput,
  desired: DesiredRevision,
) {
  if (!latest) return true;
  const contentDiffers =
    latest.contentLocale !== desired.contentLocale ||
    latest.headline !== desired.headline ||
    latest.body !== desired.body ||
    !sameStrings(latest.hashtags, desired.hashtags);
  if (input.commandKind === "submit_content") return contentDiffers;
  return (
    contentDiffers ||
    latest.originatingCopyVariantId !== desired.originatingCopyVariantId ||
    latest.selectedFinalMediaAssetId !== desired.selectedFinalMediaAssetId
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

async function updateRevisionImage(
  tx: Transaction,
  workspaceId: string,
  revisionId: string,
  selectedFinalMediaAssetId: string | null,
) {
  const [revision] = await tx
    .update(draftRevision)
    .set({ selectedFinalMediaAssetId })
    .where(
      and(
        inWorkspace(draftRevision, workspaceId),
        eq(draftRevision.id, revisionId),
      ),
    )
    .returning();
  if (!revision) throw new Error("draft revision image update lost its fence");
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
