import {
  type AttemptOutcome,
  copyVariantTranslationRequestedPayloadSchema,
  type ErrorCode,
  errorCodeSchema,
  type OperationLifecycle,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  allocateCopyVariantTranslationAttempt,
  claimCopyVariantTranslation,
  completeCopyVariantTranslationInTransaction,
  failCopyVariantTranslation,
  failCopyVariantTranslationInTransaction,
  listStaleCopyVariantTranslations,
  loadCopyVariantTranslationRequest,
  settleCopyVariantTranslationFailure,
  settleStaleCopyVariantTranslation,
} from "@rz-chain-reporter/db/repositories/copy-variant-localization";
import {
  ModelBindingError,
  ModelGatewayInvocationError,
  ModelTaskConfigurationError,
} from "@rz-chain-reporter/model-gateway/errors";
import type { ModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import {
  copyVariantTranslationOutputSchema,
  copyVariantTranslationPrompt,
} from "../editorial/copy-variant-localization";
import { workerLogger } from "../logging/logger";
import { workerModelGateway } from "../model-gateway/worker-gateway";
import {
  notifyDraftsAndUsageChanged,
  notifyDraftsChanged,
} from "../web-cache/drafts";
import { publishOperationStatus, type WorkerStep } from "./channels";
import type { WorkerInngestClient } from "./client";
import {
  copyBrand,
  copyPolicy,
  normalizeCopyCandidate,
} from "./copy-generation";
import { durableEvents } from "./events";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

export const COPY_VARIANT_TRANSLATION_FUNCTION_ID =
  "copy-variant-translation" as const;
export const COPY_VARIANT_TRANSLATION_RETRIES = 0;

const CLAIM_LEASE_MS = 120_000;
const MODEL_DEADLINE_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4_096;
const STALE_TRANSLATION_BATCH = 10;

const cancelledIdsSchema = z.object({
  data: z.object({ function_id: z.string(), run_id: z.string() }),
});

const cancelledEnvelopeSchema = z.object({
  data: z.object({
    event: z.object({ data: copyVariantTranslationRequestedPayloadSchema }),
    run_id: z.string(),
  }),
});

type ExecutionResult = {
  actorId: string;
  analysisRunId: string;
  attemptCount: number;
  latestAttemptOutcome: AttemptOutcome;
  lifecycle: OperationLifecycle;
  operationVersion: number;
  platformDraftId: string;
};

type TranslationSettlementResult =
  | Awaited<ReturnType<typeof completeCopyVariantTranslationInTransaction>>
  | Awaited<ReturnType<typeof failCopyVariantTranslationInTransaction>>;

type CopyVariantTranslationTransition = {
  actorId: string;
  analysisRunId: string;
  lifecycle: OperationLifecycle;
  operationId: string;
  operationVersion: number;
  platformDraftId: string;
};

async function settleInterruptedCopyVariantTranslation(
  step: WorkerStep,
  runtime: WorkerRuntime,
  input: {
    claimedBy: string;
    failureCode: ErrorCode;
    operationId: string;
    workspaceId: string;
  },
) {
  const terminal = await step.run(
    "settle-interrupted-copy-variant-translation",
    async () => {
      const settled = await settleCopyVariantTranslationFailure(
        runtime.db,
        input.workspaceId,
        {
          claimedBy: input.claimedBy,
          failureCode: input.failureCode,
          operationId: input.operationId,
        },
      );
      if (settled.status !== "settled") return null;
      const request = await loadCopyVariantTranslationRequest(
        runtime.db,
        input.workspaceId,
        input.operationId,
      );
      if (request.status !== "ready") return null;
      workerLogger.warn("worker.copy-variant-translation.failed", {
        analysisRunId: request.analysisRunId,
        errorCode: input.failureCode,
        operationId: input.operationId,
        workspaceId: input.workspaceId,
      });
      return {
        actorId: request.actor,
        analysisRunId: request.analysisRunId,
        lifecycle: settled.lifecycle,
        operationId: input.operationId,
        operationVersion: settled.version,
        platformDraftId: request.source.platformDraftId,
      } satisfies CopyVariantTranslationTransition;
    },
  );
  if (!terminal) return null;
  await notifyDraftsAndUsageChanged(
    step,
    input.workspaceId,
    translationChange(terminal, input.operationId),
    "copy-variant-translation-failed",
    terminal.actorId,
  );
  await publishOperationStatus(
    step,
    input.workspaceId,
    {
      actorId: terminal.actorId,
      lifecycle: terminal.lifecycle,
      operationId: input.operationId,
      operationVersion: terminal.operationVersion,
      sharedImport: false,
    },
    "worker.copy-variant-translation.realtime-unavailable",
  );
  return terminal;
}

export async function reconcileStaleCopyVariantTranslations(
  executor: Executor,
  workspaceId: string,
  now: Date,
) {
  const candidates = await listStaleCopyVariantTranslations(
    executor,
    workspaceId,
    { limit: STALE_TRANSLATION_BATCH, now },
  );
  const settled: CopyVariantTranslationTransition[] = [];
  for (const candidate of candidates) {
    const result = await settleStaleCopyVariantTranslation(
      executor,
      workspaceId,
      {
        claimedBy: candidate.claimedBy,
        expectedVersion: candidate.operationVersion,
        now,
        operationId: candidate.operationId,
      },
    );
    if (result.status !== "settled") continue;
    const request = await loadCopyVariantTranslationRequest(
      executor,
      workspaceId,
      candidate.operationId,
    );
    if (request.status !== "ready") continue;
    settled.push({
      actorId: request.actor,
      analysisRunId: request.analysisRunId,
      lifecycle: result.lifecycle,
      operationId: candidate.operationId,
      operationVersion: result.version,
      platformDraftId: request.source.platformDraftId,
    });
  }
  return {
    staleCopyVariantTranslationsObserved: candidates.length,
    staleCopyVariantTranslationsSettled: settled,
  };
}

export function createCopyVariantTranslationFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  gatewayFactory: () => ModelGateway = () => workerModelGateway(runtime),
) {
  return client.createFunction(
    {
      id: COPY_VARIANT_TRANSLATION_FUNCTION_ID,
      retries: COPY_VARIANT_TRANSLATION_RETRIES,
      timeouts: { finish: "2m" },
      triggers: [durableEvents.operationCopyVariantTranslationRequested],
      onFailure: async ({ event, step }) => {
        const { operationId, workspaceId } = event.data.event.data;
        const failureCode = carriedFailureCode(event.data.error.message);
        await settleInterruptedCopyVariantTranslation(step, runtime, {
          claimedBy: `copy-variant-translation:${event.data.run_id}`,
          failureCode,
          operationId,
          workspaceId,
        });
      },
    },
    async ({ event, runId, step }) => {
      const { operationId, workspaceId } = event.data;
      const claimedBy = `copy-variant-translation:${runId}`;
      const claim = await step.run(
        "claim-copy-variant-translation",
        async () => {
          await assertWorkspace(runtime, workspaceId);
          const now = new Date();
          return claimCopyVariantTranslation(runtime.db, workspaceId, {
            claimedBy,
            leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
            now,
            operationId,
          });
        },
      );

      if (claim.status === "settled" || claim.status === "busy") {
        return { operationId, replayed: true };
      }
      if (claim.status === "not_found") {
        throw new NonRetriableError("NOT_FOUND");
      }

      const request = await step.run(
        "load-running-copy-variant-translation",
        async () => {
          const loaded = await loadCopyVariantTranslationRequest(
            runtime.db,
            workspaceId,
            operationId,
          );
          return loaded.status === "ready"
            ? {
                analysisRunId: loaded.analysisRunId,
                platformDraftId: loaded.source.platformDraftId,
                status: loaded.status,
              }
            : loaded;
        },
      );
      if (request.status !== "ready") {
        throw new NonRetriableError("NOT_FOUND");
      }

      await notifyDraftsChanged(
        step,
        workspaceId,
        {
          analysisRunId: request.analysisRunId,
          code: "running",
          operationId,
          platformDraftId: request.platformDraftId,
        },
        "copy-variant-translation-running",
      );
      await publishOperationStatus(
        step,
        workspaceId,
        {
          actorId: claim.operation.actor,
          lifecycle: "running",
          operationId,
          operationVersion: claim.operation.version,
          sharedImport: false,
        },
        "worker.copy-variant-translation.realtime-unavailable",
      );

      const execution = await step.run("translate-copy-variant", () =>
        executeCopyVariantTranslation(runtime, gatewayFactory(), {
          claimFence: {
            claimedBy,
            expectedVersion: claim.operation.version,
          },
          operationId,
          workspaceId,
        }),
      );

      await notifyDraftsAndUsageChanged(
        step,
        workspaceId,
        translationChange(execution, operationId),
        "copy-variant-translation-terminal",
        execution.actorId,
      );
      await publishOperationStatus(
        step,
        workspaceId,
        {
          actorId: execution.actorId,
          attemptCount: execution.attemptCount,
          latestAttemptOutcome: execution.latestAttemptOutcome,
          lifecycle: execution.lifecycle,
          operationId,
          operationVersion: execution.operationVersion,
          sharedImport: false,
        },
        "worker.copy-variant-translation.realtime-unavailable",
      );

      return { lifecycle: execution.lifecycle, operationId };
    },
  );
}

export function createCopyVariantTranslationFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  const primary = createCopyVariantTranslationFunction(client, runtime);
  const cancelled = client.createFunction(
    {
      id: "copy-variant-translation-cancelled",
      retries: 2,
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${client.id}-${COPY_VARIANT_TRANSLATION_FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = cancelledEnvelopeSchema.safeParse(event);
      if (!envelope.success) {
        const ids = cancelledIdsSchema.safeParse(event);
        await step.run("report-cancelled-event-invalid", () => {
          workerLogger.error(
            "worker.copy-variant-translation.cancelled-event-invalid",
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
      const terminal = await settleInterruptedCopyVariantTranslation(
        step,
        runtime,
        {
          claimedBy: `copy-variant-translation:${envelope.data.data.run_id}`,
          failureCode: "INTERNAL_SERVER_ERROR",
          operationId,
          workspaceId,
        },
      );
      return { settled: terminal !== null };
    },
  );
  return [primary, cancelled];
}

export async function executeCopyVariantTranslation(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  input: {
    claimFence: { claimedBy: string; expectedVersion: number };
    operationId: string;
    workspaceId: string;
  },
): Promise<ExecutionResult> {
  await assertWorkspace(runtime, input.workspaceId);
  const request = await loadCopyVariantTranslationRequest(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (request.status !== "ready") {
    throw new NonRetriableError("NOT_FOUND");
  }
  if (request.source.contentLocale === request.contentLocale) {
    throw new NonRetriableError("VALIDATION_FAILED");
  }

  const policy = copyPolicy(runtime, request.source.platform);
  const brand = copyBrand(runtime, request.source.mediaBrandKey);
  if (
    request.source.hashtags.length < policy.hashtags.min ||
    request.source.hashtags.length > policy.hashtags.max
  ) {
    throw new NonRetriableError("TEMPLATE_DRIFT");
  }
  const canonicalHashtag =
    brand.editorial.canonicalHashtags[request.contentLocale];
  const constraints = {
    canonicalHashtag,
    maximumCharacters: policy.assembledCharacters.max,
    maximumHashtags: policy.hashtags.max,
    minimumHashtags: policy.hashtags.min,
    platform: request.source.platform,
  };
  const outputSchema = copyVariantTranslationOutputSchema(
    request.source,
    request.contentLocale,
    constraints,
  );

  const allocated = await allocateCopyVariantTranslationAttempt(
    runtime.db,
    input.workspaceId,
    input.operationId,
    input.operationId,
    input.claimFence,
  );
  if (allocated.status !== "allocated") {
    throw new Error("copy variant translation attempt was not allocated");
  }

  const base = {
    actorId: request.actor,
    analysisRunId: request.analysisRunId,
    attemptCount: allocated.attempt.attemptNumber,
    platformDraftId: request.source.platformDraftId,
  };

  try {
    let settlement:
      | {
          latestAttemptOutcome: AttemptOutcome;
          result: TranslationSettlementResult;
        }
      | undefined;
    await gateway.invokeStructured({
      claimFence: input.claimFence,
      deadlineMs: MODEL_DEADLINE_MS,
      invocationKey: "primary",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      operationAttemptId: allocated.attempt.id,
      operationId: input.operationId,
      outputName: "copy_variant_translation",
      persistDefiniteFailure: async (tx, failure) => {
        const failed = await failCopyVariantTranslationInTransaction(
          tx,
          input.workspaceId,
          {
            claimFence: input.claimFence,
            failureCode: failure.code,
            operationAttemptId: allocated.attempt.id,
            operationId: input.operationId,
            outcome: "failed_terminal",
          },
        );
        requireTerminalSettlement(failed);
      },
      persistResult: async (tx, output) => {
        const checked = normalizeCopyCandidate(
          request.source.platform,
          output,
          {
            canonicalHashtag,
            emojiGraphemeCap: policy.emojiGraphemeCap,
            maximumCharacters: policy.assembledCharacters.max,
            maximumHashtags: policy.hashtags.max,
            minimumHashtags: policy.hashtags.min,
            requestedContentLocale: request.contentLocale,
            source: request.source.publishSource,
          },
        );
        const localization = {
          body: checked.body,
          hashtags: checked.hashtags,
          headline: checked.headline,
        };
        const policyAccepted =
          checked.hashtags.length === request.source.hashtags.length &&
          checked.failures.length === 0 &&
          outputSchema.safeParse(localization).success;
        if (!policyAccepted) {
          const failed = await failCopyVariantTranslationInTransaction(
            tx,
            input.workspaceId,
            {
              claimFence: input.claimFence,
              failureCode: "VALIDATION_FAILED",
              operationAttemptId: allocated.attempt.id,
              operationId: input.operationId,
              outcome: "failed_terminal",
            },
          );
          settlement = {
            latestAttemptOutcome: "failed_terminal",
            result: requireTerminalSettlement(failed),
          };
          return;
        }

        const completed = await completeCopyVariantTranslationInTransaction(
          tx,
          input.workspaceId,
          {
            claimFence: input.claimFence,
            localization,
            operationAttemptId: allocated.attempt.id,
            operationId: input.operationId,
          },
        );
        settlement = {
          latestAttemptOutcome: "succeeded",
          result: requireTerminalSettlement(completed),
        };
      },
      prompt: copyVariantTranslationPrompt(
        request.source,
        request.contentLocale,
        constraints,
      ),
      schema: outputSchema,
      taskKey: "text-translation",
      workspaceId: input.workspaceId,
    });
    if (settlement === undefined) {
      throw new Error("copy variant translation result was not persisted");
    }
    if (settlement.latestAttemptOutcome !== "succeeded") {
      workerLogger.warn("worker.copy-variant-translation.failed", {
        analysisRunId: request.analysisRunId,
        errorCode: "VALIDATION_FAILED",
        operationId: input.operationId,
        workspaceId: input.workspaceId,
      });
    }
    return terminalResult(
      base,
      settlement.result,
      settlement.latestAttemptOutcome,
    );
  } catch (error) {
    const failure = knownTranslationFailure(error);
    if (!failure) throw error;

    const failed = await failCopyVariantTranslation(
      runtime.db,
      input.workspaceId,
      {
        claimFence: input.claimFence,
        failureCode: failure.failureCode,
        operationAttemptId: allocated.attempt.id,
        operationId: input.operationId,
        outcome: failure.outcome,
      },
    );
    workerLogger.warn("worker.copy-variant-translation.failed", {
      analysisRunId: request.analysisRunId,
      errorCode: failure.failureCode,
      operationId: input.operationId,
      workspaceId: input.workspaceId,
    });
    return terminalResult(base, failed, failure.outcome);
  }
}

function terminalResult(
  base: {
    actorId: string;
    analysisRunId: string;
    attemptCount: number;
    platformDraftId: string;
  },
  result: TranslationSettlementResult,
  latestAttemptOutcome: AttemptOutcome,
): ExecutionResult {
  const settled = requireTerminalSettlement(result);
  return {
    ...base,
    latestAttemptOutcome,
    lifecycle: settled.lifecycle,
    operationVersion: settled.version,
  };
}

function requireTerminalSettlement(result: TranslationSettlementResult) {
  if (result.status !== "persisted" && result.status !== "settled") {
    throw new Error("copy variant translation persistence lost its claim");
  }
  return result;
}

function knownTranslationFailure(error: unknown): {
  failureCode: ErrorCode;
  outcome: "ambiguous" | "failed_terminal";
} | null {
  if (error instanceof ModelGatewayInvocationError) {
    return {
      failureCode: error.code,
      outcome: error.ambiguous ? "ambiguous" : "failed_terminal",
    };
  }
  if (
    error instanceof ModelBindingError ||
    error instanceof ModelTaskConfigurationError
  ) {
    return {
      failureCode: "MODEL_INVOCATION_FAILED",
      outcome: "failed_terminal",
    };
  }
  return null;
}

function carriedFailureCode(value: string): ErrorCode {
  const parsed = errorCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : "INTERNAL_SERVER_ERROR";
}

export function translationChange(
  execution: {
    analysisRunId: string;
    lifecycle: OperationLifecycle;
    platformDraftId: string;
  },
  operationId: string,
) {
  return {
    analysisRunId: execution.analysisRunId,
    code: execution.lifecycle === "settling" ? "running" : execution.lifecycle,
    operationId,
    platformDraftId: execution.platformDraftId,
  };
}
