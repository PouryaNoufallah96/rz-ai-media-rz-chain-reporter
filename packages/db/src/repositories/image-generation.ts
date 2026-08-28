import { createHash } from "node:crypto";
import {
  type CreativeImageBrief,
  DURABLE_EVENT_SCHEMA_VERSION,
  type ErrorCode,
  IMAGE_GENERATION_COMMAND_PREFIX,
  OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
  referenceImageMimeTypeSchema,
  type SelectionRejection,
  type TemplateSelection,
  templateSelectionSchema,
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
  notExists,
  or,
  sql,
} from "drizzle-orm";

import { classifyDbError } from "../db-error";
import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace, liveInWorkspace } from "../filters";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { draftRevision } from "../schema/draft-revision";
import { imageBrief } from "../schema/image-brief";
import { imageGeneration } from "../schema/image-generation";
import { imageVarietyMemory } from "../schema/image-variety-memory";
import { mediaAsset } from "../schema/media-asset";
import { mediaBrand } from "../schema/media-brand";
import { mediaDerivation } from "../schema/media-derivation";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import {
  type BoundCopySourceInput,
  loadBoundCopyGenerationSourceInput,
} from "./copy-generation";
import {
  insertOperationIdentity,
  readOperationIdentity,
  resolveOperationIdentityConflict,
  settleClaimedOperation,
} from "./operation";

type OperationRow = typeof operation.$inferSelect;

export const IMAGE_OPERATION_LEASE_MS = 120_000;
export const IMAGE_QUEUED_STALE_MS = 30 * 60 * 1000;
export const FAILED_ORIGINAL_CLEANUP_DELAY_MS = 7 * 24 * 60 * 60 * 1000;
export const BRANDED_FINAL_MEDIA_KIND = "image_final";

export type StartImageGenerationInput = {
  actor: string;
  draftRevisionId: string;
  expectedRevisionVersion: number;
  idempotencyKey: string;
  modelOptionKey: string;
  operatorDirection?: string;
  referenceMediaAssetId?: string;
  requestHash: string;
  requestId: string | null;
};

export type StartImageGenerationResult =
  | {
      status: "created" | "replayed";
      lifecycle: OperationRow["lifecycle"];
      operationId: string;
    }
  | {
      status:
        | "idempotency_mismatch"
        | "image_source_extract_required"
        | "not_found"
        | "operation_in_progress"
        | "reference_conflict"
        | "reference_invalid"
        | "version_conflict";
    };

function replayImageGeneration(existing: OperationRow, requestHash: string) {
  if (existing.requestHash !== requestHash) {
    return { status: "idempotency_mismatch" } as const;
  }
  return {
    status: "replayed",
    lifecycle: existing.lifecycle,
    operationId: existing.id,
  } as const;
}

export async function startImageGeneration(
  executor: Executor,
  workspaceId: string,
  input: StartImageGenerationInput,
): Promise<StartImageGenerationResult> {
  const identity = {
    actor: input.actor,
    commandType: `${IMAGE_GENERATION_COMMAND_PREFIX}start`,
    idempotencyKey: input.idempotencyKey,
    requestHash: input.requestHash,
    requestId: input.requestId,
  };
  const existing = await readOperationIdentity(executor, workspaceId, identity);
  if (existing) return replayImageGeneration(existing, input.requestHash);

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [revision] = await tx
      .select({
        id: draftRevision.id,
        originatingCopyVariantId: draftRevision.originatingCopyVariantId,
        platformDraftId: draftRevision.platformDraftId,
      })
      .from(draftRevision)
      .where(
        and(
          inWorkspace(draftRevision, workspaceId),
          eq(draftRevision.id, input.draftRevisionId),
        ),
      );
    if (!revision) return { status: "not_found" };
    const [draft] = await tx
      .select({
        activeRevisionId: platformDraft.activeRevisionId,
        revisionVersion: platformDraft.revisionVersion,
      })
      .from(platformDraft)
      .where(
        and(
          liveInWorkspace(platformDraft, workspaceId),
          eq(platformDraft.id, revision.platformDraftId),
        ),
      )
      .for("update");
    if (!draft) return { status: "not_found" };
    const serializedReplay = await readOperationIdentity(
      tx,
      workspaceId,
      identity,
    );
    if (serializedReplay) {
      return replayImageGeneration(serializedReplay, input.requestHash);
    }
    if (
      draft.activeRevisionId !== revision.id ||
      draft.revisionVersion !== input.expectedRevisionVersion
    ) {
      return { status: "version_conflict" };
    }

    const source = await loadImageSourceAccessForCopyVariant(
      tx,
      workspaceId,
      revision.originatingCopyVariantId,
    );
    if (source.readiness === "not_found") return { status: "not_found" };
    if (source.readiness === "extract_required") {
      return { status: "image_source_extract_required" };
    }

    let created: OperationRow;
    try {
      created = await insertOperationIdentity(tx, workspaceId, identity);
    } catch (error) {
      if (classifyDbError(error)?.kind !== "operation_identity") throw error;
      const conflict = await resolveOperationIdentityConflict(
        tx,
        workspaceId,
        identity,
        error,
      );
      if (conflict.status === "mismatch") {
        return { status: "idempotency_mismatch" };
      }
      return replayImageGeneration(conflict.operation, input.requestHash);
    }

    const [busy] = await tx
      .select({ operationId: imageGeneration.operationId })
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
          eq(imageGeneration.draftRevisionId, revision.id),
          inArray(operation.lifecycle, ["queued", "running", "settling"]),
        ),
      )
      .limit(1);
    if (busy) {
      await tx
        .delete(operation)
        .where(
          and(
            inWorkspace(operation, workspaceId),
            eq(operation.id, created.id),
          ),
        );
      return { status: "operation_in_progress" };
    }

    if (input.referenceMediaAssetId) {
      const [reference] = await tx
        .select()
        .from(mediaAsset)
        .where(
          and(
            inWorkspace(mediaAsset, workspaceId),
            eq(mediaAsset.id, input.referenceMediaAssetId),
          ),
        )
        .for("update");
      if (
        reference?.lifecycle !== "verified" ||
        reference.objectRemovedAt !== null ||
        reference.checksum === null ||
        !referenceImageMimeTypeSchema.safeParse(reference.mimeType).success
      ) {
        await tx
          .delete(operation)
          .where(
            and(
              inWorkspace(operation, workspaceId),
              eq(operation.id, created.id),
            ),
          );
        return { status: "reference_invalid" };
      }
      const [attached] = await tx
        .select({ platformDraftId: draftRevision.platformDraftId })
        .from(imageGeneration)
        .innerJoin(
          draftRevision,
          and(
            eq(draftRevision.id, imageGeneration.draftRevisionId),
            eq(draftRevision.workspaceId, imageGeneration.workspaceId),
          ),
        )
        .where(
          and(
            inWorkspace(imageGeneration, workspaceId),
            eq(imageGeneration.referenceMediaAssetId, reference.id),
          ),
        )
        .limit(1);
      if (attached && attached.platformDraftId !== revision.platformDraftId) {
        await tx
          .delete(operation)
          .where(
            and(
              inWorkspace(operation, workspaceId),
              eq(operation.id, created.id),
            ),
          );
        return { status: "reference_conflict" };
      }
      await tx
        .update(mediaAsset)
        .set({
          cleanupAfter: null,
          updatedAt: new Date(),
          version: reference.version + 1,
        })
        .where(
          and(
            inWorkspace(mediaAsset, workspaceId),
            eq(mediaAsset.id, reference.id),
            eq(mediaAsset.version, reference.version),
          ),
        );
    }

    await tx.insert(imageGeneration).values({
      operationId: created.id,
      workspaceId,
      draftRevisionId: revision.id,
      expectedRevisionVersion: input.expectedRevisionVersion,
      modelOptionKey: input.modelOptionKey,
      operatorDirection: input.operatorDirection,
      referenceMediaAssetId: input.referenceMediaAssetId,
    });
    await insertImageWake(tx, workspaceId, created.id);
    return {
      status: "created",
      lifecycle: created.lifecycle,
      operationId: created.id,
    };
  });
}

export function imageSourceProjectionReadiness(
  source:
    | BoundCopySourceInput
    | {
        kind: "rss";
        limited: boolean;
        pageContentHash: string | null;
        sourceItemEnrichmentId: string | null;
      },
) {
  return source.kind !== "rss" ||
    (!source.limited &&
      source.sourceItemEnrichmentId !== null &&
      source.pageContentHash !== null)
    ? ("ready" as const)
    : ("extract_required" as const);
}

async function loadImageSourceAccessForCopyVariant(
  executor: Executor,
  workspaceId: string,
  copyVariantId: string,
) {
  const [variant] = await executor
    .select({
      copyGenerationId: copyGenerationUnit.copyGenerationId,
      limited: copyGeneration.limited,
      origin: sourceItem.origin,
      pageContentHash: copyGeneration.pageContentHash,
      sourceItemEnrichmentId: copyGeneration.sourceItemEnrichmentId,
    })
    .from(copyVariant)
    .innerJoin(
      copyGenerationUnit,
      and(
        eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
        eq(copyGenerationUnit.workspaceId, copyVariant.workspaceId),
      ),
    )
    .innerJoin(
      copyGeneration,
      and(
        eq(copyGeneration.operationId, copyGenerationUnit.copyGenerationId),
        eq(copyGeneration.workspaceId, copyGenerationUnit.workspaceId),
      ),
    )
    .leftJoin(
      sourceItemRevision,
      and(
        eq(sourceItemRevision.id, copyGeneration.sourceItemRevisionId),
        eq(sourceItemRevision.workspaceId, copyGeneration.workspaceId),
      ),
    )
    .leftJoin(
      sourceItem,
      and(
        eq(sourceItem.id, sourceItemRevision.sourceItemId),
        eq(sourceItem.workspaceId, sourceItemRevision.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(copyVariant, workspaceId),
        eq(copyVariant.id, copyVariantId),
      ),
    );
  if (!variant) return { readiness: "not_found" as const, source: null };
  const source = await loadBoundCopyGenerationSourceInput(
    executor,
    workspaceId,
    variant.copyGenerationId,
  );
  if (source) {
    return { readiness: imageSourceProjectionReadiness(source), source };
  }
  if (variant.origin === "rss") {
    const readiness = imageSourceProjectionReadiness({
      kind: "rss",
      limited: variant.limited,
      pageContentHash: variant.pageContentHash,
      sourceItemEnrichmentId: variant.sourceItemEnrichmentId,
    });
    return {
      readiness: readiness === "extract_required" ? readiness : "not_found",
      source: null,
    };
  }
  return { readiness: "not_found" as const, source: null };
}

export async function findImageExecutionContext(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      operationId: operation.id,
      actor: operation.actor,
      operationLifecycle: operation.lifecycle,
      operationVersion: operation.version,
      claimedBy: operation.claimedBy,
      contentLocale: draftRevision.contentLocale,
      draftRevisionId: imageGeneration.draftRevisionId,
      expectedRevisionVersion: imageGeneration.expectedRevisionVersion,
      imageBriefId: imageGeneration.imageBriefId,
      modelOptionKey: imageGeneration.modelOptionKey,
      referenceMediaAssetId: imageGeneration.referenceMediaAssetId,
      providerOriginalMediaAssetId:
        imageGeneration.providerOriginalMediaAssetId,
      finalMediaAssetId: imageGeneration.finalMediaAssetId,
      platformDraftId: draftRevision.platformDraftId,
      workspaceId: imageGeneration.workspaceId,
      mediaBrandId: platformDraft.mediaBrandId,
      mediaBrandKey: mediaBrand.key,
      originatingCopyVariantId: draftRevision.originatingCopyVariantId,
      copyOperationId: copyGenerationUnit.copyGenerationId,
    })
    .from(imageGeneration)
    .innerJoin(
      operation,
      and(
        eq(operation.id, imageGeneration.operationId),
        eq(operation.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      draftRevision,
      and(
        eq(draftRevision.id, imageGeneration.draftRevisionId),
        eq(draftRevision.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        eq(platformDraft.id, draftRevision.platformDraftId),
        eq(platformDraft.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      copyVariant,
      and(
        eq(copyVariant.id, draftRevision.originatingCopyVariantId),
        eq(copyVariant.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      copyGenerationUnit,
      and(
        eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
        eq(copyGenerationUnit.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      mediaBrand,
      and(
        eq(mediaBrand.id, platformDraft.mediaBrandId),
        eq(mediaBrand.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.operationId, operationId),
      ),
    );
  return row ?? null;
}

export async function loadAuthorizedImageSource(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const context = await findImageExecutionContext(
    executor,
    workspaceId,
    operationId,
  );
  if (!context) return null;
  const source = await loadImageSourceAccessForCopyVariant(
    executor,
    workspaceId,
    context.originatingCopyVariantId,
  );
  return source.source ? { context, source: source.source } : null;
}

export async function loadAuthorizedImageSourceAccess(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const context = await findImageExecutionContext(
    executor,
    workspaceId,
    operationId,
  );
  if (!context) {
    return { context: null, readiness: "not_found" as const, source: null };
  }
  const access = await loadImageSourceAccessForCopyVariant(
    executor,
    workspaceId,
    context.originatingCopyVariantId,
  );
  return { context, ...access };
}

export async function findOldestImageOperationForBrand(
  executor: Executor,
  workspaceId: string,
  mediaBrandId: string,
) {
  const [row] = await executor
    .select({ operationId: imageGeneration.operationId })
    .from(imageGeneration)
    .innerJoin(
      operation,
      and(
        eq(operation.id, imageGeneration.operationId),
        eq(operation.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      draftRevision,
      and(
        eq(draftRevision.id, imageGeneration.draftRevisionId),
        eq(draftRevision.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        eq(platformDraft.id, draftRevision.platformDraftId),
        eq(platformDraft.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(platformDraft.mediaBrandId, mediaBrandId),
        inArray(operation.lifecycle, ["queued", "running", "settling"]),
      ),
    )
    .orderBy(asc(operation.createdAt), asc(operation.id))
    .limit(1);
  return row?.operationId ?? null;
}

export async function listLatestImageVarietySignatures(
  executor: Executor,
  workspaceId: string,
  mediaBrandId: string,
) {
  return executor
    .select({
      id: imageVarietyMemory.id,
      signature: imageVarietyMemory.selectionSignature,
    })
    .from(imageVarietyMemory)
    .where(
      and(
        inWorkspace(imageVarietyMemory, workspaceId),
        eq(imageVarietyMemory.mediaBrandId, mediaBrandId),
      ),
    )
    .orderBy(desc(imageVarietyMemory.createdAt), desc(imageVarietyMemory.id))
    .limit(10);
}

export async function inspectImageAttemptTruth(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const rows = await executor
    .select({
      attemptId: operationAttempt.id,
      attemptOutcome: operationAttempt.outcome,
      usageId: aiUsageEvent.id,
      usageStatus: aiUsageEvent.status,
    })
    .from(operationAttempt)
    .leftJoin(
      aiUsageEvent,
      and(
        eq(aiUsageEvent.operationAttemptId, operationAttempt.id),
        eq(aiUsageEvent.workspaceId, operationAttempt.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.operationId, operationId),
      ),
    );
  return {
    hasAmbiguousPaidWork: rows.some((row) =>
      (["pending", "unknown"] as const).includes(
        row.usageStatus as "pending" | "unknown",
      ),
    ),
    hasPendingPaidWork: rows.some((row) => row.usageStatus === "pending"),
    rows,
  };
}

export async function listImageStageUsage(
  executor: Executor,
  workspaceId: string,
  operationAttemptId: string,
) {
  return executor
    .select({
      id: aiUsageEvent.id,
      invocationKey: aiUsageEvent.invocationKey,
      operationAttemptId: aiUsageEvent.operationAttemptId,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationAttemptId, operationAttemptId),
      ),
    );
}

export async function allocateImageStageAttempt(
  executor: Executor,
  workspaceId: string,
  input: {
    operationId: string;
    claimedBy: string;
    expectedVersion: number;
    stage: "selection" | "creative" | "final" | "provider";
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, input.expectedVersion),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, new Date()),
        ),
      )
      .for("update");
    if (!current) return null;
    const attemptId = stableImageIdentity(input.operationId, input.stage);
    const [existing] = await tx
      .select()
      .from(operationAttempt)
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, attemptId),
          eq(operationAttempt.operationId, input.operationId),
        ),
      );
    if (existing) return { attempt: existing, operation: current };
    const [attempt] = await tx
      .insert(operationAttempt)
      .values({
        id: attemptId,
        workspaceId,
        operationId: input.operationId,
        attemptNumber: current.attemptSeq + 1,
      })
      .returning();
    if (!attempt) throw new Error("image stage attempt insert returned no row");
    const [updated] = await tx
      .update(operation)
      .set({ attemptSeq: current.attemptSeq + 1, version: current.version + 1 })
      .where(
        and(
          eq(operation.id, current.id),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, current.version),
        ),
      )
      .returning();
    return updated ? { attempt, operation: updated } : null;
  });
}

export function stableImageIdentity(operationId: string, role: string) {
  const hex = createHash("sha256")
    .update(`image:${operationId}:${role}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function createImageBrief(
  executor: Executor,
  workspaceId: string,
  input: {
    operationId: string;
    claimedBy: string;
    expectedVersion: number;
    selectionAttemptId: string;
    source: {
      kind: "promo_idea" | "rss_extract" | "telegram_post";
      id: string;
      digest: string;
      version: string;
      secondaryDigest?: string;
    };
    brandPolicyFingerprint: string;
    imageProfileFingerprint: string;
    configurationVersion: string;
    assemblerVersion: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [context] = await tx
      .select({ generation: imageGeneration, current: operation })
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
          eq(imageGeneration.operationId, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, input.expectedVersion),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, new Date()),
        ),
      )
      .for("update");
    if (!context) return null;
    if (context.generation.imageBriefId) {
      if (context.generation.operatorDirection !== null) {
        throw new Error("bound image generation retained operator direction");
      }
      return context.generation.imageBriefId;
    }
    const sourceValues =
      input.source.kind === "rss_extract"
        ? {
            rssSourceItemEnrichmentId: input.source.id,
            rssPageContentHash:
              input.source.secondaryDigest ?? input.source.digest,
          }
        : input.source.kind === "telegram_post"
          ? {
              telegramSourceItemRevisionId: input.source.id,
              telegramContentHash:
                input.source.secondaryDigest ?? input.source.digest,
            }
          : { promoIdeaId: input.source.id };
    const [brief] = await tx
      .insert(imageBrief)
      .values({
        workspaceId,
        draftRevisionId: context.generation.draftRevisionId,
        templateSelectionOperationAttemptId: input.selectionAttemptId,
        operatorDirection: context.generation.operatorDirection,
        sourceProjectionKind: input.source.kind,
        sourceProjectionVersion: input.source.version,
        sourceProjectionDigest: input.source.digest,
        brandPolicyFingerprint: input.brandPolicyFingerprint,
        imageProfileFingerprint: input.imageProfileFingerprint,
        promptSchemaVersion: "image-prompt-v1",
        assemblerVersion: input.assemblerVersion,
        configurationVersion: input.configurationVersion,
        ...sourceValues,
      })
      .returning({ id: imageBrief.id });
    if (!brief) throw new Error("image brief insert returned no row");
    const [bound] = await tx
      .update(imageGeneration)
      .set({
        imageBriefId: brief.id,
        operatorDirection: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          inWorkspace(imageGeneration, workspaceId),
          eq(imageGeneration.operationId, input.operationId),
          isNull(imageGeneration.imageBriefId),
        ),
      )
      .returning({ id: imageGeneration.operationId });
    if (!bound) throw new Error("image brief binding fence lost");
    return brief.id;
  });
}

export async function persistImageSelection(
  tx: Transaction,
  workspaceId: string,
  input: {
    imageBriefId: string;
    selection: TemplateSelection;
    rejections: SelectionRejection[];
    fallback: boolean;
    fallbackCode?: ErrorCode;
    varietyDegraded?: boolean;
  },
) {
  const [updated] = await tx
    .update(imageBrief)
    .set({
      deterministicFallback: input.fallback,
      fallbackCode: input.fallbackCode,
      selectionRejections: input.rejections,
      status: "running",
      templateSelection: input.selection,
      varietyDegraded: input.varietyDegraded ?? false,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(imageBrief, workspaceId),
        eq(imageBrief.id, input.imageBriefId),
        inArray(imageBrief.status, ["pending", "running"]),
      ),
    )
    .returning();
  if (!updated) throw new Error("image selection lost its brief");
}

type ImageClaimFence = {
  operationId: string;
  attemptId: string;
  claimedBy: string;
  expectedVersion: number;
};

type ImageSelectionSettlement =
  | { outcome: "succeeded"; failureCode?: never }
  | { outcome: "failed_terminal"; failureCode: "VALIDATION_FAILED" };

async function lockImageClaim(
  tx: Transaction,
  workspaceId: string,
  input: ImageClaimFence,
) {
  const now = new Date();
  const [current] = await tx
    .select({ generation: imageGeneration, operation })
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
        eq(imageGeneration.operationId, input.operationId),
        eq(operation.claimedBy, input.claimedBy),
        eq(operation.version, input.expectedVersion),
        eq(operation.lifecycle, "running"),
        gt(operation.leaseExpiresAt, now),
      ),
    )
    .for("update");
  if (!current) return null;
  const [attempt] = await tx
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
  return attempt ? current : null;
}

async function lockImageSelectionClaim(
  tx: Transaction,
  workspaceId: string,
  input: ImageClaimFence & { imageBriefId: string },
) {
  const now = new Date();
  const [current] = await tx
    .select({ brief: imageBrief, generation: imageGeneration, operation })
    .from(imageGeneration)
    .innerJoin(
      operation,
      and(
        eq(operation.id, imageGeneration.operationId),
        eq(operation.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      imageBrief,
      and(
        eq(imageBrief.id, imageGeneration.imageBriefId),
        eq(imageBrief.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.operationId, input.operationId),
        eq(operation.claimedBy, input.claimedBy),
        eq(operation.version, input.expectedVersion),
        eq(operation.lifecycle, "running"),
        gt(operation.leaseExpiresAt, now),
      ),
    )
    .for("update");
  if (!current) return null;
  if (
    current.brief.id !== input.imageBriefId ||
    current.brief.templateSelectionOperationAttemptId !== input.attemptId
  ) {
    throw new Error("image selection attempt identity is contradictory");
  }
  const [attempt] = await tx
    .select()
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.id, input.attemptId),
        eq(operationAttempt.operationId, input.operationId),
      ),
    )
    .for("update");
  if (!attempt) {
    throw new Error("image selection attempt identity is contradictory");
  }
  return { ...current, attempt };
}

async function settleImageSelectionAttempt(
  tx: Transaction,
  workspaceId: string,
  input: ImageClaimFence & ImageSelectionSettlement,
) {
  const [settled] = await tx
    .update(operationAttempt)
    .set({
      failureCode: input.failureCode ?? null,
      outcome: input.outcome,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.id, input.attemptId),
        eq(operationAttempt.operationId, input.operationId),
        isNull(operationAttempt.outcome),
      ),
    )
    .returning({ id: operationAttempt.id });
  if (!settled) throw new Error("image selection attempt settlement lost");
}

export async function persistImageSelectionCompletionInTransaction(
  tx: Transaction,
  workspaceId: string,
  input: ImageClaimFence &
    Parameters<typeof persistImageSelection>[2] &
    ImageSelectionSettlement,
) {
  const current = await lockImageSelectionClaim(tx, workspaceId, input);
  if (!current) return false;
  if (current.brief.templateSelection || current.attempt.outcome !== null) {
    throw new Error("new image selection completion found durable truth");
  }
  await persistImageSelection(tx, workspaceId, input);
  await settleImageSelectionAttempt(tx, workspaceId, input);
  return true;
}

export async function persistClaimedImageSelectionCompletion(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence &
    Parameters<typeof persistImageSelection>[2] &
    ImageSelectionSettlement,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    return persistImageSelectionCompletionInTransaction(tx, workspaceId, input);
  });
}

export async function reconcileClaimedImageSelectionCompletion(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & { imageBriefId: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockImageSelectionClaim(tx, workspaceId, input);
    if (!current) return false;
    if (!current.brief.templateSelection) {
      throw new Error("image selection completion has no persisted selection");
    }
    const settlement: ImageSelectionSettlement = current.brief
      .deterministicFallback
      ? {
          failureCode: "VALIDATION_FAILED",
          outcome: "failed_terminal",
        }
      : { outcome: "succeeded" };
    if (
      current.brief.deterministicFallback &&
      current.brief.fallbackCode !== "VALIDATION_FAILED"
    ) {
      throw new Error("image selection fallback truth is contradictory");
    }
    if (current.attempt.outcome === null) {
      await settleImageSelectionAttempt(tx, workspaceId, {
        ...input,
        ...settlement,
      });
      return true;
    }
    if (
      current.attempt.outcome !== settlement.outcome ||
      current.attempt.failureCode !== (settlement.failureCode ?? null)
    ) {
      throw new Error("image selection attempt truth is contradictory");
    }
    return true;
  });
}

export async function persistClaimedImageSelection(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & Parameters<typeof persistImageSelection>[2],
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockImageClaim(tx, workspaceId, input);
    if (current?.generation.imageBriefId !== input.imageBriefId) return false;
    await persistImageSelection(tx, workspaceId, input);
    return true;
  });
}

export async function persistImageSelectionRejection(
  tx: Transaction,
  workspaceId: string,
  input: { imageBriefId: string; rejection: SelectionRejection },
) {
  const [updated] = await tx
    .update(imageBrief)
    .set({
      selectionRejections: sql`${imageBrief.selectionRejections} || ${JSON.stringify([input.rejection])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(imageBrief, workspaceId),
        eq(imageBrief.id, input.imageBriefId),
        inArray(imageBrief.status, ["pending", "running"]),
        sql`not exists (select 1 from jsonb_array_elements(${imageBrief.selectionRejections}) item where item->>'invocationKey' = ${input.rejection.invocationKey})`,
      ),
    )
    .returning({ id: imageBrief.id });
  if (!updated) throw new Error("image selection rejection lost its brief");
}

export async function persistImageCreativeStructuredFailure(
  tx: Transaction,
  workspaceId: string,
  input: {
    code: ErrorCode;
    hasMoreSlots: boolean;
    imageBriefId: string;
    operationAttemptId: string;
    operationId: string;
  },
) {
  await withWorkspaceContext(tx, workspaceId);
  if (input.hasMoreSlots) return;
  const now = new Date();
  const [failedBrief] = await tx
    .update(imageBrief)
    .set({
      creativeBriefOperationAttemptId: input.operationAttemptId,
      status: "failed",
      terminalFailureCode: input.code,
      updatedAt: now,
    })
    .where(
      and(
        inWorkspace(imageBrief, workspaceId),
        eq(imageBrief.id, input.imageBriefId),
        eq(imageBrief.status, "running"),
      ),
    )
    .returning({ id: imageBrief.id });
  if (!failedBrief) throw new Error("image creative failure lost its brief");
  const [failedAttempt] = await tx
    .update(operationAttempt)
    .set({
      failureCode: input.code,
      outcome: "failed_terminal",
      updatedAt: now,
    })
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.id, input.operationAttemptId),
        eq(operationAttempt.operationId, input.operationId),
        isNull(operationAttempt.outcome),
      ),
    )
    .returning({ id: operationAttempt.id });
  if (!failedAttempt)
    throw new Error("image creative failure lost its attempt");
}

export async function persistImageCreativeBrief(
  tx: Transaction,
  workspaceId: string,
  input: {
    imageBriefId: string;
    creativeBriefAttemptId: string | null;
    creativeBrief: CreativeImageBrief;
    providerPrompt: string;
    providerPromptDigest: string;
  },
) {
  const [updated] = await tx
    .update(imageBrief)
    .set({
      creativeBrief: input.creativeBrief,
      creativeBriefOperationAttemptId: input.creativeBriefAttemptId,
      providerPrompt: input.providerPrompt,
      providerPromptDigest: input.providerPromptDigest,
      status: "succeeded",
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(imageBrief, workspaceId),
        eq(imageBrief.id, input.imageBriefId),
        eq(imageBrief.status, "running"),
      ),
    )
    .returning();
  if (!updated) throw new Error("image creative brief lost its brief");
}

export async function persistClaimedImageCreativeBrief(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & Parameters<typeof persistImageCreativeBrief>[2],
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockImageClaim(tx, workspaceId, input);
    if (current?.generation.imageBriefId !== input.imageBriefId) return false;
    await persistImageCreativeBrief(tx, workspaceId, input);
    return true;
  });
}

export async function persistClaimedImageCreativeFailure(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & { code: ErrorCode; imageBriefId: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockImageClaim(tx, workspaceId, input);
    if (current?.generation.imageBriefId !== input.imageBriefId) return false;
    await persistImageCreativeStructuredFailure(tx, workspaceId, {
      code: input.code,
      hasMoreSlots: false,
      imageBriefId: input.imageBriefId,
      operationAttemptId: input.attemptId,
      operationId: input.operationId,
    });
    return true;
  });
}

export async function loadImageProviderInput(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      generation: imageGeneration,
      brief: imageBrief,
      reference: mediaAsset,
    })
    .from(imageGeneration)
    .innerJoin(
      imageBrief,
      and(
        eq(imageBrief.id, imageGeneration.imageBriefId),
        eq(imageBrief.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .leftJoin(
      mediaAsset,
      eq(mediaAsset.id, imageGeneration.referenceMediaAssetId),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.operationId, operationId),
      ),
    );
  if (!row) return null;
  return {
    ...row,
    brief: {
      ...row.brief,
      templateSelection:
        row.brief.templateSelection === null
          ? null
          : templateSelectionSchema.parse(row.brief.templateSelection),
    },
  };
}

export async function reserveProviderOriginal(
  executor: Executor,
  workspaceId: string,
  input: {
    operationId: string;
    attemptId: string;
    claimedBy: string;
    expectedVersion: number;
    mediaAssetId: string;
    objectKey: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockImageClaim(tx, workspaceId, input);
    if (!current || current.generation.providerOriginalMediaAssetId) {
      return { status: "not_owned" as const };
    }
    if (current.generation.referenceMediaAssetId) {
      const [reference] = await tx
        .select()
        .from(mediaAsset)
        .where(
          and(
            inWorkspace(mediaAsset, workspaceId),
            eq(mediaAsset.id, current.generation.referenceMediaAssetId),
          ),
        )
        .for("update");
      if (
        reference?.lifecycle !== "verified" ||
        reference.objectRemovedAt ||
        !reference.checksum ||
        !referenceImageMimeTypeSchema.safeParse(reference.mimeType).success
      ) {
        return { status: "reference_invalid" as const };
      }
    }
    const [existing] = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, input.mediaAssetId),
          eq(mediaAsset.objectKey, input.objectKey),
        ),
      );
    if (existing) {
      return existing.lifecycle === "pending"
        ? { status: "reserved" as const, asset: existing }
        : { status: "not_owned" as const };
    }
    const [asset] = await tx
      .insert(mediaAsset)
      .values({
        actualBytes: null,
        checksum: null,
        declaredBytes: 0,
        height: null,
        id: input.mediaAssetId,
        kind: "provider_original",
        lifecycle: "pending",
        mimeType: "application/octet-stream",
        objectKey: input.objectKey,
        width: null,
        workspaceId,
      })
      .returning();
    if (!asset)
      throw new Error("provider original reservation returned no row");
    return { status: "reserved" as const, asset };
  });
}

export async function rejectReservedProviderOriginal(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & {
    mediaAssetId: string;
    objectKey: string;
    objectRemovedAt?: Date;
  },
) {
  const now = input.objectRemovedAt ?? new Date();
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    if (!(await lockImageClaim(tx, workspaceId, input))) return "uncertain";
    const [updated] = await tx
      .update(mediaAsset)
      .set({
        lifecycle: "rejected",
        objectRemovedAt: now,
        rejectionReason: "provider_original_invalid",
        updatedAt: now,
        version: sql`${mediaAsset.version} + 1`,
      })
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, input.mediaAssetId),
          eq(mediaAsset.objectKey, input.objectKey),
          eq(mediaAsset.lifecycle, "pending"),
          isNull(mediaAsset.objectRemovedAt),
        ),
      )
      .returning({ id: mediaAsset.id });
    return updated ? "rejected" : "uncertain";
  });
}

export async function resolveProviderOriginalCommit(
  executor: Executor,
  workspaceId: string,
  input: {
    operationId: string;
    attemptId: string;
    usageEventId: string;
    mediaAssetId: string;
    objectKey: string;
    claimedBy: string;
    expectedVersion: number;
  },
) {
  try {
    return await executor.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      const current = await lockImageClaim(tx, workspaceId, input);
      if (!current) return "uncertain" as const;
      const [asset] = await tx
        .select({ lifecycle: mediaAsset.lifecycle })
        .from(mediaAsset)
        .where(
          and(
            inWorkspace(mediaAsset, workspaceId),
            eq(mediaAsset.id, input.mediaAssetId),
            eq(mediaAsset.objectKey, input.objectKey),
          ),
        )
        .for("update");
      const [usage] = await tx
        .select({ status: aiUsageEvent.status })
        .from(aiUsageEvent)
        .where(
          and(
            inWorkspace(aiUsageEvent, workspaceId),
            eq(aiUsageEvent.id, input.usageEventId),
            eq(aiUsageEvent.operationId, input.operationId),
            eq(aiUsageEvent.operationAttemptId, input.attemptId),
          ),
        )
        .for("update");
      return classifyProviderOriginalTruth(
        {
          attachedId: current.generation.providerOriginalMediaAssetId,
          assetLifecycle: asset?.lifecycle ?? null,
          usageStatus: usage?.status ?? null,
        },
        { mediaAssetId: input.mediaAssetId },
      );
    });
  } catch {
    return "uncertain";
  }
}

export function classifyProviderOriginalTruth(
  row:
    | {
        attachedId: string | null;
        assetLifecycle: string | null;
        usageStatus: string | null;
      }
    | undefined,
  expected: { mediaAssetId: string },
) {
  if (!row) return "uncertain" as const;
  if (
    row.attachedId === expected.mediaAssetId &&
    row.assetLifecycle === "verified" &&
    row.usageStatus === "succeeded"
  ) {
    return "committed" as const;
  }
  if (
    row.attachedId === null &&
    row.assetLifecycle === "pending" &&
    row.usageStatus === "pending"
  ) {
    return "absent" as const;
  }
  return "uncertain" as const;
}

export async function markCompensatedProviderOriginal(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & { mediaAssetId: string; objectKey: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    if (!(await lockImageClaim(tx, workspaceId, input))) {
      return { status: "uncertain" as const };
    }
    const now = new Date();
    const [updated] = await tx
      .update(mediaAsset)
      .set({
        lifecycle: "rejected",
        rejectionReason: "provider_original_invalid",
        updatedAt: now,
        version: sql`${mediaAsset.version} + 1`,
      })
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, input.mediaAssetId),
          eq(mediaAsset.objectKey, input.objectKey),
          eq(mediaAsset.lifecycle, "pending"),
          isNull(mediaAsset.objectRemovedAt),
        ),
      )
      .returning({
        id: mediaAsset.id,
        lifecycle: mediaAsset.lifecycle,
        version: mediaAsset.version,
      });
    return updated
      ? { status: "rejected" as const, asset: updated }
      : { status: "uncertain" as const };
  });
}

export async function attachProviderOriginal(
  tx: Transaction,
  workspaceId: string,
  input: {
    operationId: string;
    attemptId: string;
    claimedBy: string;
    expectedVersion: number;
    media: {
      id: string;
      objectKey: string;
      mimeType: string;
      actualBytes: number;
      checksum: string;
      width: number;
      height: number;
    };
  },
) {
  const current = await lockImageClaim(tx, workspaceId, input);
  if (!current)
    throw new Error("image claim fence lost before original attach");
  if (current.generation.providerOriginalMediaAssetId) {
    throw new Error("provider original already attached");
  }
  const [asset] = await tx
    .update(mediaAsset)
    .set({
      actualBytes: input.media.actualBytes,
      checksum: input.media.checksum,
      declaredBytes: input.media.actualBytes,
      height: input.media.height,
      lifecycle: "verified",
      mimeType: input.media.mimeType,
      updatedAt: new Date(),
      verifiedAt: new Date(),
      version: sql`${mediaAsset.version} + 1`,
      width: input.media.width,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, input.media.id),
        eq(mediaAsset.objectKey, input.media.objectKey),
        eq(mediaAsset.lifecycle, "pending"),
      ),
    )
    .returning({ id: mediaAsset.id });
  if (!asset) throw new Error("reserved provider original was not pending");
  const [attached] = await tx
    .update(imageGeneration)
    .set({
      providerGenerationOperationAttemptId: input.attemptId,
      providerOriginalMediaAssetId: input.media.id,
      updatedAt: new Date(),
    })
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.operationId, input.operationId),
        isNull(imageGeneration.providerOriginalMediaAssetId),
      ),
    )
    .returning({ id: imageGeneration.operationId });
  if (!attached) throw new Error("provider original attach fence lost");
}

export type AttachBrandedFinalResult =
  | "attached"
  | "not_owned"
  | "original_invalid"
  | "replayed";

export async function attachBrandedFinal(
  executor: Executor,
  workspaceId: string,
  input: ImageClaimFence & {
    mediaBrandId: string;
    selectionSignature: string;
    media: {
      id: string;
      objectKey: string;
      mimeType: string;
      actualBytes: number;
      checksum: string;
      width: number;
      height: number;
    };
  },
): Promise<AttachBrandedFinalResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const current = await lockImageClaim(tx, workspaceId, input);
    if (!current) return "not_owned";
    const originalId = current.generation.providerOriginalMediaAssetId;
    if (!originalId) return "not_owned";
    if (current.generation.finalMediaAssetId) {
      return current.generation.finalMediaAssetId === input.media.id
        ? "replayed"
        : "not_owned";
    }
    const [original] = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(
          inWorkspace(mediaAsset, workspaceId),
          eq(mediaAsset.id, originalId),
        ),
      )
      .for("update");
    if (original?.lifecycle !== "verified" || original.objectRemovedAt) {
      return "original_invalid";
    }
    const now = new Date();
    await tx.insert(mediaAsset).values({
      actualBytes: input.media.actualBytes,
      checksum: input.media.checksum,
      declaredBytes: input.media.actualBytes,
      height: input.media.height,
      id: input.media.id,
      kind: BRANDED_FINAL_MEDIA_KIND,
      lifecycle: "verified",
      mimeType: input.media.mimeType,
      objectKey: input.media.objectKey,
      verifiedAt: now,
      width: input.media.width,
      workspaceId,
    });
    await tx.insert(mediaDerivation).values({
      derivedMediaAssetId: input.media.id,
      purpose: "sharp_brand_logo",
      sourceMediaAssetId: originalId,
      workspaceId,
    });
    const [attached] = await tx
      .update(imageGeneration)
      .set({ finalMediaAssetId: input.media.id, updatedAt: now })
      .where(
        and(
          inWorkspace(imageGeneration, workspaceId),
          eq(imageGeneration.operationId, input.operationId),
          eq(imageGeneration.providerOriginalMediaAssetId, originalId),
          isNull(imageGeneration.finalMediaAssetId),
        ),
      )
      .returning({ id: imageGeneration.operationId });
    if (!attached) throw new Error("branded final attach fence lost");
    await tx.insert(imageVarietyMemory).values({
      imageGenerationId: input.operationId,
      mediaBrandId: input.mediaBrandId,
      selectionSignature: input.selectionSignature,
      workspaceId,
    });
    return "attached";
  });
}

export async function findServableFinalMedia(
  executor: Executor,
  workspaceId: string,
  mediaAssetId: string,
) {
  const [row] = await executor
    .select({
      actualBytes: mediaAsset.actualBytes,
      checksum: mediaAsset.checksum,
      mimeType: mediaAsset.mimeType,
      objectKey: mediaAsset.objectKey,
    })
    .from(mediaAsset)
    .leftJoin(
      imageGeneration,
      and(
        eq(imageGeneration.finalMediaAssetId, mediaAsset.id),
        eq(imageGeneration.workspaceId, mediaAsset.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, mediaAssetId),
        or(
          eq(mediaAsset.kind, "image"),
          and(
            eq(mediaAsset.kind, BRANDED_FINAL_MEDIA_KIND),
            isNotNull(imageGeneration.operationId),
          ),
        ),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
      ),
    );
  if (!row || row.actualBytes === null || row.checksum === null) return null;
  const mimeType = referenceImageMimeTypeSchema.safeParse(row.mimeType);
  if (!mimeType.success) return null;
  return {
    actualBytes: row.actualBytes,
    checksum: row.checksum,
    mimeType: mimeType.data,
    objectKey: row.objectKey,
  };
}

async function retainProviderOriginal(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
  now: Date,
) {
  const [generation] = await tx
    .select({
      finalId: imageGeneration.finalMediaAssetId,
      originalId: imageGeneration.providerOriginalMediaAssetId,
    })
    .from(imageGeneration)
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(imageGeneration.operationId, operationId),
      ),
    );
  if (!generation?.originalId || generation.finalId) return;
  await tx
    .update(mediaAsset)
    .set({
      cleanupAfter: new Date(now.getTime() + FAILED_ORIGINAL_CLEANUP_DELAY_MS),
      updatedAt: now,
      version: sql`${mediaAsset.version} + 1`,
    })
    .where(
      and(
        inWorkspace(mediaAsset, workspaceId),
        eq(mediaAsset.id, generation.originalId),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.cleanupAfter),
        isNull(mediaAsset.objectRemovedAt),
      ),
    );
}

export async function releaseImageOperationAndWake(
  executor: Executor,
  workspaceId: string,
  input: { claimedBy: string; expectedVersion: number; operationId: string },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [released] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: "queued",
        updatedAt: new Date(),
        version: input.expectedVersion + 1,
      })
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, input.claimedBy),
          eq(operation.version, input.expectedVersion),
          eq(operation.lifecycle, "running"),
        ),
      )
      .returning();
    if (!released) return null;
    await insertImageWake(tx, workspaceId, input.operationId);
    return released;
  });
}

export async function settleImageOperationAndWakeNext(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string;
    expectedVersion: number;
    lifecycle: "cancelled" | "failed" | "succeeded" | "unknown";
    mediaBrandId: string;
    operationId: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const settled = await settleClaimedOperation(tx, workspaceId, {
      claimedBy: input.claimedBy,
      expectedVersion: input.expectedVersion,
      id: input.operationId,
      lifecycle: input.lifecycle,
    });
    if (!settled) return null;
    if (settled.lifecycle === "failed" || settled.lifecycle === "cancelled") {
      await retainProviderOriginal(
        tx,
        workspaceId,
        input.operationId,
        settled.updatedAt,
      );
    }
    const [next] = await tx
      .select({ operationId: imageGeneration.operationId })
      .from(imageGeneration)
      .innerJoin(
        operation,
        and(
          eq(operation.id, imageGeneration.operationId),
          eq(operation.workspaceId, imageGeneration.workspaceId),
        ),
      )
      .innerJoin(
        draftRevision,
        and(
          eq(draftRevision.id, imageGeneration.draftRevisionId),
          eq(draftRevision.workspaceId, imageGeneration.workspaceId),
        ),
      )
      .innerJoin(
        platformDraft,
        and(
          eq(platformDraft.id, draftRevision.platformDraftId),
          eq(platformDraft.workspaceId, imageGeneration.workspaceId),
        ),
      )
      .where(
        and(
          inWorkspace(imageGeneration, workspaceId),
          eq(platformDraft.mediaBrandId, input.mediaBrandId),
          eq(operation.lifecycle, "queued"),
        ),
      )
      .orderBy(asc(operation.createdAt), asc(operation.id))
      .limit(1);
    if (next) await insertImageWake(tx, workspaceId, next.operationId);
    return settled;
  });
}

function staleImageOperation(now: Date) {
  return or(
    and(
      eq(operation.lifecycle, "running"),
      or(isNull(operation.leaseExpiresAt), lte(operation.leaseExpiresAt, now)),
    ),
    and(
      eq(operation.lifecycle, "queued"),
      lte(operation.updatedAt, new Date(now.getTime() - IMAGE_QUEUED_STALE_MS)),
      notExists(
        sql`(select 1 from ${outboxEvent} where ${outboxEvent.workspaceId} = ${operation.workspaceId} and ${outboxEvent.operationId} = ${operation.id} and ${outboxEvent.eventType} = ${OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME} and ${outboxEvent.dispatchedAt} is null and ${outboxEvent.exhaustedAt} is null)`,
      ),
    ),
  );
}

export async function listStaleImageOperations(
  executor: Executor,
  workspaceId: string,
  input: { limit: number; now: Date },
) {
  return executor
    .select({
      lifecycle: operation.lifecycle,
      mediaBrandId: platformDraft.mediaBrandId,
      operationId: imageGeneration.operationId,
      operationVersion: operation.version,
    })
    .from(imageGeneration)
    .innerJoin(
      operation,
      and(
        eq(operation.id, imageGeneration.operationId),
        eq(operation.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      draftRevision,
      and(
        eq(draftRevision.id, imageGeneration.draftRevisionId),
        eq(draftRevision.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        eq(platformDraft.id, draftRevision.platformDraftId),
        eq(platformDraft.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        staleImageOperation(input.now),
      ),
    )
    .orderBy(asc(operation.createdAt), asc(operation.id))
    .limit(input.limit);
}

export async function settleCancelledImageOperationAndWakeNext(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string | null;
    expectedVersion: number;
    mediaBrandId: string;
    operationId: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    return settleOpenImageOperation(tx, workspaceId, {
      ...input,
      terminal: "cancelled",
    });
  });
}

export async function settleFailedImageOperationAndWakeNext(
  executor: Executor,
  workspaceId: string,
  input: {
    claimedBy: string | null;
    expectedVersion: number;
    mediaBrandId: string;
    operationId: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    return settleOpenImageOperation(tx, workspaceId, {
      ...input,
      terminal: "failed",
    });
  });
}

export async function settleStaleImageOperation(
  executor: Executor,
  workspaceId: string,
  input: {
    expectedVersion: number;
    mediaBrandId: string;
    now: Date;
    operationId: string;
  },
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.version, input.expectedVersion),
          staleImageOperation(input.now),
        ),
      )
      .for("update");
    if (!current) return null;
    return settleOpenImageOperation(tx, workspaceId, {
      claimedBy: current.claimedBy,
      expectedVersion: input.expectedVersion,
      mediaBrandId: input.mediaBrandId,
      operationId: input.operationId,
      terminal: "failed",
    });
  });
}

async function settleOpenImageOperation(
  tx: Transaction,
  workspaceId: string,
  input: {
    claimedBy: string | null;
    expectedVersion: number;
    mediaBrandId: string;
    operationId: string;
    terminal: "cancelled" | "failed";
  },
) {
  const ownerFence =
    input.claimedBy === null
      ? isNull(operation.claimedBy)
      : eq(operation.claimedBy, input.claimedBy);
  const [current] = await tx
    .select({ generation: imageGeneration, operation })
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
        eq(imageGeneration.operationId, input.operationId),
        eq(operation.version, input.expectedVersion),
        ownerFence,
        inArray(operation.lifecycle, ["queued", "running", "settling"]),
      ),
    )
    .for("update");
  if (!current) return null;

  const usage = await tx
    .select({
      attemptId: aiUsageEvent.operationAttemptId,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationId, input.operationId),
      ),
    )
    .for("update");
  const ambiguousAttempts = new Set(
    usage
      .filter((item) => item.status === "pending" || item.status === "unknown")
      .map((item) => item.attemptId),
  );
  const unknownUsage = await tx
    .update(aiUsageEvent)
    .set({ status: "unknown", updatedAt: new Date() })
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationId, input.operationId),
        eq(aiUsageEvent.status, "pending"),
      ),
    )
    .returning({ id: aiUsageEvent.id });
  const openAttempts = await tx
    .select({ id: operationAttempt.id })
    .from(operationAttempt)
    .where(
      and(
        inWorkspace(operationAttempt, workspaceId),
        eq(operationAttempt.operationId, input.operationId),
        isNull(operationAttempt.outcome),
      ),
    )
    .for("update");
  for (const attempt of openAttempts) {
    const ambiguous = ambiguousAttempts.has(attempt.id);
    await tx
      .update(operationAttempt)
      .set({
        failureCode: ambiguous ? "MODEL_INVOCATION_FAILED" : null,
        outcome: ambiguous ? "ambiguous" : "failed_terminal",
        updatedAt: new Date(),
      })
      .where(
        and(
          inWorkspace(operationAttempt, workspaceId),
          eq(operationAttempt.id, attempt.id),
          isNull(operationAttempt.outcome),
        ),
      );
  }
  if (current.generation.imageBriefId) {
    await tx
      .update(imageBrief)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(
        and(
          inWorkspace(imageBrief, workspaceId),
          eq(imageBrief.id, current.generation.imageBriefId),
          inArray(imageBrief.status, ["pending", "running"]),
        ),
      );
  }
  const lifecycle = ambiguousAttempts.size > 0 ? "unknown" : input.terminal;
  const [settled] = await tx
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle,
      updatedAt: new Date(),
      version: current.operation.version + 1,
    })
    .where(
      and(
        inWorkspace(operation, workspaceId),
        eq(operation.id, input.operationId),
        eq(operation.version, current.operation.version),
        ownerFence,
      ),
    )
    .returning();
  if (!settled) return null;
  if (settled.lifecycle === "failed" || settled.lifecycle === "cancelled") {
    await retainProviderOriginal(
      tx,
      workspaceId,
      input.operationId,
      settled.updatedAt,
    );
  }

  const [next] = await tx
    .select({ operationId: imageGeneration.operationId })
    .from(imageGeneration)
    .innerJoin(
      operation,
      and(
        eq(operation.id, imageGeneration.operationId),
        eq(operation.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      draftRevision,
      and(
        eq(draftRevision.id, imageGeneration.draftRevisionId),
        eq(draftRevision.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .innerJoin(
      platformDraft,
      and(
        eq(platformDraft.id, draftRevision.platformDraftId),
        eq(platformDraft.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(imageGeneration, workspaceId),
        eq(platformDraft.mediaBrandId, input.mediaBrandId),
        eq(operation.lifecycle, "queued"),
      ),
    )
    .orderBy(asc(operation.createdAt), asc(operation.id))
    .limit(1);
  if (next) await insertImageWake(tx, workspaceId, next.operationId);
  return { operation: settled, usageSettled: unknownUsage.length > 0 };
}

export async function insertImageWake(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
) {
  const [pending] = await tx
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        inWorkspace(outboxEvent, workspaceId),
        eq(outboxEvent.operationId, operationId),
        eq(
          outboxEvent.eventType,
          OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
        ),
        isNull(outboxEvent.dispatchedAt),
        isNull(outboxEvent.exhaustedAt),
      ),
    )
    .limit(1);
  if (pending) return false;
  await tx.insert(outboxEvent).values({
    workspaceId,
    operationId,
    eventType: OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
    schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    payload: {
      imageGenerationId: operationId,
      operationId,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      workspaceId,
    },
  });
  return true;
}

export async function rearmImageGenerationOutbox(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [generation] = await tx
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
          eq(imageGeneration.operationId, operationId),
          eq(operation.lifecycle, "queued"),
        ),
      )
      .for("update");
    if (!generation) return { status: "not_found" as const };
    const [exhausted] = await tx
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          eq(outboxEvent.operationId, operationId),
          eq(
            outboxEvent.eventType,
            OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
          ),
          isNull(outboxEvent.dispatchedAt),
          sql`${outboxEvent.exhaustedAt} is not null`,
        ),
      )
      .limit(1);
    if (!exhausted) return { status: "not_exhausted" as const };
    const inserted = await insertImageWake(tx, workspaceId, operationId);
    return { status: inserted ? "rearmed" : ("replayed" as const) };
  });
}

export async function readImageOperationIdentity(
  executor: Executor,
  workspaceId: string,
  input: { actor: string; idempotencyKey: string },
) {
  return readOperationIdentity(executor, workspaceId, {
    actor: input.actor,
    commandType: `${IMAGE_GENERATION_COMMAND_PREFIX}start`,
    idempotencyKey: input.idempotencyKey,
  });
}
