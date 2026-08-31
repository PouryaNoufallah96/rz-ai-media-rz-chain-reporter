import {
  type AttemptOutcome,
  type ErrorCode,
  errorCodeSchema,
  type OperationLifecycle,
  presentationTranslationRequestedPayloadSchema,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  allocateEditorialPresentationTranslationAttempt,
  claimEditorialPresentationTranslation,
  completeEditorialPresentationTranslation,
  completeEditorialPresentationTranslationInTransaction,
  failEditorialPresentationTranslation,
  failEditorialPresentationTranslationInTransaction,
  listStaleEditorialPresentationTranslations,
  loadEditorialPresentationTranslationRequest,
  readEditorialPresentationTranslationPlatformDraftIds,
  settleEditorialPresentationTranslationFailure,
  settleStaleEditorialPresentationTranslation,
} from "@rz-chain-reporter/db/repositories/editorial-presentation-localization-request";
import {
  ModelBindingError,
  ModelGatewayInvocationError,
  ModelTaskConfigurationError,
} from "@rz-chain-reporter/model-gateway/errors";
import type { ModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import { NonRetriableError } from "inngest";
import { z } from "zod";

import {
  presentationTranslationOutputSchema,
  presentationTranslationPrompt,
  presentationTranslationWrites,
} from "../editorial/presentation-localization";
import { workerLogger } from "../logging/logger";
import { workerModelGateway } from "../model-gateway/worker-gateway";
import { notifyEditorialPresentationTranslationChanged } from "../web-cache/editorial";
import { publishOperationStatus, type WorkerStep } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

export const PRESENTATION_TRANSLATION_FUNCTION_ID =
  "presentation-translation" as const;
export const PRESENTATION_TRANSLATION_RETRIES = 0;

const CLAIM_LEASE_MS = 120_000;
const MODEL_DEADLINE_MS = 60_000;
const MAX_OUTPUT_TOKENS = 4_096;
const STALE_TRANSLATION_BATCH = 10;

const cancelledIdsSchema = z.object({
  data: z.object({ function_id: z.string(), run_id: z.string() }),
});

const cancelledEnvelopeSchema = z.object({
  data: z.object({
    event: z.object({ data: presentationTranslationRequestedPayloadSchema }),
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
  platformDraftIds: string[];
};

type TranslationSettlementResult =
  | Awaited<
      ReturnType<typeof completeEditorialPresentationTranslationInTransaction>
    >
  | Awaited<
      ReturnType<typeof failEditorialPresentationTranslationInTransaction>
    >;

type PresentationTranslationTransition = {
  actorId: string;
  analysisRunId: string;
  lifecycle: OperationLifecycle;
  operationId: string;
  operationVersion: number;
  platformDraftIds: string[];
};

async function settleInterruptedPresentationTranslation(
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
    "settle-interrupted-presentation-translation",
    async () => {
      const settled = await settleEditorialPresentationTranslationFailure(
        runtime.db,
        input.workspaceId,
        {
          claimedBy: input.claimedBy,
          failureCode: input.failureCode,
          operationId: input.operationId,
        },
      );
      if (settled.status !== "settled") return null;
      const request = await loadEditorialPresentationTranslationRequest(
        runtime.db,
        input.workspaceId,
        input.operationId,
      );
      if (request.status !== "ready") return null;
      workerLogger.warn("worker.presentation-translation.failed", {
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
        platformDraftIds: request.platformDraftIds,
      } satisfies PresentationTranslationTransition;
    },
  );
  if (!terminal) return null;
  await notifyEditorialPresentationTranslationChanged(
    step,
    input.workspaceId,
    {
      analysisRunId: terminal.analysisRunId,
      code: presentationTranslationChangeCode(terminal.lifecycle),
      operationId: input.operationId,
      platformDraftIds: terminal.platformDraftIds,
    },
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
    "worker.presentation-translation.realtime-unavailable",
  );
  return terminal;
}

export async function reconcileStalePresentationTranslations(
  executor: Executor,
  workspaceId: string,
  now: Date,
) {
  const candidates = await listStaleEditorialPresentationTranslations(
    executor,
    workspaceId,
    { limit: STALE_TRANSLATION_BATCH, now },
  );
  const settled: PresentationTranslationTransition[] = [];
  for (const candidate of candidates) {
    const result = await settleStaleEditorialPresentationTranslation(
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
    const request = await loadEditorialPresentationTranslationRequest(
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
      platformDraftIds: request.platformDraftIds,
    });
  }
  return {
    stalePresentationTranslationsObserved: candidates.length,
    stalePresentationTranslationsSettled: settled,
  };
}

export function createPresentationTranslationFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  gatewayFactory: () => ModelGateway = () => workerModelGateway(runtime),
) {
  return client.createFunction(
    {
      id: PRESENTATION_TRANSLATION_FUNCTION_ID,
      retries: PRESENTATION_TRANSLATION_RETRIES,
      timeouts: { finish: "2m" },
      triggers: [durableEvents.operationPresentationTranslationRequested],
      onFailure: async ({ event, step }) => {
        const { operationId, workspaceId } = event.data.event.data;
        const failureCode = carriedFailureCode(event.data.error.message);
        await settleInterruptedPresentationTranslation(step, runtime, {
          claimedBy: `presentation-translation:${event.data.run_id}`,
          failureCode,
          operationId,
          workspaceId,
        });
      },
    },
    async ({ event, runId, step }) => {
      const { operationId, workspaceId } = event.data;
      const claimedBy = `presentation-translation:${runId}`;
      const claim = await step.run("claim-translation", async () => {
        await assertWorkspace(runtime, workspaceId);
        const now = new Date();
        return claimEditorialPresentationTranslation(runtime.db, workspaceId, {
          claimedBy,
          leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
          now,
          operationId,
        });
      });

      if (claim.status === "settled") {
        return { operationId, replayed: true };
      }
      if (claim.status === "busy") {
        return { operationId, replayed: true };
      }
      if (claim.status === "not_found") {
        throw new NonRetriableError("NOT_FOUND");
      }

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
        "worker.presentation-translation.realtime-unavailable",
      );

      const execution = await step.run("translate-card", () =>
        executePresentationTranslation(runtime, gatewayFactory(), {
          claimFence: {
            claimedBy,
            expectedVersion: claim.operation.version,
          },
          operationId,
          workspaceId,
        }),
      );

      await notifyEditorialPresentationTranslationChanged(
        step,
        workspaceId,
        {
          analysisRunId: execution.analysisRunId,
          code: presentationTranslationChangeCode(execution.lifecycle),
          operationId,
          platformDraftIds: execution.platformDraftIds,
        },
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
        "worker.presentation-translation.realtime-unavailable",
      );

      return {
        lifecycle: execution.lifecycle,
        operationId,
      };
    },
  );
}

export function createPresentationTranslationFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  const primary = createPresentationTranslationFunction(client, runtime);
  const cancelled = client.createFunction(
    {
      id: "presentation-translation-cancelled",
      retries: 2,
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${client.id}-${PRESENTATION_TRANSLATION_FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = cancelledEnvelopeSchema.safeParse(event);
      if (!envelope.success) {
        const ids = cancelledIdsSchema.safeParse(event);
        await step.run("report-cancelled-event-invalid", () => {
          workerLogger.error(
            "worker.presentation-translation.cancelled-event-invalid",
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
      const terminal = await settleInterruptedPresentationTranslation(
        step,
        runtime,
        {
          claimedBy: `presentation-translation:${envelope.data.data.run_id}`,
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

export async function executePresentationTranslation(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  input: {
    claimFence: { claimedBy: string; expectedVersion: number };
    operationId: string;
    workspaceId: string;
  },
): Promise<ExecutionResult> {
  await assertWorkspace(runtime, input.workspaceId);
  const request = await loadEditorialPresentationTranslationRequest(
    runtime.db,
    input.workspaceId,
    input.operationId,
  );
  if (request.status !== "ready") {
    throw new NonRetriableError(
      request.status === "invalid_origin" ? "VALIDATION_FAILED" : "NOT_FOUND",
    );
  }

  const allocated = await allocateEditorialPresentationTranslationAttempt(
    runtime.db,
    input.workspaceId,
    input.operationId,
    input.operationId,
    input.claimFence,
  );
  if (allocated.status !== "allocated") {
    throw new Error("presentation translation attempt was not allocated");
  }

  const base = {
    actorId: request.actor,
    analysisRunId: request.analysisRunId,
    attemptCount: allocated.attempt.attemptNumber,
  };
  if (request.missingSubjects.length === 0) {
    const completed = await completeEditorialPresentationTranslation(
      runtime.db,
      input.workspaceId,
      {
        claimFence: input.claimFence,
        localizations: [],
        operationAttemptId: allocated.attempt.id,
        operationId: input.operationId,
      },
    );
    return terminalResult(
      runtime,
      input.workspaceId,
      input.operationId,
      base,
      completed,
      "succeeded",
    );
  }

  try {
    let completed:
      | Awaited<
          ReturnType<
            typeof completeEditorialPresentationTranslationInTransaction
          >
        >
      | undefined;
    await gateway.invokeStructured({
      claimFence: input.claimFence,
      deadlineMs: MODEL_DEADLINE_MS,
      invocationKey: "primary",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      operationAttemptId: allocated.attempt.id,
      operationId: input.operationId,
      outputName: "presentation_translation",
      persistDefiniteFailure: async (tx, failure) => {
        const failed = await failEditorialPresentationTranslationInTransaction(
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
        completed = await completeEditorialPresentationTranslationInTransaction(
          tx,
          input.workspaceId,
          {
            claimFence: input.claimFence,
            localizations: presentationTranslationWrites(
              request.missingSubjects,
              output,
            ),
            operationAttemptId: allocated.attempt.id,
            operationId: input.operationId,
          },
        );
        requireTerminalSettlement(completed);
      },
      prompt: presentationTranslationPrompt(
        request.missingSubjects,
        request.presentationLocale,
      ),
      schema: presentationTranslationOutputSchema(
        request.missingSubjects,
        request.presentationLocale,
      ),
      taskKey: "text-translation",
      workspaceId: input.workspaceId,
    });
    if (completed === undefined) {
      throw new Error("presentation translation result was not persisted");
    }
    return terminalResult(
      runtime,
      input.workspaceId,
      input.operationId,
      base,
      completed,
      "succeeded",
    );
  } catch (error) {
    const failure = knownTranslationFailure(error);
    if (!failure) throw error;

    const failed = await failEditorialPresentationTranslation(
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
    workerLogger.warn("worker.presentation-translation.failed", {
      analysisRunId: request.analysisRunId,
      errorCode: failure.failureCode,
      operationId: input.operationId,
      workspaceId: input.workspaceId,
    });
    return terminalResult(
      runtime,
      input.workspaceId,
      input.operationId,
      base,
      failed,
      failure.outcome,
    );
  }
}

async function terminalResult(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
  base: {
    actorId: string;
    analysisRunId: string;
    attemptCount: number;
  },
  result: TranslationSettlementResult,
  latestAttemptOutcome: AttemptOutcome,
): Promise<ExecutionResult> {
  const settled = requireTerminalSettlement(result);
  const platformDraftIds =
    await readEditorialPresentationTranslationPlatformDraftIds(
      runtime.db,
      workspaceId,
      operationId,
    );
  return {
    ...base,
    latestAttemptOutcome,
    lifecycle: settled.lifecycle,
    operationVersion: settled.version,
    platformDraftIds,
  };
}

function requireTerminalSettlement(result: TranslationSettlementResult) {
  if (result.status !== "persisted" && result.status !== "settled") {
    throw new Error("presentation translation persistence lost its claim");
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

export function presentationTranslationChangeCode(
  lifecycle: OperationLifecycle,
): Exclude<OperationLifecycle, "settling"> {
  return lifecycle === "settling" ? "running" : lifecycle;
}
