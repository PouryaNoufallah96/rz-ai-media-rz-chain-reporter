import "server-only";

import { createHash, randomUUID } from "node:crypto";
import type { ORPCErrorConstructorMap } from "@orpc/server";
import { installationProcedure } from "@rz-chain-reporter/api";
import {
  assembleCopy,
  COPY_CONFIGURATION_VERSION,
  COPY_PROMPT_VERSION,
  type ContentLocale,
  effectiveNewsSourceIds,
  INLINE_HASHTAG_TOKEN,
  isOperationSettled,
  okSchema,
  PLATFORM_COPY_HARD_MAX,
  platformCopyLength,
  runConfigurationSchema,
  runConfigurationTransportSchema,
} from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import {
  ANALYSIS_RUN_COMMAND_TYPE,
  requestAnalysisRunCancellation,
  startAnalysisRun,
} from "@rz-chain-reporter/db/repositories/analysis-run";
import { startCopyOperation } from "@rz-chain-reporter/db/repositories/copy-generation";
import { startCopyVariantTranslation as startCopyVariantTranslationCommand } from "@rz-chain-reporter/db/repositories/copy-variant-localization";
import {
  executeDraftRevisionCommand,
  readDraftRevisionCommandContext,
} from "@rz-chain-reporter/db/repositories/draft-revision";
import { startEditorialPresentationTranslation } from "@rz-chain-reporter/db/repositories/editorial-presentation-localization-request";
import { startImageGeneration as startImageGenerationCommand } from "@rz-chain-reporter/db/repositories/image-generation";
import {
  readRouteOriginContext,
  reorderPlatformDrafts,
  routePlatformDraft,
} from "@rz-chain-reporter/db/repositories/platform-draft";
import { env } from "@rz-chain-reporter/env/server";
import type { z } from "zod";

import {
  readPlatformDrafts,
  readRunLifecycle,
  selectAnalysisRunSources,
} from "@/features/editorial/db/queries";
import {
  copyOperationResultSchema,
  copyVariantTranslationCommandResultSchema,
  imageGenerationCommandResultSchema,
  refreshArticleAndRegenerateInputSchema,
  regenerateCopyInputSchema,
  reorderPlatformDraftsInputSchema,
  reorderPlatformDraftsResultSchema,
  retryCopyGenerationInputSchema,
  retryImageGenerationInputSchema,
  routePlatformDraftInputSchema,
  routePlatformDraftResultSchema,
  startCopyVariantTranslationInputSchema,
  startImageGenerationInputSchema,
  updateDraftRevisionInputSchema,
  updateDraftRevisionResultSchema,
} from "@/features/editorial/schemas/drafts";
import {
  cancelAnalysisRunInputSchema,
  presentationTranslationCommandResultSchema,
  startAnalysisRunResultSchema,
  startPresentationTranslationInputSchema,
} from "@/features/editorial/schemas/workspace";
import {
  customerBrandPolicyFingerprints,
  customerEditorial,
  customerTemplateFingerprint,
  customerTimeZone,
} from "@/lib/customer-template.server";

import { rpcDb } from "../db";

const customerRunConfigurationSchema = runConfigurationSchema(
  customerEditorial.bounds,
);

const copyOperationErrors = {
  VALIDATION_FAILED: { status: 400 },
  NOT_FOUND: { status: 404 },
  IDEMPOTENCY_KEY_REUSED: { status: 409 },
  OPERATION_IN_PROGRESS: { status: 409 },
  TEMPLATE_DRIFT: { status: 409 },
} as const;

const imageOperationErrors = {
  VALIDATION_FAILED: { status: 400 },
  NOT_FOUND: { status: 404 },
  IMAGE_SOURCE_EXTRACT_REQUIRED: { status: 409 },
  IMAGE_INTENT_CONFLICT: { status: 409 },
  MEDIA_LOCKED: { status: 409 },
  VERSION_CONFLICT: { status: 409 },
  IDEMPOTENCY_KEY_REUSED: { status: 409 },
  OPERATION_IN_PROGRESS: { status: 409 },
  REFERENCE_CONFLICT: { status: 409 },
} as const;

async function requireOwnRun(
  workspaceId: string,
  analysisRunId: string,
  userId: string,
  notFound: () => Error,
) {
  const run = await readRunLifecycle(
    rpcDb(),
    workspaceId,
    userId,
    analysisRunId,
  );
  if (!run) throw notFound();
  return run;
}

export const startImageGeneration = installationProcedure
  .input(startImageGenerationInputSchema)
  .output(imageGenerationCommandResultSchema)
  .errors(imageOperationErrors)
  .handler(({ context, errors, input }) =>
    executeImageCommand(context, errors, input),
  );

export const retryImageGeneration = installationProcedure
  .input(retryImageGenerationInputSchema)
  .output(imageGenerationCommandResultSchema)
  .errors(imageOperationErrors)
  .handler(({ context, errors, input }) =>
    executeImageCommand(context, errors, input),
  );

async function executeImageCommand(
  context: {
    requestId: string;
    session: { user: { id: string } };
    workspaceId: string;
  },
  errors: ORPCErrorConstructorMap<typeof imageOperationErrors>,
  input:
    | z.infer<typeof startImageGenerationInputSchema>
    | z.infer<typeof retryImageGenerationInputSchema>,
) {
  const model = customerEditorial.drafting.image.models.find(
    (item) => item.key === input.modelOptionKey && item.enabled,
  );
  if (!model) throw errors.VALIDATION_FAILED();
  const result = await startImageGenerationCommand(
    rpcDb(),
    context.workspaceId,
    {
      actor: context.session.user.id,
      draftRevisionId: input.draftRevisionId,
      expectedRevisionVersion: input.expectedRevisionVersion,
      expectedImageIntentVersion: input.expectedImageIntentVersion,
      idempotencyKey: input.idempotencyKey,
      modelOptionKey: input.modelOptionKey,
      operatorDirection: input.operatorDirection,
      referenceMediaAssetId: input.referenceMediaAssetId,
      requestHash: hashPayload({ ...input, kind: undefined }),
      requestId: context.requestId,
    },
  );
  if (result.status === "not_found") throw errors.NOT_FOUND();
  if (result.status === "image_source_extract_required") {
    throw errors.IMAGE_SOURCE_EXTRACT_REQUIRED();
  }
  if (result.status === "version_conflict") throw errors.VERSION_CONFLICT();
  if (result.status === "image_intent_conflict") {
    throw errors.IMAGE_INTENT_CONFLICT();
  }
  if (result.status === "media_locked") throw errors.MEDIA_LOCKED();
  if (result.status === "idempotency_mismatch") {
    throw errors.IDEMPOTENCY_KEY_REUSED();
  }
  if (result.status === "operation_in_progress") {
    throw errors.OPERATION_IN_PROGRESS();
  }
  if (result.status === "reference_conflict") {
    throw errors.REFERENCE_CONFLICT();
  }
  if (result.status === "reference_invalid") {
    throw errors.VALIDATION_FAILED();
  }
  if (!("operationId" in result)) throw errors.VALIDATION_FAILED();
  return result;
}

export const regenerateCopy = installationProcedure
  .input(regenerateCopyInputSchema)
  .output(copyOperationResultSchema)
  .errors(copyOperationErrors)
  .handler(async ({ context, errors, input }) => {
    return settleCopyOperation(
      await startCopyOperation(rpcDb(), context.workspaceId, {
        ...copyOperationIdentity(context, input),
        mode: "regenerate",
        modelOptionKey: input.modelOptionKey,
        requestedContentLocale: input.requestedContentLocale,
        copyPolicy: copyCommandPolicy(),
        customerTemplateFingerprint,
        promptVersion: COPY_PROMPT_VERSION,
        configurationVersion: COPY_CONFIGURATION_VERSION,
      }),
      errors,
    );
  });

export const refreshArticleAndRegenerate = installationProcedure
  .input(refreshArticleAndRegenerateInputSchema)
  .output(copyOperationResultSchema)
  .errors(copyOperationErrors)
  .handler(async ({ context, errors, input }) => {
    return settleCopyOperation(
      await startCopyOperation(rpcDb(), context.workspaceId, {
        ...copyOperationIdentity(context, input),
        mode: "refresh_article",
        modelOptionKey: input.modelOptionKey,
        requestedContentLocale: input.requestedContentLocale,
        copyPolicy: copyCommandPolicy(),
        customerTemplateFingerprint,
        promptVersion: COPY_PROMPT_VERSION,
        configurationVersion: COPY_CONFIGURATION_VERSION,
      }),
      errors,
    );
  });

export const retryCopyGeneration = installationProcedure
  .input(retryCopyGenerationInputSchema)
  .output(copyOperationResultSchema)
  .errors(copyOperationErrors)
  .handler(async ({ context, errors, input }) => {
    return settleCopyOperation(
      await startCopyOperation(rpcDb(), context.workspaceId, {
        ...copyOperationIdentity(context, input),
        mode: "retry_failed",
        requestedContentLocale: input.requestedContentLocale,
        copyPolicy: copyCommandPolicy(),
        customerTemplateFingerprint,
        promptVersion: COPY_PROMPT_VERSION,
        configurationVersion: COPY_CONFIGURATION_VERSION,
      }),
      errors,
    );
  });

export const startCopyVariantTranslation = installationProcedure
  .input(startCopyVariantTranslationInputSchema)
  .output(copyVariantTranslationCommandResultSchema)
  .errors({
    VALIDATION_FAILED: { status: 400 },
    NOT_FOUND: { status: 404 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const result = await startCopyVariantTranslationCommand(
      rpcDb(),
      context.workspaceId,
      {
        actor: context.session.user.id,
        copyVariantId: input.copyVariantId,
        contentLocale: input.contentLocale,
        idempotencyKey: input.idempotencyKey,
        requestHash: hashPayload({
          copyVariantId: input.copyVariantId,
          contentLocale: input.contentLocale,
        }),
        requestId: context.requestId,
      },
    );

    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "idempotency_mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    if (result.status === "already_available") {
      return { status: result.status };
    }
    if (!("operationId" in result)) throw errors.VALIDATION_FAILED();
    return {
      status: result.status,
      operationId: result.operationId,
      lifecycle: result.lifecycle,
    };
  });

export const updateDraftRevision = installationProcedure
  .input(updateDraftRevisionInputSchema)
  .output(updateDraftRevisionResultSchema)
  .errors({
    VALIDATION_FAILED: { status: 400 },
    NOT_FOUND: { status: 404 },
    VERSION_CONFLICT: { status: 409 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
    MEDIA_INVALID: { status: 400 },
    MEDIA_CONTENT_MISMATCH: { status: 409 },
    MEDIA_LOCKED: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const commandContext = await readDraftRevisionCommandContext(
      rpcDb(),
      context.workspaceId,
      input.platformDraftId,
      context.session.user.id,
      input.expectedActive.id,
      input.commandKind === "submit_content" ? input.source : undefined,
    );
    if (!commandContext) throw errors.NOT_FOUND();
    if (
      input.commandKind === "submit_content" &&
      !commandContext.sourceRevision
    ) {
      throw errors.NOT_FOUND();
    }

    const resolved = revisionCommand(input, commandContext);
    if (!resolved) throw errors.VALIDATION_FAILED();

    const result = await executeDraftRevisionCommand(
      rpcDb(),
      context.workspaceId,
      {
        ...resolved.command,
        actorId: context.session.user.id,
        requestHash: hashPayload(resolved.semanticPayload),
      },
    );
    if (!("revision" in result)) {
      if (result.status === "not_found") throw errors.NOT_FOUND();
      if (result.status === "version_conflict") {
        throw errors.VERSION_CONFLICT();
      }
      if (result.status === "validation_failed") {
        throw errors.VALIDATION_FAILED();
      }
      if (result.status === "media_invalid") throw errors.MEDIA_INVALID();
      if (result.status === "media_content_mismatch") {
        throw errors.MEDIA_CONTENT_MISMATCH();
      }
      if (result.status === "media_locked") throw errors.MEDIA_LOCKED();
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    const [snapshot] = await readPlatformDrafts(
      rpcDb(),
      context.workspaceId,
      { platformDraftId: input.platformDraftId },
      context.session.user.id,
      env.PUBLISHING_EMERGENCY_PAUSED,
      customerTimeZone,
      input.presentationLocale,
    );
    if (!snapshot) throw errors.NOT_FOUND();
    return {
      status: result.status,
      appendedRevision: result.appendedRevision,
      revision: {
        id: result.revision.id,
        revisionNumber: result.revision.revisionNumber,
      },
      card: snapshot.card,
    };
  });

function revisionCommand(
  input: z.infer<typeof updateDraftRevisionInputSchema>,
  context: NonNullable<
    Awaited<ReturnType<typeof readDraftRevisionCommandContext>>
  >,
) {
  const identity = {
    commandKind: input.commandKind,
    platformDraftId: input.platformDraftId,
    expectedActive: input.expectedActive,
  };
  if (input.commandKind === "select_revision") {
    return {
      command: input,
      semanticPayload: { ...identity, draftRevisionId: input.draftRevisionId },
    };
  }
  if (input.commandKind === "adopt_image") {
    return {
      command: input,
      semanticPayload: {
        ...identity,
        finalMediaAssetId: input.finalMediaAssetId,
        expectedImageIntentVersion: input.expectedImageIntentVersion,
      },
    };
  }
  if (input.commandKind === "remove_image") {
    return {
      command: input,
      semanticPayload: {
        ...identity,
        expectedImageIntentVersion: input.expectedImageIntentVersion,
      },
    };
  }

  const content = normalizeRevisionContent(
    input.content,
    context.sourceRevision?.hashtags[0] ?? null,
  );
  if (
    !content ||
    context.sourceRevision?.contentLocale !== content.contentLocale ||
    !validRevisionContent(context.platform, content)
  ) {
    return null;
  }
  return {
    command: { ...input, content },
    semanticPayload: { ...identity, source: input.source, content },
  };
}

function settleCopyOperation(
  result: Awaited<ReturnType<typeof startCopyOperation>>,
  errors: ORPCErrorConstructorMap<typeof copyOperationErrors>,
) {
  if (!("operationId" in result)) {
    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "idempotency_mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    if (result.status === "operation_in_progress") {
      throw errors.OPERATION_IN_PROGRESS();
    }
    if (result.status === "template_drift") {
      throw errors.TEMPLATE_DRIFT();
    }
    throw errors.VALIDATION_FAILED();
  }
  return result;
}

function copyOperationIdentity(
  context: {
    requestId: string;
    session: { user: { id: string } };
  },
  input: { idempotencyKey: string; platformDraftId: string; kind: string },
) {
  return {
    actor: context.session.user.id,
    platformDraftId: input.platformDraftId,
    idempotencyKey: input.idempotencyKey,
    requestHash: hashPayload(input),
    requestId: context.requestId,
  };
}

function copyCommandPolicy() {
  return {
    fingerprints: Object.fromEntries(customerBrandPolicyFingerprints),
    modelOptionKeys: customerEditorial.models.map((model) => model.key),
    platforms: customerEditorial.drafting.copy.platforms.map((entry) => ({
      platform: entry.platform,
      variantKeys: entry.variants.map((variant) => variant.key),
    })),
  };
}

function brandPolicyFingerprint(brandKey: string) {
  return customerBrandPolicyFingerprints.get(brandKey) ?? null;
}

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeRevisionContent(
  content: {
    contentLocale: ContentLocale;
    headline: string;
    body: string;
    hashtags: readonly string[];
  },
  canonicalHashtag: string | null,
) {
  if (!canonicalHashtag) return null;
  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const value of [canonicalHashtag, ...content.hashtags]) {
    const body = value.trim().replace(/^#+/u, "");
    if (!body || /\s/u.test(body)) return null;
    const hashtag = `#${body}`;
    const key = hashtag.toLocaleLowerCase("und");
    if (seen.has(key)) continue;
    seen.add(key);
    hashtags.push(hashtag);
  }
  return {
    contentLocale: content.contentLocale,
    headline: content.headline.trim(),
    body: content.body.trim(),
    hashtags,
  };
}

function validRevisionContent(
  platform: "instagram" | "telegram" | "x",
  content: NonNullable<ReturnType<typeof normalizeRevisionContent>>,
) {
  return (
    content.headline.match(INLINE_HASHTAG_TOKEN) === null &&
    content.body.match(INLINE_HASHTAG_TOKEN) === null &&
    content.hashtags.every((hashtag) => /^#[^\s#]+$/u.test(hashtag)) &&
    platformCopyLength(platform, assembleCopy(platform, content)) <=
      PLATFORM_COPY_HARD_MAX[platform]
  );
}

export const reorderDrafts = installationProcedure
  .input(reorderPlatformDraftsInputSchema)
  .output(reorderPlatformDraftsResultSchema)
  .errors({
    NOT_FOUND: { status: 404 },
    VERSION_CONFLICT: { status: 409 },
    LANE_MEMBERSHIP_CONFLICT: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const result = await reorderPlatformDrafts(rpcDb(), context.workspaceId, {
      ...input,
      actorId: context.session.user.id,
    });

    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "version_conflict") {
      throw errors.VERSION_CONFLICT();
    }
    if (result.status === "membership_conflict") {
      throw errors.LANE_MEMBERSHIP_CONFLICT();
    }
    if (!("drafts" in result)) throw errors.LANE_MEMBERSHIP_CONFLICT();
    return { drafts: result.drafts };
  });

export const routeDraft = installationProcedure
  .input(routePlatformDraftInputSchema)
  .output(routePlatformDraftResultSchema)
  .errors({
    VALIDATION_FAILED: { status: 400 },
    NOT_FOUND: { status: 404 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
    TEMPLATE_DRIFT: { status: 409 },
    TRANSIENT_CONFLICT: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const originContext = await readRouteOriginContext(
      rpcDb(),
      context.workspaceId,
      input.origin,
    );
    if (originContext.status !== "found") {
      if (originContext.status === "not_found") throw errors.NOT_FOUND();
      throw errors.VALIDATION_FAILED();
    }
    if (originContext.value.actorId !== context.session.user.id) {
      throw errors.NOT_FOUND();
    }
    if (
      originContext.value.templateFingerprint !== customerTemplateFingerprint
    ) {
      throw errors.TEMPLATE_DRIFT();
    }
    const policyFingerprint = brandPolicyFingerprint(
      originContext.value.mediaBrandKey,
    );
    if (!policyFingerprint) throw errors.TEMPLATE_DRIFT();

    const platformPolicy = customerEditorial.drafting.copy.platforms.find(
      (policy) => policy.platform === input.platform,
    );
    const modelAllowed = customerEditorial.models.some(
      (model) => model.key === input.modelOptionKey,
    );
    if (!platformPolicy || !modelAllowed) {
      throw errors.VALIDATION_FAILED({
        data: {
          issues: [
            {
              code: "custom",
              message: platformPolicy
                ? "MODEL_NOT_ALLOWED"
                : "PLATFORM_NOT_ALLOWED",
              path: platformPolicy ? ["modelOptionKey"] : ["platform"],
            },
          ],
        },
      });
    }

    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          origin: input.origin,
          platform: input.platform,
          modelOptionKey: input.modelOptionKey,
          requestedContentLocale: input.requestedContentLocale,
        }),
      )
      .digest("hex");
    const result = await routePlatformDraft(rpcDb(), context.workspaceId, {
      actor: context.session.user.id,
      ...input,
      requestHash,
      requestId: context.requestId,
      variantKeys: platformPolicy.variants.map((variant) => variant.key),
      customerTemplateFingerprint,
      brandPolicyFingerprint: policyFingerprint,
      mediaBrandKey: originContext.value.mediaBrandKey,
      promptVersion: COPY_PROMPT_VERSION,
      configurationVersion: COPY_CONFIGURATION_VERSION,
    }).catch((error: unknown) => {
      if (classifyDbError(error)?.kind === "retry") {
        throw errors.TRANSIENT_CONFLICT();
      }
      throw error;
    });

    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "stale_origin") throw errors.TEMPLATE_DRIFT();
    if (result.status === "mismatch") throw errors.IDEMPOTENCY_KEY_REUSED();
    if (result.status === "platform_not_allowed") {
      throw errors.VALIDATION_FAILED({
        data: {
          issues: [
            {
              code: "custom",
              message: "PLATFORM_NOT_ALLOWED",
              path: ["platform"],
            },
          ],
        },
      });
    }
    if (result.status === "invalid_disposition") {
      throw errors.VALIDATION_FAILED({
        data: {
          issues: [
            {
              code: "custom",
              message: "INVALID_TELEGRAM_DISPOSITION",
              path: ["origin"],
            },
          ],
        },
      });
    }
    if (!("draft" in result)) throw errors.TRANSIENT_CONFLICT();
    if (result.draft.lanePosition === null) {
      throw errors.TRANSIENT_CONFLICT();
    }

    return {
      status: result.status,
      draftId: result.draft.id,
      platform: result.draft.platform,
      lanePosition: result.draft.lanePosition,
      generationLifecycle: result.generationLifecycle,
    };
  });

export const startPresentationTranslation = installationProcedure
  .input(startPresentationTranslationInputSchema)
  .output(presentationTranslationCommandResultSchema)
  .errors({
    VALIDATION_FAILED: { status: 400 },
    NOT_FOUND: { status: 404 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const result = await startEditorialPresentationTranslation(
      rpcDb(),
      context.workspaceId,
      {
        actor: context.session.user.id,
        idempotencyKey: input.idempotencyKey,
        origin: input.origin,
        presentationLocale: input.presentationLocale,
        requestHash: hashPayload({
          origin: input.origin,
          presentationLocale: input.presentationLocale,
        }),
        requestId: context.requestId,
      },
    );

    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "invalid_origin") {
      throw errors.VALIDATION_FAILED();
    }
    if (result.status === "idempotency_mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    if (result.status === "already_available") {
      return { status: result.status };
    }
    return {
      status: result.status,
      operationId: result.operationId,
      lifecycle: result.lifecycle,
    };
  });

export const startRun = installationProcedure
  .input(runConfigurationTransportSchema)
  .output(startAnalysisRunResultSchema)
  .errors({
    VALIDATION_FAILED: { status: 400 },
    TRANSIENT_CONFLICT: { status: 409 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
    TEMPLATE_DRIFT: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const parsed = customerRunConfigurationSchema.safeParse(input);

    if (!parsed.success) {
      throw errors.VALIDATION_FAILED({ data: { issues: parsed.error.issues } });
    }

    const database = rpcDb();
    let configuration = parsed.data;

    if (configuration.kind === "news") {
      const selectedSources = await selectAnalysisRunSources(
        database,
        context.workspaceId,
        configuration.sourceIds,
      );

      if (selectedSources.length !== configuration.sourceIds.length) {
        throw errors.VALIDATION_FAILED();
      }

      const telegramSourceIds = selectedSources.flatMap((source) =>
        source.origin === "telegram_public" ? [source.id] : [],
      );
      const sourceValidated = runConfigurationSchema(customerEditorial.bounds, {
        telegramSourceIds,
      }).safeParse(configuration);

      if (!sourceValidated.success) {
        throw errors.VALIDATION_FAILED({
          data: { issues: sourceValidated.error.issues },
        });
      }
      if (sourceValidated.data.kind !== "news") {
        throw errors.VALIDATION_FAILED();
      }

      configuration = sourceValidated.data.telegramOnly
        ? {
            ...sourceValidated.data,
            sourceIds: effectiveNewsSourceIds(
              sourceValidated.data,
              telegramSourceIds,
            ),
          }
        : sourceValidated.data;
    }

    const operationId = randomUUID();
    const idempotencyKey = `${ANALYSIS_RUN_COMMAND_TYPE}:${operationId}`;

    const result = await startAnalysisRun(database, context.workspaceId, {
      operationId,
      actor: context.session.user.id,
      idempotencyKey,
      requestHash: createHash("sha256")
        .update(`${idempotencyKey}:${ANALYSIS_RUN_COMMAND_TYPE}`)
        .digest("hex"),
      requestId: context.requestId,
      kind: configuration.kind,
      configuration,
      templateFingerprint: customerTemplateFingerprint,
    }).catch((error: unknown) => {
      if (classifyDbError(error)?.kind === "retry") {
        throw errors.TRANSIENT_CONFLICT();
      }
      throw error;
    });

    if (result.status === "mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    if (result.status === "template_drift") {
      throw errors.TEMPLATE_DRIFT();
    }

    return {
      operationId: result.operationId,
      analysisRunId: result.analysisRunId,
    };
  });

export const cancelRun = installationProcedure
  .input(cancelAnalysisRunInputSchema)
  .output(okSchema)
  .errors({
    NOT_FOUND: { status: 404 },
  })
  .handler(async ({ context, errors, input }) => {
    const run = await requireOwnRun(
      context.workspaceId,
      input.analysisRunId,
      context.session.user.id,
      errors.NOT_FOUND,
    );

    // A settled run keeps its real outcome: no timestamp, no outbox event.
    if (isOperationSettled(run.lifecycle)) {
      return { ok: true };
    }

    const result = await requestAnalysisRunCancellation(
      rpcDb(),
      context.workspaceId,
      input.analysisRunId,
    );

    if (result.status === "not_found") {
      throw errors.NOT_FOUND();
    }

    return { ok: true };
  });
