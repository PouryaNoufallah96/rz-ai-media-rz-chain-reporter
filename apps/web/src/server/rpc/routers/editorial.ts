import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { installationProcedure } from "@rz-chain-reporter/api";
import {
  assembleCopy,
  COPY_CONFIGURATION_VERSION,
  COPY_PROMPT_VERSION,
  effectiveNewsSourceIds,
  INLINE_HASHTAG_TOKEN,
  okSchema,
  PLATFORM_COPY_HARD_MAX,
  platformCopyLength,
  runConfigurationSchema,
} from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import {
  ANALYSIS_RUN_COMMAND_TYPE,
  requestAnalysisRunCancellation,
  startAnalysisRun,
} from "@rz-chain-reporter/db/repositories/analysis-run";
import { startCopyOperation } from "@rz-chain-reporter/db/repositories/copy-generation";
import {
  executeDraftRevisionCommand,
  readDraftRevisionCommandContext,
} from "@rz-chain-reporter/db/repositories/draft-revision";
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
  imageGenerationCommandResultSchema,
  refreshArticleAndRegenerateInputSchema,
  regenerateCopyInputSchema,
  reorderPlatformDraftsInputSchema,
  reorderPlatformDraftsResultSchema,
  retryCopyGenerationInputSchema,
  retryImageGenerationInputSchema,
  routePlatformDraftInputSchema,
  routePlatformDraftResultSchema,
  startImageGenerationInputSchema,
  updateDraftRevisionInputSchema,
  updateDraftRevisionResultSchema,
} from "@/features/editorial/schemas/drafts";
import {
  cancelAnalysisRunInputSchema,
  startAnalysisRunInputSchema,
  startAnalysisRunResultSchema,
} from "@/features/editorial/schemas/workspace";
import {
  customerBrandPolicyFingerprints,
  customerEditorial,
  customerTemplateFingerprint,
  customerTimeZone,
} from "@/lib/customer-template.server";

import { rpcDb } from "../db";

const TERMINAL_LIFECYCLES = ["succeeded", "failed", "cancelled", "unknown"];

const customerRunConfigurationSchema = runConfigurationSchema(
  customerEditorial.bounds,
);

const copyOperationErrors = {
  UNAUTHORIZED: { status: 401 },
  VALIDATION_FAILED: { status: 400 },
  NOT_FOUND: { status: 404 },
  IDEMPOTENCY_KEY_REUSED: { status: 409 },
  OPERATION_IN_PROGRESS: { status: 409 },
  TEMPLATE_DRIFT: { status: 409 },
} as const;

const imageOperationErrors = {
  UNAUTHORIZED: { status: 401 },
  VALIDATION_FAILED: { status: 400 },
  NOT_FOUND: { status: 404 },
  IMAGE_SOURCE_EXTRACT_REQUIRED: { status: 409 },
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
    requestId: string | null;
    session: { user: { id: string } };
    workspaceId: string;
  },
  errors: {
    IDEMPOTENCY_KEY_REUSED: () => Error;
    IMAGE_SOURCE_EXTRACT_REQUIRED: () => Error;
    NOT_FOUND: () => Error;
    OPERATION_IN_PROGRESS: () => Error;
    REFERENCE_CONFLICT: () => Error;
    VALIDATION_FAILED: () => Error;
    VERSION_CONFLICT: () => Error;
  },
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
        copyPolicy: copyCommandPolicy(),
        customerTemplateFingerprint,
        promptVersion: COPY_PROMPT_VERSION,
        configurationVersion: COPY_CONFIGURATION_VERSION,
      }),
      errors,
    );
  });

export const updateDraftRevision = installationProcedure
  .input(updateDraftRevisionInputSchema)
  .output(updateDraftRevisionResultSchema)
  .errors({
    UNAUTHORIZED: { status: 401 },
    VALIDATION_FAILED: { status: 400 },
    NOT_FOUND: { status: 404 },
    VERSION_CONFLICT: { status: 409 },
    IDEMPOTENCY_KEY_REUSED: { status: 409 },
    MEDIA_INVALID: { status: 400 },
    MEDIA_CONTENT_MISMATCH: { status: 409 },
  })
  .handler(async ({ context, errors, input }) => {
    const commandContext = await readDraftRevisionCommandContext(
      rpcDb(),
      context.workspaceId,
      input.platformDraftId,
      context.session.user.id,
      input.expectedActive.id,
    );
    if (!commandContext) throw errors.NOT_FOUND();

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
      if (result.status === "media_invalid") throw errors.MEDIA_INVALID();
      if (result.status === "media_content_mismatch") {
        throw errors.MEDIA_CONTENT_MISMATCH();
      }
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    const [snapshot] = await readPlatformDrafts(
      rpcDb(),
      context.workspaceId,
      { platformDraftId: input.platformDraftId },
      context.session.user.id,
      env.PUBLISHING_EMERGENCY_PAUSED,
      customerTimeZone,
      customerEditorial.drafting.image.models.filter((model) => model.enabled),
    );
    if (!snapshot) throw errors.NOT_FOUND();
    return {
      status: result.status,
      appendedRevision: result.appendedRevision,
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
  if (input.commandKind === "apply_copy_variant") {
    return {
      command: input,
      semanticPayload: { ...identity, copyVariantId: input.copyVariantId },
    };
  }
  if (input.commandKind === "adopt_image") {
    return {
      command: input,
      semanticPayload: {
        ...identity,
        finalMediaAssetId: input.finalMediaAssetId,
      },
    };
  }
  if (input.commandKind === "remove_image") {
    return { command: input, semanticPayload: identity };
  }

  const content = normalizeRevisionContent(
    input.content,
    context.expectedRevision?.hashtags[0] ?? null,
  );
  if (
    !content ||
    context.expectedRevision?.contentLocale !== content.contentLocale ||
    !validRevisionContent(context.platform, content)
  ) {
    return null;
  }
  return {
    command: { ...input, content },
    semanticPayload: { ...identity, content },
  };
}

type CopyErrors = {
  IDEMPOTENCY_KEY_REUSED: () => Error;
  NOT_FOUND: () => Error;
  OPERATION_IN_PROGRESS: () => Error;
  TEMPLATE_DRIFT: () => Error;
  VALIDATION_FAILED: () => Error;
};

function settleCopyOperation(
  result: Awaited<ReturnType<typeof startCopyOperation>>,
  errors: CopyErrors,
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
    requestId: string | null;
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
    contentLocale: "en" | "fa";
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
    UNAUTHORIZED: { status: 401 },
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
    UNAUTHORIZED: { status: 401 },
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

    return {
      status: result.status,
      draftId: result.draft.id,
      platform: result.draft.platform,
      lanePosition: result.draft.lanePosition,
      generationLifecycle: result.generationLifecycle,
    };
  });

export const startRun = installationProcedure
  .input(startAnalysisRunInputSchema)
  .output(startAnalysisRunResultSchema)
  .errors({
    UNAUTHORIZED: { status: 401 },
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
    UNAUTHORIZED: { status: 401 },
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
    if (TERMINAL_LIFECYCLES.includes(run.lifecycle)) {
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
