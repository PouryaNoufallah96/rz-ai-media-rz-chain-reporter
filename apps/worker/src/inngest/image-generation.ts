import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  closestSupportedAspectRatio,
  creativeImageBriefSchema,
  type InvocationKey,
  imageGenerationRequestedPayloadSchema,
  imageOptionCapabilityKeySchema,
  MAX_REFERENCE_IMAGE_BYTES,
  MAX_REFERENCE_IMAGE_DIMENSION,
  MAX_REFERENCE_IMAGE_PIXELS,
  type OperationLifecycle,
  referenceImageMimeTypeSchema,
  type TemplateSelection,
} from "@rz-chain-reporter/contracts";
import { computeBrandPolicyFingerprint } from "@rz-chain-reporter/customer-template/fingerprint";
import {
  IMAGE_GENERATION_TASK_PREFIX,
  type ImageProfile,
  imageProfileSchema,
  modelTaskKeySchema,
} from "@rz-chain-reporter/customer-template/schema";
import { findCopyExecutionContext } from "@rz-chain-reporter/db/repositories/copy-generation";
import { attachGeneratedFinalToRevision } from "@rz-chain-reporter/db/repositories/draft-revision";
import {
  allocateImageStageAttempt,
  attachBrandedFinal,
  attachProviderOriginal,
  createImageBrief,
  findImageExecutionContext,
  findOldestImageOperationForBrand,
  imageSourceProjectionReadiness,
  inspectImageAttemptTruth,
  listImageStageUsage,
  listLatestImageVarietySignatures,
  loadAuthorizedImageSource,
  loadAuthorizedImageSourceAccess,
  loadImageProviderInput,
  markCompensatedProviderOriginal,
  persistClaimedImageCreativeBrief,
  persistClaimedImageCreativeFailure,
  persistClaimedImageSelectionCompletion,
  persistImageCreativeBrief,
  persistImageCreativeStructuredFailure,
  persistImageSelectionCompletionInTransaction,
  persistImageSelectionRejection,
  reconcileClaimedImageSelectionCompletion,
  rejectReservedProviderOriginal,
  releaseImageOperationAndWake,
  reserveProviderOriginal,
  resolveProviderOriginalCommit,
  settleCancelledImageOperationAndWakeNext,
  settleFailedImageOperationAndWakeNext,
  settleImageOperationAndWakeNext,
  settleSupersededImageGeneration,
  stableImageIdentity,
} from "@rz-chain-reporter/db/repositories/image-generation";
import {
  getMediaAsset,
  markMediaObjectRemoved,
} from "@rz-chain-reporter/db/repositories/media-asset";
import {
  claimOperationExecution,
  renewOperationClaim,
} from "@rz-chain-reporter/db/repositories/operation";
import { settleOperationAttempt } from "@rz-chain-reporter/db/repositories/operation-attempt";
import {
  ImagePreparationError,
  ModelGatewayInvocationError,
} from "@rz-chain-reporter/model-gateway/errors";
import {
  MAX_OUTPUT_TOKENS,
  type ModelGateway,
} from "@rz-chain-reporter/model-gateway/gateway";
import { invoke, NonRetriableError } from "inngest";
import { z } from "zod";
import {
  assembleImagePrompt,
  composeBrandedFinal,
  IMAGE_ASSEMBLER_VERSION,
  imageTextLanguageInstruction,
} from "../image-assembler";
import {
  buildSelectionOutputSchema,
  type CreativeBriefFailure,
  normalizeCreativeBrief,
  selectionSignature,
  validateImageSelection,
} from "../image-selection";
import { workerLogger } from "../logging/logger";
import { workerModelGateway } from "../model-gateway/worker-gateway";
import { resolveArtifactRoot } from "../runtime/artifact-root";
import {
  notifyDraftsAndUsageChanged,
  notifyDraftsChanged,
} from "../web-cache/drafts";
import { publishOperationStatus, type WorkerStep } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import {
  compensateProviderOriginal,
  prepareBrandedFinal,
  prepareProviderOriginal,
  readStorageBytes,
  readVerifiedProviderOriginal,
  validateStaticRaster,
  workerStorage,
} from "./media-storage";
import type { WorkerRuntime } from "./runtime";
import { assertWorkspace } from "./runtime";

const IMAGE_GENERATION_FUNCTION_ID = "image-generation" as const;
export const IMAGE_PARENT_RETRIES = 2 as const;
export const IMAGE_STAGE_RETRIES = 0 as const;
export const IMAGE_STAGE_INVOKE_TIMEOUT = "10m";
export const IMAGE_STAGE_QUIESCENCE_PASSES = 12;
export const IMAGE_STAGE_QUIESCENCE_INTERVAL = "5s";
export const IMAGE_PROVIDER_DEADLINE_MS = 90_000;

const IMAGE_TERMINAL_LIFECYCLES: readonly OperationLifecycle[] = [
  "cancelled",
  "failed",
  "succeeded",
  "unknown",
];

export function nextImageInvocation(
  slots: readonly InvocationKey[],
  usage: readonly { invocationKey: string; status: string }[],
) {
  for (const invocationKey of slots) {
    const prior = usage.find((item) => item.invocationKey === invocationKey);
    if (!prior) return { invocationKey, status: "invoke" as const };
    if (prior.status !== "failed" && prior.status !== "cancelled") {
      return { invocationKey, status: "blocked" as const };
    }
  }
  return { status: "exhausted" as const };
}

const stageInvokeSchema = z.object({
  operationId: z.uuid(),
  token: z.string().min(1).max(200),
  workspaceId: z.uuid(),
});

const stageResultSchema = z.strictObject({
  operationId: z.uuid(),
  status: z.enum(["failed", "succeeded", "superseded", "waiting"]),
});

const cancelledIdsSchema = z.object({
  data: z.object({ function_id: z.string(), run_id: z.string() }),
});

const interruptedEnvelopeSchema = z.object({
  data: z.object({
    event: z.object({ data: imageGenerationRequestedPayloadSchema }),
  }),
});

const creativeOutputSchema = creativeImageBriefSchema;

type ImageArtifacts = {
  brandBible: string;
  brandPolicyFingerprint: string;
  logo: Uint8Array | null;
  profile: ImageProfile;
  profileFingerprint: string;
};

function loadArtifacts(
  runtime: WorkerRuntime,
  brandKey: string,
): ImageArtifacts {
  const brand = runtime.template.mediaBrands.find(
    (item) => item.key === brandKey,
  );
  if (!brand?.imageProfile) throw new NonRetriableError("TEMPLATE_DRIFT");
  const root = resolveArtifactRoot(import.meta.url);
  const customerRoot = resolve(
    root,
    "customer-templates",
    runtime.template.customer.key,
  );
  const profileBytes = readFileSync(resolve(customerRoot, brand.imageProfile));
  const profile = imageProfileSchema.parse(
    JSON.parse(profileBytes.toString("utf8")),
  );
  const brandBible = brand.brandBible
    ? readFileSync(resolve(customerRoot, brand.brandBible), "utf8")
    : "Follow the declared media-brand policy and official reference only.";
  return {
    brandBible,
    brandPolicyFingerprint: computeBrandPolicyFingerprint(brand.editorial),
    logo: brand.brandLogo
      ? readFileSync(resolve(customerRoot, brand.brandLogo.path))
      : null,
    profile,
    profileFingerprint: createHash("sha256").update(profileBytes).digest("hex"),
  };
}

function selectionPrompt(
  source: Awaited<ReturnType<typeof loadAuthorizedImageSource>>,
  artifacts: ImageArtifacts,
) {
  if (!source) throw new NonRetriableError("NOT_FOUND");
  return [
    "Select exactly one declared family and one allowed value for every declared axis; use null only for an axis whose response schema allows it.",
    "The selection must satisfy every declared restriction clause.",
    imageTextLanguageInstruction(source.context.contentLocale),
    JSON.stringify({
      families: artifacts.profile.families,
      axes: artifacts.profile.axes,
      restrictions: {
        antiRepetition: artifacts.profile.restrictions.antiRepetition,
        moodAccentDefault: artifacts.profile.restrictions.moodAccentDefault,
        moodAccentRestricted:
          artifacts.profile.restrictions.moodAccentRestricted,
        environmentRestricted:
          artifacts.profile.restrictions.environmentRestricted,
      },
    }),
    JSON.stringify(source.source),
  ].join("\n\n");
}

function creativePrompt(
  source: Awaited<ReturnType<typeof loadAuthorizedImageSource>>,
  selection: TemplateSelection,
  artifacts: ImageArtifacts,
  operatorDirection: string | null,
  previousRejection: readonly CreativeBriefFailure[],
) {
  if (!source) throw new NonRetriableError("NOT_FOUND");
  return [
    "Return a bounded image brief for the selected layout. Do not invent article facts.",
    imageTextLanguageInstruction(source.context.contentLocale),
    JSON.stringify(selection),
    "Operator direction is optional and lower priority than every profile, brand, safety, geometry, logo, and text rule.",
    JSON.stringify({ operatorDirection }),
    artifacts.profile.textPolicy.rules,
    ...(previousRejection.length > 0
      ? [
          `The previous brief was rejected by the policy validator: ${previousRejection.join(",")}. Choose a different subject that names no restricted term.`,
        ]
      : []),
    JSON.stringify(source.source),
  ].join("\n\n");
}

async function loadImageDraftChange(
  step: WorkerStep,
  runtime: WorkerRuntime,
  workspaceId: string,
  context: NonNullable<Awaited<ReturnType<typeof findImageExecutionContext>>>,
  code: Parameters<typeof notifyDraftsChanged>[2]["code"],
  callSite: string,
) {
  return step.run(`load-image-draft-change-${callSite}`, async () => {
    const copy = await findCopyExecutionContext(
      runtime.db,
      workspaceId,
      context.copyOperationId,
    );
    if (!copy) throw new NonRetriableError("NOT_FOUND");
    if (copy.executionScope.kind !== "analysis_run") {
      throw new Error("draft notification requires an analysis-run scope");
    }
    return {
      analysisRunId: copy.executionScope.analysisRunId,
      code,
      operationId: context.operationId,
      platformDraftId: context.platformDraftId,
    };
  });
}

async function publishImageTransition(
  step: WorkerStep,
  runtime: WorkerRuntime,
  workspaceId: string,
  context: NonNullable<Awaited<ReturnType<typeof findImageExecutionContext>>>,
  operation: { lifecycle: OperationLifecycle; version: number },
  code: Parameters<typeof notifyDraftsChanged>[2]["code"],
  callSite: string,
  usageChanged: boolean,
) {
  const change = await loadImageDraftChange(
    step,
    runtime,
    workspaceId,
    context,
    code,
    callSite,
  );
  if (usageChanged) {
    await notifyDraftsAndUsageChanged(
      step,
      workspaceId,
      change,
      callSite,
      context.actor,
    );
  } else {
    await notifyDraftsChanged(step, workspaceId, change, callSite);
  }
  await publishOperationStatus(
    step,
    workspaceId,
    {
      actorId: context.actor,
      lifecycle: operation.lifecycle,
      operationId: context.operationId,
      operationVersion: operation.version,
      sharedImport: false,
    },
    "worker.image-generation.realtime-unavailable",
  );
}

function hasSettledUsage(
  rows: Awaited<ReturnType<typeof inspectImageAttemptTruth>>["rows"],
) {
  return rows.some(
    (row) => row.usageStatus !== null && row.usageStatus !== "pending",
  );
}

async function claimStage(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  stage: ImageStage,
) {
  const context = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (
    !context ||
    context.claimedBy !== input.token ||
    context.operationLifecycle !== "running"
  ) {
    return null;
  }
  return allocateImageStageAttempt(runtime.db, input.workspaceId, {
    claimedBy: input.token,
    expectedVersion: context.operationVersion,
    operationId: input.operationId,
    stage,
  });
}

async function stopSupersededPaidStage(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  expectedVersion: number,
) {
  const context = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (
    !context ||
    context.claimedBy !== input.token ||
    context.operationLifecycle !== "running" ||
    context.operationVersion !== expectedVersion
  ) {
    return "waiting" as const;
  }
  const result = await settleSupersededImageGeneration(
    runtime.db,
    input.workspaceId,
    {
      claimedBy: input.token,
      expectedVersion,
      mediaBrandId: context.mediaBrandId,
      operationId: input.operationId,
    },
  );
  if (result.status === "current") return "current" as const;
  if (result.status === "settled") {
    return "superseded" as const;
  }
  return "waiting" as const;
}

async function renewImageSlotClaim(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
) {
  const context = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (
    !context ||
    context.claimedBy !== input.token ||
    context.operationLifecycle !== "running"
  ) {
    return null;
  }
  const providerInput = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (!providerInput) return null;
  if (providerInput.generation.referenceMediaAssetId) {
    const reference = providerInput.reference;
    if (
      reference?.lifecycle !== "verified" ||
      reference.objectRemovedAt ||
      !reference.checksum ||
      !referenceImageMimeTypeSchema.safeParse(reference.mimeType).success
    ) {
      throw new NonRetriableError("REFERENCE_INVALID");
    }
  }
  return renewImageLease(runtime, input, context.operationVersion);
}

async function renewImageLease(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  expectedVersion: number,
) {
  const now = new Date();
  return renewOperationClaim(runtime.db, input.workspaceId, {
    claimedBy: input.token,
    expectedVersion,
    id: input.operationId,
    leaseExpiresAt: new Date(
      now.getTime() + IMAGE_PROVIDER_DEADLINE_MS + 15_000,
    ),
    now,
  });
}

async function loadVerifiedReference(
  storage: ReturnType<typeof workerStorage>,
  asset: NonNullable<
    Awaited<ReturnType<typeof loadImageProviderInput>>
  >["reference"],
) {
  if (
    asset?.lifecycle !== "verified" ||
    asset.objectRemovedAt ||
    !asset.checksum ||
    !asset.actualBytes ||
    !asset.width ||
    !asset.height ||
    !referenceImageMimeTypeSchema.safeParse(asset.mimeType).success
  ) {
    throw new NonRetriableError("REFERENCE_INVALID");
  }
  const bytes = await readStorageBytes(storage, asset.objectKey);
  const decoded = await validateStaticRaster(bytes, {
    maxBytes: MAX_REFERENCE_IMAGE_BYTES,
    maxDimension: MAX_REFERENCE_IMAGE_DIMENSION,
    maxPixels: MAX_REFERENCE_IMAGE_PIXELS,
    mimeType: asset.mimeType,
  }).catch(() => {
    throw new NonRetriableError("REFERENCE_INVALID");
  });
  if (
    bytes.byteLength !== asset.actualBytes ||
    decoded.width !== asset.width ||
    decoded.height !== asset.height ||
    createHash("sha256").update(bytes).digest("hex") !== asset.checksum
  ) {
    throw new NonRetriableError("REFERENCE_INVALID");
  }
  return {
    bytes,
    height: decoded.height,
    mimeType: decoded.mimeType,
    width: decoded.width,
  };
}

type ImageStage = "creative" | "final" | "provider" | "selection";

async function settleClaimedImageAttempt(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  attemptId: string,
  settlement: {
    failureCode?: Parameters<typeof settleOperationAttempt>[2]["failureCode"];
    outcome: Parameters<typeof settleOperationAttempt>[2]["outcome"];
  },
) {
  const context = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (
    !context ||
    context.claimedBy !== input.token ||
    context.operationLifecycle !== "running"
  ) {
    return null;
  }
  return settleOperationAttempt(runtime.db, input.workspaceId, {
    ...settlement,
    claimFence: {
      claimedBy: input.token,
      expectedVersion: context.operationVersion,
      operationId: input.operationId,
    },
    id: attemptId,
  });
}

async function reconcileImageGatewayError(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  attemptId: string,
  invocationKey: InvocationKey,
  stage: ImageStage,
  error: ModelGatewayInvocationError,
  expectedVersion?: number,
) {
  if (error.usageEventId === null) throw error;
  const usage = await listImageStageUsage(
    runtime.db,
    input.workspaceId,
    attemptId,
  );
  const exact = usage.find(
    (item) =>
      item.id === error.usageEventId &&
      item.operationAttemptId === attemptId &&
      item.invocationKey === invocationKey,
  );
  if (!exact || error.code === "TEMPLATE_DRIFT") throw error;
  if (exact.status === "failed" || exact.status === "cancelled") {
    return "advance" as const;
  }
  if (exact.status === "pending" || exact.status === "unknown") {
    if (error.ambiguous) {
      const settled = await settleClaimedImageAttempt(
        runtime,
        input,
        attemptId,
        {
          failureCode: "MODEL_INVOCATION_FAILED",
          outcome: "ambiguous",
        },
      );
      if (!settled) return "waiting" as const;
    }
    return "waiting" as const;
  }
  if (exact.status === "succeeded") {
    const current = await loadImageProviderInput(
      runtime.db,
      input.workspaceId,
      input.operationId,
    );
    if (
      stage === "selection" &&
      current?.brief.selectionRejections.some(
        (item) => item.invocationKey === invocationKey,
      )
    ) {
      return "advance" as const;
    }
    if (stage === "selection" && current?.brief.templateSelection) {
      if (expectedVersion === undefined) {
        throw new Error("selection reconciliation requires a claim version");
      }
      const completed = await reconcileClaimedImageSelectionCompletion(
        runtime.db,
        input.workspaceId,
        {
          attemptId,
          claimedBy: input.token,
          expectedVersion,
          imageBriefId: current.brief.id,
          operationId: input.operationId,
        },
      );
      return completed ? ("succeeded" as const) : ("waiting" as const);
    }
    if (stage === "creative" && current && !current.brief.providerPrompt) {
      return "advance" as const;
    }
  }
  throw error;
}

export async function executeImageSelection(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  input: z.infer<typeof stageInvokeSchema>,
) {
  await assertWorkspace(runtime, input.workspaceId);
  const existing = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  const claimed = await claimStage(runtime, input, "selection");
  if (!claimed)
    return { operationId: input.operationId, status: "waiting" } as const;
  if (existing?.brief.templateSelection) {
    const completed = await reconcileClaimedImageSelectionCompletion(
      runtime.db,
      input.workspaceId,
      {
        attemptId: claimed.attempt.id,
        claimedBy: input.token,
        expectedVersion: claimed.operation.version,
        imageBriefId: existing.brief.id,
        operationId: input.operationId,
      },
    );
    return {
      operationId: input.operationId,
      status: completed ? "succeeded" : "waiting",
    } as const;
  }
  const sourceAccess = await loadAuthorizedImageSourceAccess(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (sourceAccess.readiness === "extract_required") {
    if (claimed.attempt.outcome !== null) {
      if (
        claimed.attempt.outcome === "failed_terminal" &&
        claimed.attempt.failureCode === "IMAGE_SOURCE_EXTRACT_REQUIRED"
      ) {
        return { operationId: input.operationId, status: "failed" } as const;
      }
      throw new Error("image source readiness attempt truth is contradictory");
    }
    const settled = await settleClaimedImageAttempt(
      runtime,
      input,
      claimed.attempt.id,
      {
        failureCode: "IMAGE_SOURCE_EXTRACT_REQUIRED",
        outcome: "failed_terminal",
      },
    );
    return {
      operationId: input.operationId,
      status: settled ? "failed" : "waiting",
    } as const;
  }
  if (!sourceAccess.source || !sourceAccess.context) {
    throw new NonRetriableError("NOT_FOUND");
  }
  const source = {
    context: sourceAccess.context,
    source: sourceAccess.source,
  };
  const artifacts = loadArtifacts(runtime, source.context.mediaBrandKey);
  const sourceProjection = toSourceProjection(source.source);
  if (!sourceProjection) throw new NonRetriableError("NOT_FOUND");
  const briefId = await createImageBrief(runtime.db, input.workspaceId, {
    assemblerVersion: IMAGE_ASSEMBLER_VERSION,
    brandPolicyFingerprint: artifacts.brandPolicyFingerprint,
    claimedBy: input.token,
    configurationVersion: runtime.identity.fingerprint,
    expectedVersion: claimed.operation.version,
    imageProfileFingerprint: artifacts.profileFingerprint,
    operationId: input.operationId,
    selectionAttemptId: claimed.attempt.id,
    source: sourceProjection,
  });
  if (!briefId)
    return { operationId: input.operationId, status: "waiting" } as const;
  const latest = await listLatestImageVarietySignatures(
    runtime.db,
    input.workspaceId,
    source.context.mediaBrandId,
  );
  const selectionSchema = buildSelectionOutputSchema(artifacts.profile);
  const task = runtime.template.models?.tasks["image-template-selection"];
  const slots: InvocationKey[] = task?.fallback
    ? ["primary", "retry-1", "fallback"]
    : ["primary", "retry-1"];
  for (const invocationKey of slots) {
    const usage = await listImageStageUsage(
      runtime.db,
      input.workspaceId,
      claimed.attempt.id,
    );
    const prior = usage.find((item) => item.invocationKey === invocationKey);
    const current = await loadImageProviderInput(
      runtime.db,
      input.workspaceId,
      input.operationId,
    );
    if (!current) throw new NonRetriableError("NOT_FOUND");
    if (current.brief.templateSelection) {
      const completed = await reconcileClaimedImageSelectionCompletion(
        runtime.db,
        input.workspaceId,
        {
          attemptId: claimed.attempt.id,
          claimedBy: input.token,
          expectedVersion: claimed.operation.version,
          imageBriefId: current.brief.id,
          operationId: input.operationId,
        },
      );
      if (!completed)
        return { operationId: input.operationId, status: "waiting" } as const;
      return { operationId: input.operationId, status: "succeeded" } as const;
    }
    const rejected = current.brief.selectionRejections.some(
      (item) => item.invocationKey === invocationKey,
    );
    if (
      prior?.status === "failed" ||
      prior?.status === "cancelled" ||
      (prior?.status === "succeeded" && rejected)
    ) {
      continue;
    }
    if (prior) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    const renewed = await renewImageSlotClaim(runtime, input);
    if (!renewed) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    const supersession = await stopSupersededPaidStage(
      runtime,
      input,
      renewed.version,
    );
    if (supersession !== "current") {
      return { operationId: input.operationId, status: supersession } as const;
    }
    try {
      await gateway.invokeStructured({
        claimFence: {
          claimedBy: input.token,
          expectedVersion: renewed.version,
        },
        deadlineMs: IMAGE_PROVIDER_DEADLINE_MS,
        invocationKey,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        operationAttemptId: claimed.attempt.id,
        operationId: input.operationId,
        outputName: "image_template_selection",
        persistDefiniteFailure: (tx, failure) =>
          persistImageSelectionRejection(tx, input.workspaceId, {
            imageBriefId: briefId,
            rejection: {
              code: failure.code,
              invocationKey,
            },
          }),
        persistResult: async (tx, candidate) => {
          const checked = validateImageSelection(
            artifacts.profileFingerprint,
            artifacts.profile,
            candidate,
            latest.map((item) => item.signature),
          );
          if (checked.status !== "accepted") {
            await persistImageSelectionRejection(tx, input.workspaceId, {
              imageBriefId: briefId,
              rejection: {
                code: "VALIDATION_FAILED",
                invocationKey,
                ...(checked.status === "repeat_rejected"
                  ? { signature: checked.signature }
                  : {}),
              },
            });
            return;
          }
          const completed = await persistImageSelectionCompletionInTransaction(
            tx,
            input.workspaceId,
            {
              attemptId: claimed.attempt.id,
              claimedBy: input.token,
              expectedVersion: renewed.version,
              operationId: input.operationId,
              outcome: "succeeded",
              fallback: false,
              imageBriefId: briefId,
              rejections: current.brief.selectionRejections,
              selection: checked.selection,
            },
          );
          if (!completed) {
            throw new Error("image selection completion claim fence lost");
          }
        },
        prompt: selectionPrompt(source, artifacts),
        schema: selectionSchema,
        taskKey: "image-template-selection",
        workspaceId: input.workspaceId,
      });
      const persisted = await loadImageProviderInput(
        runtime.db,
        input.workspaceId,
        input.operationId,
      );
      if (persisted?.brief.templateSelection) {
        const completed = await reconcileClaimedImageSelectionCompletion(
          runtime.db,
          input.workspaceId,
          {
            attemptId: claimed.attempt.id,
            claimedBy: input.token,
            expectedVersion: renewed.version,
            imageBriefId: persisted.brief.id,
            operationId: input.operationId,
          },
        );
        if (!completed)
          return { operationId: input.operationId, status: "waiting" } as const;
        return { operationId: input.operationId, status: "succeeded" } as const;
      }
    } catch (error) {
      if (!(error instanceof ModelGatewayInvocationError)) throw error;
      const resolution = await reconcileImageGatewayError(
        runtime,
        input,
        claimed.attempt.id,
        invocationKey,
        "selection",
        error,
        renewed.version,
      );
      if (resolution === "waiting") {
        return { operationId: input.operationId, status: "waiting" } as const;
      }
      if (resolution === "succeeded") {
        return { operationId: input.operationId, status: "succeeded" } as const;
      }
    }
  }
  const rejected = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (!rejected) throw new NonRetriableError("NOT_FOUND");
  const fallback = artifacts.profile.fallbackBrief;
  const renewed = await renewImageSlotClaim(runtime, input);
  if (!renewed) {
    return { operationId: input.operationId, status: "waiting" } as const;
  }
  const persisted = await persistClaimedImageSelectionCompletion(
    runtime.db,
    input.workspaceId,
    {
      attemptId: claimed.attempt.id,
      claimedBy: input.token,
      expectedVersion: renewed.version,
      fallback: true,
      fallbackCode: "VALIDATION_FAILED",
      failureCode: "VALIDATION_FAILED",
      imageBriefId: briefId,
      operationId: input.operationId,
      rejections: rejected.brief.selectionRejections,
      selection: fallback.selection,
      outcome: "failed_terminal",
      varietyDegraded: true,
    },
  );
  if (!persisted)
    return { operationId: input.operationId, status: "waiting" } as const;
  return { operationId: input.operationId, status: "succeeded" } as const;
}

export async function executeImageCreativeBrief(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  input: z.infer<typeof stageInvokeSchema>,
) {
  const context = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  const providerInput = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (!context || !providerInput?.brief.templateSelection) {
    return { operationId: input.operationId, status: "failed" } as const;
  }
  const templateSelection = providerInput.brief.templateSelection;
  if (providerInput.brief.providerPrompt) {
    return { operationId: input.operationId, status: "succeeded" } as const;
  }
  const source = await loadAuthorizedImageSource(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  const artifacts = loadArtifacts(runtime, context.mediaBrandKey);
  if (providerInput.brief.deterministicFallback) {
    const claimed = await claimStage(runtime, input, "creative");
    if (!claimed)
      return { operationId: input.operationId, status: "waiting" } as const;
    const renewed = await renewImageSlotClaim(runtime, input);
    if (!renewed)
      return { operationId: input.operationId, status: "waiting" } as const;
    const fallback = artifacts.profile.fallbackBrief;
    const assembled = assembleImagePrompt({
      brief: fallback.brief,
      brandBible: artifacts.brandBible,
      contentLocale: context.contentLocale,
      operatorDirection: providerInput.brief.operatorDirection ?? undefined,
      profile: artifacts.profile,
      selection: fallback.selection,
    });
    const persisted = await persistClaimedImageCreativeBrief(
      runtime.db,
      input.workspaceId,
      {
        attemptId: claimed.attempt.id,
        claimedBy: input.token,
        creativeBrief: fallback.brief,
        creativeBriefAttemptId: null,
        expectedVersion: renewed.version,
        imageBriefId: providerInput.brief.id,
        operationId: input.operationId,
        providerPrompt: assembled.prompt,
        providerPromptDigest: assembled.digest,
      },
    );
    if (!persisted)
      return { operationId: input.operationId, status: "waiting" } as const;
    const settled = await settleClaimedImageAttempt(
      runtime,
      input,
      claimed.attempt.id,
      { outcome: "succeeded" },
    );
    return {
      operationId: input.operationId,
      status: settled ? "succeeded" : "waiting",
    } as const;
  }
  const claimed = await claimStage(runtime, input, "creative");
  if (!claimed || !source)
    return { operationId: input.operationId, status: "waiting" } as const;
  const task = runtime.template.models?.tasks["image-creative-brief"];
  const slots: InvocationKey[] = task?.fallback
    ? ["primary", "retry-1", "fallback"]
    : ["primary", "retry-1"];
  let rejection: readonly CreativeBriefFailure[] = [];
  for (const [slotIndex, invocationKey] of slots.entries()) {
    const usage = await listImageStageUsage(
      runtime.db,
      input.workspaceId,
      claimed.attempt.id,
    );
    const prior = usage.find((item) => item.invocationKey === invocationKey);
    if (prior?.status === "failed" || prior?.status === "cancelled") {
      continue;
    }
    if (prior?.status === "succeeded") {
      const current = await loadImageProviderInput(
        runtime.db,
        input.workspaceId,
        input.operationId,
      );
      if (!current) throw new NonRetriableError("NOT_FOUND");
      if (!current.brief.providerPrompt) continue;
      const settled = await settleClaimedImageAttempt(
        runtime,
        input,
        claimed.attempt.id,
        { outcome: "succeeded" },
      );
      return {
        operationId: input.operationId,
        status: settled ? "succeeded" : "waiting",
      } as const;
    }
    if (prior) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    const renewed = await renewImageSlotClaim(runtime, input);
    if (!renewed) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    const supersession = await stopSupersededPaidStage(
      runtime,
      input,
      renewed.version,
    );
    if (supersession !== "current") {
      return { operationId: input.operationId, status: supersession } as const;
    }
    const slot: { rejected: readonly CreativeBriefFailure[] } = {
      rejected: [],
    };
    try {
      await gateway.invokeStructured({
        claimFence: {
          claimedBy: input.token,
          expectedVersion: renewed.version,
        },
        deadlineMs: IMAGE_PROVIDER_DEADLINE_MS,
        invocationKey,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        operationAttemptId: claimed.attempt.id,
        operationId: input.operationId,
        outputName: "image_creative_brief",
        persistDefiniteFailure: (tx, failure) =>
          persistImageCreativeStructuredFailure(tx, input.workspaceId, {
            code: failure.code,
            hasMoreSlots: slotIndex < slots.length - 1,
            imageBriefId: providerInput.brief.id,
            operationAttemptId: claimed.attempt.id,
            operationId: input.operationId,
          }),
        persistResult: async (tx, candidate) => {
          const normalized = normalizeCreativeBrief(
            artifacts.profile,
            templateSelection,
            candidate,
          );
          if (normalized.failures.length > 0) {
            slot.rejected = normalized.failures;
            await persistImageCreativeStructuredFailure(tx, input.workspaceId, {
              code: "VALIDATION_FAILED",
              hasMoreSlots: slotIndex < slots.length - 1,
              imageBriefId: providerInput.brief.id,
              operationAttemptId: claimed.attempt.id,
              operationId: input.operationId,
            });
            return;
          }
          const assembled = assembleImagePrompt({
            brief: normalized.brief,
            brandBible: artifacts.brandBible,
            contentLocale: context.contentLocale,
            operatorDirection:
              providerInput.brief.operatorDirection ?? undefined,
            profile: artifacts.profile,
            selection: templateSelection,
          });
          await persistImageCreativeBrief(tx, input.workspaceId, {
            creativeBrief: normalized.brief,
            creativeBriefAttemptId: claimed.attempt.id,
            imageBriefId: providerInput.brief.id,
            providerPrompt: assembled.prompt,
            providerPromptDigest: assembled.digest,
          });
        },
        prompt: creativePrompt(
          source,
          templateSelection,
          artifacts,
          providerInput.brief.operatorDirection,
          rejection,
        ),
        schema: creativeOutputSchema,
        taskKey: "image-creative-brief",
        workspaceId: input.workspaceId,
      });
      const persisted = await loadImageProviderInput(
        runtime.db,
        input.workspaceId,
        input.operationId,
      );
      if (persisted?.brief.providerPrompt) {
        const settled = await settleClaimedImageAttempt(
          runtime,
          input,
          claimed.attempt.id,
          {
            outcome: "succeeded",
          },
        );
        if (!settled)
          return { operationId: input.operationId, status: "waiting" } as const;
        return { operationId: input.operationId, status: "succeeded" } as const;
      }
      if (slot.rejected.length > 0) {
        workerLogger.warn("image.brief.rejected", {
          attemptId: claimed.attempt.id,
          invocationKey,
          operationId: input.operationId,
          reason: slot.rejected.join(","),
        });
        rejection = slot.rejected;
      }
    } catch (error) {
      if (!(error instanceof ModelGatewayInvocationError)) throw error;
      const resolution = await reconcileImageGatewayError(
        runtime,
        input,
        claimed.attempt.id,
        invocationKey,
        "creative",
        error,
      );
      if (resolution === "waiting") {
        return { operationId: input.operationId, status: "waiting" } as const;
      }
    }
  }
  const failedBrief = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (failedBrief?.brief.status === "failed") {
    return { operationId: input.operationId, status: "failed" } as const;
  }
  const claimContext = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (
    !claimContext ||
    claimContext.claimedBy !== input.token ||
    claimContext.operationLifecycle !== "running"
  ) {
    return { operationId: input.operationId, status: "waiting" } as const;
  }
  const settled = await persistClaimedImageCreativeFailure(
    runtime.db,
    input.workspaceId,
    {
      attemptId: claimed.attempt.id,
      claimedBy: input.token,
      code: "VALIDATION_FAILED",
      expectedVersion: claimContext.operationVersion,
      imageBriefId: providerInput.brief.id,
      operationId: input.operationId,
    },
  );
  if (!settled)
    return { operationId: input.operationId, status: "waiting" } as const;
  return { operationId: input.operationId, status: "failed" } as const;
}

export async function executeImageProvider(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  input: z.infer<typeof stageInvokeSchema>,
) {
  const existingContext = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (existingContext?.providerOriginalMediaAssetId) {
    return { operationId: input.operationId, status: "succeeded" } as const;
  }
  const claimed = await claimStage(runtime, input, "provider");
  if (!claimed)
    return { operationId: input.operationId, status: "waiting" } as const;
  const storage = workerStorage();
  if (!gateway.invokeImage)
    throw new NonRetriableError("MODEL_GATEWAY_IMAGE_UNAVAILABLE");
  const initialProviderInput = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (!initialProviderInput?.brief.providerPrompt) {
    return { operationId: input.operationId, status: "failed" } as const;
  }
  const taskKey = modelTaskKeySchema.parse(
    `${IMAGE_GENERATION_TASK_PREFIX}${initialProviderInput.generation.modelOptionKey}`,
  );
  if (!existingContext) {
    return { operationId: input.operationId, status: "failed" } as const;
  }
  const aspectRatio = closestSupportedAspectRatio(
    imageOptionCapabilityKeySchema.parse(
      initialProviderInput.generation.modelOptionKey,
    ),
    loadArtifacts(runtime, existingContext.mediaBrandKey).profile.output,
  );
  const task = runtime.template.models?.tasks[taskKey];
  const slots: InvocationKey[] = task?.fallback
    ? ["primary", "retry-1", "fallback"]
    : ["primary", "retry-1"];

  while (true) {
    const usage = await listImageStageUsage(
      runtime.db,
      input.workspaceId,
      claimed.attempt.id,
    );
    const next = nextImageInvocation(slots, usage);
    if (next.status === "blocked") {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    if (next.status === "exhausted") break;
    const invocationKey = next.invocationKey;

    const context = await findImageExecutionContext(
      runtime.db,
      input.workspaceId,
      input.operationId,
    );
    if (
      !context ||
      context.claimedBy !== input.token ||
      context.operationLifecycle !== "running"
    ) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    const renewed = await renewOperationClaim(runtime.db, input.workspaceId, {
      claimedBy: input.token,
      expectedVersion: context.operationVersion,
      id: input.operationId,
      leaseExpiresAt: new Date(
        Date.now() + IMAGE_PROVIDER_DEADLINE_MS + 15_000,
      ),
      now: new Date(),
    });
    if (!renewed)
      return { operationId: input.operationId, status: "waiting" } as const;

    const supersession = await stopSupersededPaidStage(
      runtime,
      input,
      renewed.version,
    );
    if (supersession !== "current") {
      return { operationId: input.operationId, status: supersession } as const;
    }

    const providerInput = await loadImageProviderInput(
      runtime.db,
      input.workspaceId,
      input.operationId,
    );
    if (!providerInput?.brief.providerPrompt) {
      return { operationId: input.operationId, status: "failed" } as const;
    }
    let reference:
      | Awaited<ReturnType<typeof loadVerifiedReference>>
      | undefined;
    if (providerInput.generation.referenceMediaAssetId) {
      reference = await loadVerifiedReference(storage, providerInput.reference);
    }

    const mediaAssetId = stableImageIdentity(
      input.operationId,
      `provider-original:${invocationKey}`,
    );
    const objectKey = `${input.workspaceId}/image-originals/${mediaAssetId}`;
    const reserved = await reserveProviderOriginal(
      runtime.db,
      input.workspaceId,
      {
        attemptId: claimed.attempt.id,
        claimedBy: input.token,
        expectedVersion: renewed.version,
        mediaAssetId,
        objectKey,
        operationId: input.operationId,
      },
    );
    if (reserved.status !== "reserved") {
      return {
        operationId: input.operationId,
        status: reserved.status === "reference_invalid" ? "failed" : "waiting",
      } as const;
    }

    try {
      await gateway.invokeImage({
        aspectRatio,
        compensatePreparedResult: async () => {
          const rejected = await markCompensatedProviderOriginal(
            runtime.db,
            input.workspaceId,
            {
              attemptId: claimed.attempt.id,
              claimedBy: input.token,
              expectedVersion: renewed.version,
              mediaAssetId,
              objectKey,
              operationId: input.operationId,
            },
          );
          if (rejected.status !== "rejected") return "uncertain";
          if (
            (await compensateProviderOriginal(storage, objectKey)).status !==
            "compensated"
          ) {
            return "uncertain";
          }
          const removed = await markMediaObjectRemoved(
            runtime.db,
            input.workspaceId,
            {
              id: rejected.asset.id,
              lifecycle: "rejected",
              version: rejected.asset.version,
            },
          );
          return removed.status === "updated" ? "compensated" : "uncertain";
        },
        deadlineMs: IMAGE_PROVIDER_DEADLINE_MS,
        invocationKey,
        claimFence: {
          claimedBy: input.token,
          expectedVersion: renewed.version,
        },
        operationAttemptId: claimed.attempt.id,
        operationId: input.operationId,
        persistResult: (tx, prepared) =>
          attachProviderOriginal(tx, input.workspaceId, {
            attemptId: claimed.attempt.id,
            claimedBy: input.token,
            expectedVersion: renewed.version,
            media: {
              actualBytes: prepared.actualBytes,
              checksum: prepared.checksum,
              height: prepared.height,
              id: prepared.mediaAssetId,
              mimeType: prepared.mimeType,
              objectKey: prepared.objectKey,
              width: prepared.width,
            },
            operationId: input.operationId,
          }),
        prepareResult: ({ bytes, mimeType }) =>
          prepareProviderOriginal(storage, {
            bytes,
            mediaAssetId,
            mimeType,
            objectKey,
          }),
        prompt: providerInput.brief.providerPrompt,
        references: reference ? [reference] : undefined,
        rejectUnpreparedResult: () =>
          rejectReservedProviderOriginal(runtime.db, input.workspaceId, {
            attemptId: claimed.attempt.id,
            claimedBy: input.token,
            expectedVersion: renewed.version,
            mediaAssetId,
            objectKey,
            operationId: input.operationId,
          }),
        resolvePreparedResult: (_prepared, usageEventId) =>
          resolveProviderOriginalCommit(runtime.db, input.workspaceId, {
            attemptId: claimed.attempt.id,
            claimedBy: input.token,
            expectedVersion: renewed.version,
            mediaAssetId,
            objectKey,
            operationId: input.operationId,
            usageEventId,
          }),
        taskKey,
        workspaceId: input.workspaceId,
      });
      const settled = await settleClaimedImageAttempt(
        runtime,
        input,
        claimed.attempt.id,
        {
          outcome: "succeeded",
        },
      );
      if (!settled)
        return { operationId: input.operationId, status: "waiting" } as const;
      return { operationId: input.operationId, status: "succeeded" } as const;
    } catch (error) {
      if (!(error instanceof ModelGatewayInvocationError)) throw error;
      const resolution = await reconcileImageGatewayError(
        runtime,
        input,
        claimed.attempt.id,
        invocationKey,
        "provider",
        error,
      );
      if (resolution === "waiting") {
        return { operationId: input.operationId, status: "waiting" } as const;
      }
    }
  }

  const settled = await settleClaimedImageAttempt(
    runtime,
    input,
    claimed.attempt.id,
    {
      outcome: "failed_terminal",
      failureCode: "MODEL_INVOCATION_FAILED",
    },
  );
  if (!settled)
    return { operationId: input.operationId, status: "waiting" } as const;
  return { operationId: input.operationId, status: "failed" } as const;
}

export async function executeImageBrandedFinal(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
) {
  const existing = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (existing?.finalMediaAssetId) {
    const status = await attachFinalToGeneratingRevision(
      runtime,
      input,
      existing,
      existing.finalMediaAssetId,
    );
    return { operationId: input.operationId, status } as const;
  }
  if (
    !existing ||
    existing.claimedBy !== input.token ||
    existing.operationLifecycle !== "running" ||
    !(await renewImageLease(runtime, input, existing.operationVersion))
  ) {
    return { operationId: input.operationId, status: "waiting" } as const;
  }
  const claimed = await claimStage(runtime, input, "final");
  if (!claimed)
    return { operationId: input.operationId, status: "waiting" } as const;
  const providerInput = await loadImageProviderInput(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  const originalId = providerInput?.generation.providerOriginalMediaAssetId;
  const selection = providerInput?.brief.templateSelection;
  const artifacts = loadArtifacts(runtime, existing.mediaBrandKey);
  if (!originalId || !selection || !artifacts.logo) {
    return failedBrandedFinal(runtime, input, claimed.attempt.id);
  }
  const original = await getMediaAsset(
    runtime.db,
    input.workspaceId,
    originalId,
  );
  if (
    original?.lifecycle !== "verified" ||
    original.objectRemovedAt ||
    original.actualBytes === null ||
    original.checksum === null ||
    original.width === null ||
    original.height === null
  ) {
    return failedBrandedFinal(runtime, input, claimed.attempt.id);
  }
  const storage = workerStorage();
  const mediaAssetId = stableImageIdentity(input.operationId, "branded-final");
  const objectKey = `${input.workspaceId}/image-finals/${mediaAssetId}`;
  try {
    const originalBytes = await readVerifiedProviderOriginal(storage, {
      actualBytes: original.actualBytes,
      checksum: original.checksum,
      height: original.height,
      mimeType: original.mimeType,
      objectKey: original.objectKey,
      width: original.width,
    });
    const composed = await composeBrandedFinal({
      logo: artifacts.logo,
      original: originalBytes,
      profile: artifacts.profile,
    }).catch(() => {
      throw new ImagePreparationError({ outcome: "definite" });
    });
    const prepared = await prepareBrandedFinal(storage, {
      bytes: composed,
      height: artifacts.profile.output.height,
      mediaAssetId,
      objectKey,
      width: artifacts.profile.output.width,
    });
    const renewed = await renewImageLease(
      runtime,
      input,
      claimed.operation.version,
    );
    if (!renewed) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    const attached = await attachBrandedFinal(runtime.db, input.workspaceId, {
      attemptId: claimed.attempt.id,
      claimedBy: input.token,
      expectedVersion: renewed.version,
      mediaBrandId: existing.mediaBrandId,
      media: {
        actualBytes: prepared.actualBytes,
        checksum: prepared.checksum,
        height: prepared.height,
        id: prepared.mediaAssetId,
        mimeType: prepared.mimeType,
        objectKey: prepared.objectKey,
        width: prepared.width,
      },
      operationId: input.operationId,
      selectionSignature: selectionSignature(
        artifacts.profileFingerprint,
        selection,
      ),
    });
    if (attached === "not_owned") {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
    if (attached === "original_invalid") {
      return failedBrandedFinal(runtime, input, claimed.attempt.id);
    }
  } catch (error) {
    if (error instanceof ImagePreparationError) {
      return error.ambiguous
        ? ({ operationId: input.operationId, status: "waiting" } as const)
        : failedBrandedFinal(runtime, input, claimed.attempt.id);
    }
    if (!(await isBrandedFinalCommitted(runtime, input, mediaAssetId))) {
      return { operationId: input.operationId, status: "waiting" } as const;
    }
  }
  const attachment = await attachFinalToGeneratingRevision(
    runtime,
    input,
    existing,
    mediaAssetId,
  );
  if (attachment !== "succeeded") {
    return { operationId: input.operationId, status: attachment } as const;
  }
  const settled = await settleClaimedImageAttempt(
    runtime,
    input,
    claimed.attempt.id,
    { outcome: "succeeded" },
  );
  return {
    operationId: input.operationId,
    status: settled ? "succeeded" : "waiting",
  } as const;
}

async function attachFinalToGeneratingRevision(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  context: NonNullable<Awaited<ReturnType<typeof findImageExecutionContext>>>,
  finalMediaAssetId: string,
) {
  if (context.expectedImageIntentVersion === null) return "succeeded" as const;
  const result = await attachGeneratedFinalToRevision(
    runtime.db,
    context.workspaceId,
    {
      finalMediaAssetId,
      operationId: context.operationId,
    },
  );
  if (result.status === "attached" || result.status === "replayed") {
    return "succeeded" as const;
  }
  if (result.status === "superseded" || result.status === "media_locked") {
    const current = await findImageExecutionContext(
      runtime.db,
      input.workspaceId,
      input.operationId,
    );
    if (
      !current ||
      current.claimedBy !== input.token ||
      current.operationLifecycle !== "running"
    ) {
      return "superseded" as const;
    }
    const stopped = await stopSupersededPaidStage(
      runtime,
      input,
      current.operationVersion,
    );
    if (stopped === "current") {
      throw new Error("final image attachment supersession was not durable");
    }
    return stopped;
  }
  throw new Error(`final image attachment failed: ${result.status}`);
}

async function isBrandedFinalCommitted(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  mediaAssetId: string,
) {
  const current = await findImageExecutionContext(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  return current?.finalMediaAssetId === mediaAssetId;
}

async function failedBrandedFinal(
  runtime: WorkerRuntime,
  input: z.infer<typeof stageInvokeSchema>,
  attemptId: string,
) {
  const settled = await settleClaimedImageAttempt(runtime, input, attemptId, {
    failureCode: "VALIDATION_FAILED",
    outcome: "failed_terminal",
  });
  return {
    operationId: input.operationId,
    status: settled ? "failed" : "waiting",
  } as const;
}

function toSourceProjection(
  source: NonNullable<
    Awaited<ReturnType<typeof loadAuthorizedImageSource>>
  >["source"],
) {
  if (imageSourceProjectionReadiness(source) === "extract_required") {
    return null;
  }
  const digest = createHash("sha256")
    .update(JSON.stringify(source))
    .digest("hex");
  if (source.kind === "promo") {
    return {
      digest,
      id: source.promoIdeaId,
      kind: "promo_idea" as const,
      version: "promo-v1",
    };
  }
  if (source.kind === "telegram") {
    return {
      digest,
      id: source.sourceItemRevisionId,
      kind: "telegram_post" as const,
      secondaryDigest: source.contentHash,
      version: "telegram-v1",
    };
  }
  if (!source.sourceItemEnrichmentId || !source.pageContentHash) {
    return {
      digest,
      id: source.sourceItemRevisionId,
      kind: "rss_feed" as const,
      secondaryDigest: source.contentHash,
      version: "rss-feed-v1",
    };
  }
  return {
    digest,
    id: source.sourceItemEnrichmentId,
    kind: "rss_extract" as const,
    secondaryDigest: source.pageContentHash,
    version: "rss-extract-v1",
  };
}

async function settleInterruptedImage(
  step: WorkerStep,
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
  terminal: "cancelled" | "failed",
  callSite: string,
) {
  let context = await step.run(`reload-${callSite}-image`, () =>
    findImageExecutionContext(runtime.db, workspaceId, operationId),
  );
  if (!context) return { settled: false } as const;
  const interrupted = context;
  const outcome = await step.run(`settle-${callSite}-image`, () =>
    terminal === "cancelled"
      ? settleCancelledImageOperationAndWakeNext(runtime.db, workspaceId, {
          claimedBy: interrupted.claimedBy,
          expectedVersion: interrupted.operationVersion,
          mediaBrandId: interrupted.mediaBrandId,
          operationId,
        })
      : settleFailedImageOperationAndWakeNext(runtime.db, workspaceId, {
          claimedBy: interrupted.claimedBy,
          expectedVersion: interrupted.operationVersion,
          mediaBrandId: interrupted.mediaBrandId,
          operationId,
        }),
  );
  if (!outcome) {
    context = await step.run(`reload-${callSite}-image-terminal`, () =>
      findImageExecutionContext(runtime.db, workspaceId, operationId),
    );
    if (
      !context ||
      !IMAGE_TERMINAL_LIFECYCLES.includes(context.operationLifecycle)
    ) {
      return { settled: false } as const;
    }
  }
  if (!context) return { settled: false } as const;
  const operation = outcome?.operation ?? {
    lifecycle: context.operationLifecycle,
    version: context.operationVersion,
  };
  const usageChanged = outcome
    ? outcome.usageSettled
    : hasSettledUsage(
        (
          await step.run(`inspect-${callSite}-image-usage`, () =>
            inspectImageAttemptTruth(runtime.db, workspaceId, operationId),
          )
        ).rows,
      );
  const code = operation.lifecycle;
  await publishImageTransition(
    step,
    runtime,
    workspaceId,
    context,
    operation,
    code,
    callSite,
    usageChanged,
  );
  return { lifecycle: operation.lifecycle, settled: true } as const;
}

export function createImageGenerationFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  gatewayFactory: () => ModelGateway = () => workerModelGateway(runtime),
) {
  const stageConcurrency: [{ limit: number }] = [
    { limit: runtime.template.editorial.fanOut.unitConcurrency },
  ];
  const stageOptions = {
    concurrency: stageConcurrency,
    retries: IMAGE_STAGE_RETRIES,
  };
  const selection = client.createFunction(
    {
      ...stageOptions,
      id: "image-template-selection",
      triggers: [invoke(stageInvokeSchema)],
    },
    ({ event, step }) =>
      step.run("execute-image-template-selection", () =>
        executeImageSelection(runtime, gatewayFactory(), event.data),
      ),
  );
  const creative = client.createFunction(
    {
      ...stageOptions,
      id: "image-creative-brief",
      triggers: [invoke(stageInvokeSchema)],
    },
    ({ event, step }) =>
      step.run("execute-image-creative-brief", () =>
        executeImageCreativeBrief(runtime, gatewayFactory(), event.data),
      ),
  );
  const provider = client.createFunction(
    {
      ...stageOptions,
      id: "image-provider-original",
      triggers: [invoke(stageInvokeSchema)],
    },
    ({ event, step }) =>
      step.run("execute-image-provider-original", () =>
        executeImageProvider(runtime, gatewayFactory(), event.data),
      ),
  );
  const final = client.createFunction(
    {
      ...stageOptions,
      id: "image-branded-final",
      triggers: [invoke(stageInvokeSchema)],
    },
    ({ event, step }) =>
      step.run("execute-image-branded-final", () =>
        executeImageBrandedFinal(runtime, event.data),
      ),
  );
  const parent = client.createFunction(
    {
      id: IMAGE_GENERATION_FUNCTION_ID,
      retries: IMAGE_PARENT_RETRIES,
      triggers: [durableEvents.operationImageGenerationRequested],
      onFailure: async ({ event, step }) => {
        const { operationId, workspaceId } = event.data.event.data;
        await settleInterruptedImage(
          step,
          runtime,
          workspaceId,
          operationId,
          "failed",
          "image-failure",
        );
      },
    },
    async ({ event, runId, step }) => {
      const { operationId, workspaceId } = event.data;
      await step.run("assert-image-workspace", () =>
        assertWorkspace(runtime, workspaceId),
      );
      let context = await step.run("load-image-context", () =>
        findImageExecutionContext(runtime.db, workspaceId, operationId),
      );
      if (!context) throw new NonRetriableError("NOT_FOUND");
      const mediaBrandId = context.mediaBrandId;
      const oldest = await step.run("image-brand-admission", () =>
        findOldestImageOperationForBrand(runtime.db, workspaceId, mediaBrandId),
      );
      if (oldest !== operationId) {
        return { operationId, status: "waiting_for_brand" as const };
      }
      const truth = await step.run("inspect-image-attempt-truth", () =>
        inspectImageAttemptTruth(runtime.db, workspaceId, operationId),
      );
      if (truth.hasAmbiguousPaidWork) {
        await settleInterruptedImage(
          step,
          runtime,
          workspaceId,
          operationId,
          "failed",
          "image-ambiguous-attempt",
        );
        return { operationId, status: "waiting_for_attempt" as const };
      }
      const token = `inngest:${runId}`;
      const claim = await step.run("claim-image-operation", () =>
        claimOperationExecution(runtime.db, workspaceId, {
          claimedBy: token,
          id: operationId,
          leaseExpiresAt: new Date(Date.now() + 120_000),
          now: new Date(),
        }),
      );
      if (claim.status !== "claimed")
        return { operationId, status: "waiting" as const };
      await publishImageTransition(
        step,
        runtime,
        workspaceId,
        context,
        claim.operation,
        "running",
        "image-running",
        false,
      );
      for (const [id, fn] of [
        ["selection", selection],
        ["creative", creative],
        ["provider", provider],
        ["final", final],
      ] as const) {
        const result = stageResultSchema.parse(
          await step.invoke(`image-stage-${id}`, {
            data: { operationId, token, workspaceId },
            function: fn,
            timeout: IMAGE_STAGE_INVOKE_TIMEOUT,
          }),
        );
        if (result.status === "superseded") {
          context = await step.run(`reload-image-${id}-superseded`, () =>
            findImageExecutionContext(runtime.db, workspaceId, operationId),
          );
          if (
            context &&
            IMAGE_TERMINAL_LIFECYCLES.includes(context.operationLifecycle)
          ) {
            const supersededTruth = await step.run(
              `inspect-image-${id}-superseded-truth`,
              () =>
                inspectImageAttemptTruth(runtime.db, workspaceId, operationId),
            );
            await publishImageTransition(
              step,
              runtime,
              workspaceId,
              context,
              {
                lifecycle: context.operationLifecycle,
                version: context.operationVersion,
              },
              "cancelled",
              `image-${id}-superseded`,
              hasSettledUsage(supersededTruth.rows),
            );
          }
          return { operationId, status: "superseded" as const };
        }
        if (result.status !== "succeeded") {
          if (result.status === "failed") {
            context = await step.run(`reload-image-${id}-failed`, () =>
              findImageExecutionContext(runtime.db, workspaceId, operationId),
            );
          } else {
            for (
              let pass = 1;
              pass <= IMAGE_STAGE_QUIESCENCE_PASSES;
              pass += 1
            ) {
              await step.sleep(
                `await-image-${id}-quiescence-${pass}`,
                IMAGE_STAGE_QUIESCENCE_INTERVAL,
              );
              context = await step.run(`reload-image-${id}-${pass}`, () =>
                findImageExecutionContext(runtime.db, workspaceId, operationId),
              );
              if (context?.operationLifecycle !== "running") break;
            }
          }
          if (
            context?.claimedBy === token &&
            context.operationLifecycle === "running"
          ) {
            const runningContext = context;
            const latestTruth = await step.run(
              `inspect-image-${id}-truth`,
              () =>
                inspectImageAttemptTruth(runtime.db, workspaceId, operationId),
            );
            if (
              result.status === "failed" ||
              latestTruth.hasAmbiguousPaidWork
            ) {
              const settled = await step.run(
                `settle-image-${id}-terminal`,
                () =>
                  settleImageOperationAndWakeNext(runtime.db, workspaceId, {
                    claimedBy: token,
                    expectedVersion: runningContext.operationVersion,
                    lifecycle:
                      result.status === "failed" ? "failed" : "unknown",
                    mediaBrandId,
                    operationId,
                  }),
              );
              if (settled) {
                await publishImageTransition(
                  step,
                  runtime,
                  workspaceId,
                  runningContext,
                  settled,
                  settled.lifecycle === "unknown" ? "unknown" : "failed",
                  `image-${id}-terminal`,
                  hasSettledUsage(latestTruth.rows),
                );
              }
            } else {
              const released = await step.run(`wake-image-${id}`, () =>
                releaseImageOperationAndWake(runtime.db, workspaceId, {
                  claimedBy: token,
                  expectedVersion: runningContext.operationVersion,
                  operationId,
                }),
              );
              if (released) {
                await publishImageTransition(
                  step,
                  runtime,
                  workspaceId,
                  runningContext,
                  released,
                  "queued",
                  `image-${id}-queued`,
                  hasSettledUsage(latestTruth.rows),
                );
              }
            }
          }
          return {
            operationId,
            status:
              result.status === "failed"
                ? ("failed" as const)
                : ("waiting_for_stage" as const),
          };
        }
      }
      context = await step.run("reload-image-before-settle", () =>
        findImageExecutionContext(runtime.db, workspaceId, operationId),
      );
      if (!context || context.claimedBy !== token) {
        return { operationId, status: "waiting" as const };
      }
      const settled = await step.run("settle-image-operation", () =>
        settleImageOperationAndWakeNext(runtime.db, workspaceId, {
          claimedBy: token,
          expectedVersion: context.operationVersion,
          lifecycle: context.finalMediaAssetId ? "succeeded" : "failed",
          mediaBrandId: context.mediaBrandId,
          operationId,
        }),
      );
      if (settled) {
        await publishImageTransition(
          step,
          runtime,
          workspaceId,
          context,
          settled,
          settled.lifecycle === "succeeded" ? "succeeded" : "failed",
          "image-terminal",
          true,
        );
      }
      return { lifecycle: settled?.lifecycle ?? "unknown", operationId };
    },
  );
  const cancelled = client.createFunction(
    {
      id: "image-generation-cancelled",
      retries: IMAGE_PARENT_RETRIES,
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${client.id}-${IMAGE_GENERATION_FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = interruptedEnvelopeSchema.safeParse(event);
      if (!envelope.success) {
        const ids = cancelledIdsSchema.safeParse(event);
        await step.run("report-cancelled-event-invalid", async () => {
          workerLogger.error(
            "worker.image-generation.cancelled-event-invalid",
            {
              errorCode: "VALIDATION_FAILED",
              functionId: ids.success ? ids.data.data.function_id : undefined,
              runId: ids.success ? ids.data.data.run_id : undefined,
            },
          );
          return { parsed: false };
        });
        return { settled: false };
      }
      const { operationId, workspaceId } = envelope.data.data.event.data;
      return settleInterruptedImage(
        step,
        runtime,
        workspaceId,
        operationId,
        "cancelled",
        "image-cancelled",
      );
    },
  );
  return [parent, selection, creative, provider, final, cancelled];
}
