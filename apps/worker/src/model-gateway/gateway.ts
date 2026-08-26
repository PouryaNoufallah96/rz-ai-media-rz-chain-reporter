import {
  type ModelBackend,
  referenceImageMimeTypeSchema,
  type UsageProviderGateway,
  type UsageStatus,
} from "@rz-chain-reporter/contracts";
import { MAX_EMBEDDING_VALUES } from "@rz-chain-reporter/contracts/editorial";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  type FinalizeUsageInput,
  finalizeUsage,
  finalizeUsageWithResult,
  insertPendingUsage,
} from "@rz-chain-reporter/db/repositories/ai-usage-event";

import {
  assertAppliedIdentity,
  type InstallationIdentity,
  InstallationIdentityError,
} from "../identity/assert";
import { workerLogger } from "../logging/logger";
import {
  AdapterInvocationError,
  ImagePreparationError,
  ModelBindingError,
  ModelGatewayInvocationError,
} from "./errors";
import { createOllamaAdapter } from "./ollama";
import { createOpenRouterAdapter } from "./openrouter";
import { resolveModelTask } from "./task";
import type {
  EmbeddingModelInvocation,
  EmbeddingModelResult,
  ImageModelInvocation,
  ImageModelResult,
  ModelAdapter,
  ModelBindings,
  ModelCallObservation,
  PreparedImageResult,
  RemoteModelAdapter,
  StructuredAdapterResult,
  StructuredModelInvocation,
  StructuredModelResult,
} from "./types";
import { readProviderFailure } from "./usage";

const MAX_DEADLINE_MS = 120_000;
const MAX_EMBEDDING_VALUE_LENGTH = 500;
const MAX_INSTRUCTIONS_LENGTH = 24_000;
const MAX_IMAGE_PROMPT_LENGTH = 48_000;
export const MAX_OUTPUT_TOKENS = 8_192;
const MAX_PROMPT_LENGTH = 24_000;

export type ModelGateway = {
  embedMany(input: EmbeddingModelInvocation): Promise<EmbeddingModelResult>;
  invokeImage?: (input: ImageModelInvocation) => Promise<ImageModelResult>;
  invokeStructured<TOutput>(
    input: StructuredModelInvocation<TOutput>,
  ): Promise<StructuredModelResult<TOutput>>;
};

export function createModelGateway(options: {
  adapters?: { local?: ModelAdapter; remote?: RemoteModelAdapter };
  bindings: ModelBindings;
  executor: Executor;
  identity: InstallationIdentity;
  template: CustomerTemplate;
}): ModelGateway {
  let localAdapter = options.adapters?.local;
  let remoteAdapter = options.adapters?.remote;

  return {
    async embedMany(input) {
      assertEmbeddingBounds(input);
      const { route, taskKey } = resolveModelTask(
        options.template,
        input.taskKey,
        input.invocationKey,
      );

      await assertTemplateCurrent(
        options.executor,
        options.identity,
        input.workspaceId,
      );

      let adapter: ModelAdapter;
      if (route.backend === "remote") {
        remoteAdapter ??= createBoundRemoteAdapter(options.bindings);
        adapter = remoteAdapter;
      } else {
        localAdapter ??= createBoundLocalAdapter(options.bindings);
        adapter = localAdapter;
      }
      if (!adapter.embedMany) {
        throw new ModelBindingError(
          `model task "${taskKey}" selects a backend without an embedding adapter`,
        );
      }
      const embedMany = adapter.embedMany.bind(adapter);
      const providerGateway: UsageProviderGateway =
        route.backend === "remote" ? "openrouter" : "ollama";
      const pending = await insertPendingUsage(
        options.executor,
        input.workspaceId,
        {
          operationId: input.operationId,
          operationAttemptId: input.operationAttemptId,
          invocationKey: input.invocationKey,
          taskKey,
          apiKind: "embedding",
          backend: route.backend,
          providerGateway,
          requestedModel: route.model,
        },
      );

      if (!pending.inserted) {
        const replayStatus = await resolveReplayStatus(
          options.executor,
          input.workspaceId,
          pending.event,
          input.deadlineMs,
        );
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: replayStatus === "pending" || replayStatus === "unknown",
          usageEventId: pending.event.id,
        });
      }

      const embedded = await embedMany({
        abortSignal: input.abortSignal,
        deadlineMs: input.deadlineMs,
        model: route.model,
        values: input.values,
      }).catch((error: unknown) =>
        failInvocation(
          options.executor,
          input.workspaceId,
          pending.event.id,
          error,
        ),
      );

      const { persistResult } = input;
      if (persistResult !== undefined) {
        try {
          const persisted = await finalizeUsageWithResult(
            options.executor,
            input.workspaceId,
            {
              id: pending.event.id,
              status: "succeeded",
              ...embedded.observation,
            },
            (tx) => persistResult(tx, embedded.embeddings),
          );

          if (persisted.status !== "updated") {
            throw new Error(
              "usage row was not pending during result persistence",
            );
          }
        } catch {
          await finalizeUnknown(
            options.executor,
            input.workspaceId,
            pending.event.id,
            embedded.observation,
          );
          throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
            ambiguous: true,
            usageEventId: pending.event.id,
          });
        }

        return {
          embeddings: embedded.embeddings,
          responseBody: embedded.responseBody,
          usageEventId: pending.event.id,
        };
      }

      const finalized = await finalizeUsage(
        options.executor,
        input.workspaceId,
        {
          id: pending.event.id,
          status: "succeeded",
          ...embedded.observation,
        },
      );

      if (finalized.status !== "updated") {
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }

      return {
        embeddings: embedded.embeddings,
        responseBody: embedded.responseBody,
        usageEventId: pending.event.id,
      };
    },
    async invokeImage(input) {
      assertImageBounds(input);
      const { route, taskKey } = resolveModelTask(
        options.template,
        input.taskKey,
        input.invocationKey,
      );
      await assertTemplateCurrent(
        options.executor,
        options.identity,
        input.workspaceId,
      );
      if (route.backend !== "remote") {
        throw new ModelBindingError(
          "image generation requires a remote backend",
        );
      }
      remoteAdapter ??= createBoundRemoteAdapter(options.bindings);
      const pending = await insertPendingUsage(
        options.executor,
        input.workspaceId,
        {
          apiKind: "image",
          backend: route.backend,
          invocationKey: input.invocationKey,
          operationAttemptId: input.operationAttemptId,
          operationId: input.operationId,
          providerGateway: "openrouter",
          requestedModel: route.model,
          taskKey,
          ...(input.claimFence
            ? {
                claimFence: {
                  ...input.claimFence,
                  now: new Date(),
                },
              }
            : {}),
        },
      );
      if (!pending.inserted) {
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }
      const generated = await remoteAdapter
        .generateImage({
          abortSignal: input.abortSignal,
          deadlineMs: input.deadlineMs,
          model: route.model,
          prompt: input.prompt,
          reference: input.reference,
        })
        .catch(async (error: unknown) => {
          const failure = readProviderFailure(error);
          if (failure) {
            workerLogger.warn("model-gateway.image-failed", {
              attemptId: input.operationAttemptId,
              invocationKey: input.invocationKey,
              operationId: input.operationId,
              reason: failure.code,
              taskKey,
              ...(failure.httpStatus === undefined
                ? {}
                : { httpStatus: failure.httpStatus }),
            });
          }
          if (
            error instanceof AdapterInvocationError &&
            error.kind === "failed" &&
            (await input
              .rejectUnpreparedResult()
              .catch(() => "uncertain" as const)) !== "rejected"
          ) {
            return failInvocation(
              options.executor,
              input.workspaceId,
              pending.event.id,
              new AdapterInvocationError("unknown", false, error.observation),
              invocationClaimFence(input),
            );
          }
          return failInvocation(
            options.executor,
            input.workspaceId,
            pending.event.id,
            error,
            invocationClaimFence(input),
          );
        });
      let prepared: PreparedImageResult;
      try {
        prepared = await input.prepareResult({
          bytes: generated.bytes,
          mimeType: generated.mimeType,
          usageEventId: pending.event.id,
        });
      } catch (error) {
        const rejection =
          error instanceof ImagePreparationError && !error.ambiguous
            ? await input
                .rejectUnpreparedResult()
                .catch(() => "uncertain" as const)
            : "uncertain";
        if (
          error instanceof ImagePreparationError &&
          !error.ambiguous &&
          rejection === "rejected"
        ) {
          await finalizeDefiniteImageFailure(
            options.executor,
            input.workspaceId,
            pending.event.id,
            generated.observation,
            invocationClaimFence(input),
          );
          throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
            usageEventId: pending.event.id,
          });
        }
        await finalizeUnknown(
          options.executor,
          input.workspaceId,
          pending.event.id,
          generated.observation,
          invocationClaimFence(input),
        );
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }
      try {
        const finalized = await finalizeUsageWithResult(
          options.executor,
          input.workspaceId,
          {
            id: pending.event.id,
            status: "succeeded",
            ...generated.observation,
            claimFence: invocationClaimFence(input),
          },
          (tx) => input.persistResult(tx, prepared),
        );
        if (finalized.status !== "updated")
          throw new Error("image usage was not pending");
      } catch {
        const ownership = await input
          .resolvePreparedResult(prepared, pending.event.id)
          .catch(() => "uncertain" as const);
        if (ownership === "committed") {
          return { prepared, usageEventId: pending.event.id };
        }
        if (
          ownership === "absent" &&
          (await input
            .compensatePreparedResult(prepared)
            .catch(() => "uncertain" as const)) === "compensated"
        ) {
          await finalizeDefiniteImageFailure(
            options.executor,
            input.workspaceId,
            pending.event.id,
            generated.observation,
            invocationClaimFence(input),
          );
          throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
            usageEventId: pending.event.id,
          });
        }
        await finalizeUnknown(
          options.executor,
          input.workspaceId,
          pending.event.id,
          generated.observation,
          invocationClaimFence(input),
        );
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }
      return { prepared, usageEventId: pending.event.id };
    },

    async invokeStructured(input) {
      assertInvocationBounds(input);
      const { route, taskKey } = resolveModelTask(
        options.template,
        input.taskKey,
        input.invocationKey,
      );

      await assertTemplateCurrent(
        options.executor,
        options.identity,
        input.workspaceId,
      );

      let adapter: ModelAdapter;
      if (route.backend === "remote") {
        remoteAdapter ??= createBoundRemoteAdapter(options.bindings);
        adapter = remoteAdapter;
      } else {
        localAdapter ??= createBoundLocalAdapter(options.bindings);
        adapter = localAdapter;
      }

      const providerGateway: UsageProviderGateway =
        route.backend === "remote" ? "openrouter" : "ollama";
      const pending = await insertPendingUsage(
        options.executor,
        input.workspaceId,
        {
          operationId: input.operationId,
          operationAttemptId: input.operationAttemptId,
          invocationKey: input.invocationKey,
          taskKey,
          apiKind: "chat",
          backend: route.backend,
          providerGateway,
          requestedModel: route.model,
          ...(input.claimFence
            ? {
                claimFence: {
                  ...input.claimFence,
                  now: new Date(),
                },
              }
            : {}),
        },
      );

      if (!pending.inserted) {
        const replayStatus = await resolveReplayStatus(
          options.executor,
          input.workspaceId,
          pending.event,
          input.deadlineMs,
        );
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: replayStatus === "pending" || replayStatus === "unknown",
          usageEventId: pending.event.id,
        });
      }

      const generated = await (async (): Promise<
        StructuredAdapterResult<
          typeof input extends StructuredModelInvocation<infer T> ? T : never
        >
      > => {
        try {
          return await adapter.generateStructured({
            abortSignal: input.abortSignal,
            deadlineMs: input.deadlineMs,
            instructions: input.instructions,
            maxOutputTokens: input.maxOutputTokens,
            model: route.model,
            outputName: input.outputName,
            prompt: input.prompt,
            schema: input.schema,
            telemetry: {
              operationAttemptId: input.operationAttemptId,
              operationId: input.operationId,
              usageEventId: pending.event.id,
            },
          });
        } catch (error) {
          if (
            error instanceof AdapterInvocationError &&
            error.kind === "structured-output-invalid"
          ) {
            await finalizeStructuredFailure(
              options.executor,
              input.workspaceId,
              pending.event.id,
              error,
              input.persistDefiniteFailure,
              invocationClaimFence(input),
            );
            throw new ModelGatewayInvocationError("STRUCTURED_OUTPUT_INVALID", {
              usageEventId: pending.event.id,
            });
          }
          return failInvocation(
            options.executor,
            input.workspaceId,
            pending.event.id,
            error,
            invocationClaimFence(input),
          );
        }
      })();

      try {
        const finalized = await finalizeUsageWithResult(
          options.executor,
          input.workspaceId,
          {
            id: pending.event.id,
            status: "succeeded",
            ...generated.observation,
            claimFence: invocationClaimFence(input),
          },
          (tx) => input.persistResult(tx, generated.output),
        );

        if (finalized.status !== "updated") {
          throw new Error(
            "usage row was not pending during result persistence",
          );
        }
      } catch {
        await finalizeUnknown(
          options.executor,
          input.workspaceId,
          pending.event.id,
          generated.observation,
          invocationClaimFence(input),
        );
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }

      return { output: generated.output, usageEventId: pending.event.id };
    },
  };
}

async function finalizeDefiniteImageFailure(
  executor: Executor,
  workspaceId: string,
  usageEventId: string,
  observation: ModelCallObservation,
  claimFence?: FinalizeUsageInput["claimFence"],
) {
  const finalized = await finalizeUsage(executor, workspaceId, {
    id: usageEventId,
    status: "failed",
    ...observation,
    claimFence,
  });
  if (finalized.status !== "updated") {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId,
    });
  }
}

async function finalizeStructuredFailure(
  executor: Executor,
  workspaceId: string,
  usageEventId: string,
  error: AdapterInvocationError,
  persistDefiniteFailure:
    | StructuredModelInvocation<unknown>["persistDefiniteFailure"]
    | undefined,
  claimFence?: FinalizeUsageInput["claimFence"],
) {
  try {
    const finalized = await finalizeUsageWithResult(
      executor,
      workspaceId,
      {
        id: usageEventId,
        status: "failed",
        ...error.observation,
        claimFence,
      },
      (tx) =>
        persistDefiniteFailure?.(tx, {
          code: "STRUCTURED_OUTPUT_INVALID",
        }) ?? Promise.resolve(),
    );

    if (finalized.status !== "updated") {
      throw new Error("structured failure did not update its pending usage");
    }
  } catch {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId,
    });
  }
}

async function resolveReplayStatus(
  executor: Executor,
  workspaceId: string,
  event: {
    backend: ModelBackend;
    id: string;
    requestedModel: string;
    status: UsageStatus;
    updatedAt: Date;
  },
  deadlineMs: number,
): Promise<UsageStatus> {
  if (
    event.status !== "pending" ||
    Date.now() - event.updatedAt.getTime() < deadlineMs
  ) {
    return event.status;
  }

  const finalized = await finalizeUsage(executor, workspaceId, {
    id: event.id,
    status: "unknown",
    costAuthority: event.backend === "local" ? "local" : "unknown",
  });

  return finalized.status === "not_found" ? "unknown" : finalized.event.status;
}

function createBoundRemoteAdapter(bindings: ModelBindings) {
  if (!bindings.OPENROUTER_API_KEY) {
    throw new ModelBindingError("remote model backend is unbound");
  }
  return createOpenRouterAdapter(bindings.OPENROUTER_API_KEY);
}

function createBoundLocalAdapter(bindings: ModelBindings) {
  if (!bindings.OLLAMA_BASE_URL) {
    throw new ModelBindingError("local model backend is unbound");
  }
  return createOllamaAdapter(bindings.OLLAMA_BASE_URL);
}

async function assertTemplateCurrent(
  executor: Executor,
  identity: InstallationIdentity,
  workspaceId: string,
) {
  try {
    const current = await assertAppliedIdentity(executor, identity);
    if (current.workspaceId !== workspaceId) {
      throw new ModelGatewayInvocationError("TEMPLATE_DRIFT");
    }
  } catch (error) {
    if (
      error instanceof InstallationIdentityError ||
      error instanceof ModelGatewayInvocationError
    ) {
      throw new ModelGatewayInvocationError("TEMPLATE_DRIFT");
    }
    throw error;
  }
}

function assertInvocationBounds<TOutput>(
  input: StructuredModelInvocation<TOutput>,
) {
  if (
    input.prompt.length === 0 ||
    input.prompt.length > MAX_PROMPT_LENGTH ||
    (input.instructions?.length ?? 0) > MAX_INSTRUCTIONS_LENGTH ||
    !Number.isInteger(input.maxOutputTokens) ||
    input.maxOutputTokens < 1 ||
    input.maxOutputTokens > MAX_OUTPUT_TOKENS ||
    !Number.isInteger(input.deadlineMs) ||
    input.deadlineMs < 1 ||
    input.deadlineMs > MAX_DEADLINE_MS
  ) {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED");
  }
}

function assertEmbeddingBounds(input: EmbeddingModelInvocation) {
  if (
    input.values.length === 0 ||
    input.values.length > MAX_EMBEDDING_VALUES ||
    input.values.some(
      (value) =>
        value.length === 0 || value.length > MAX_EMBEDDING_VALUE_LENGTH,
    ) ||
    !Number.isInteger(input.deadlineMs) ||
    input.deadlineMs < 1 ||
    input.deadlineMs > MAX_DEADLINE_MS
  ) {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED");
  }
}

function assertImageBounds(input: ImageModelInvocation) {
  if (
    input.prompt.length === 0 ||
    input.prompt.length > MAX_IMAGE_PROMPT_LENGTH ||
    !Number.isInteger(input.deadlineMs) ||
    input.deadlineMs < 1 ||
    input.deadlineMs > MAX_DEADLINE_MS ||
    (input.reference !== undefined &&
      (input.reference.bytes.byteLength === 0 ||
        input.reference.bytes.byteLength > 10 * 1024 * 1024 ||
        !referenceImageMimeTypeSchema.safeParse(input.reference.mimeType)
          .success))
  ) {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED");
  }
}

async function failInvocation(
  executor: Executor,
  workspaceId: string,
  usageEventId: string,
  error: unknown,
  claimFence?: FinalizeUsageInput["claimFence"],
): Promise<never> {
  if (!(error instanceof AdapterInvocationError)) {
    await finalizeUnknown(
      executor,
      workspaceId,
      usageEventId,
      undefined,
      claimFence,
    );
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId,
    });
  }

  await finalizeAdapterFailure(
    executor,
    workspaceId,
    usageEventId,
    error,
    claimFence,
  );
  throw new ModelGatewayInvocationError(
    error.kind === "structured-output-invalid"
      ? "STRUCTURED_OUTPUT_INVALID"
      : "MODEL_INVOCATION_FAILED",
    {
      ambiguous: error.kind === "unknown",
      retryable: error.retryable && error.kind !== "unknown",
      usageEventId,
    },
  );
}

async function finalizeAdapterFailure(
  executor: Executor,
  workspaceId: string,
  usageEventId: string,
  error: AdapterInvocationError,
  claimFence?: FinalizeUsageInput["claimFence"],
) {
  try {
    const finalized = await finalizeUsage(executor, workspaceId, {
      id: usageEventId,
      status:
        error.kind === "cancelled"
          ? "cancelled"
          : error.kind === "unknown"
            ? "unknown"
            : "failed",
      ...error.observation,
      claimFence,
    });

    if (finalized.status !== "updated") {
      throw new Error(
        "usage failure finalization did not update its pending row",
      );
    }
  } catch {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId,
    });
  }
}

async function finalizeUnknown(
  executor: Executor,
  workspaceId: string,
  usageEventId: string,
  observation?: ModelCallObservation,
  claimFence?: FinalizeUsageInput["claimFence"],
) {
  try {
    const finalized = await finalizeUsage(executor, workspaceId, {
      id: usageEventId,
      status: "unknown",
      costAuthority: observation?.costAuthority ?? "unknown",
      ...observation,
      claimFence,
    });

    if (finalized.status !== "updated") {
      throw new Error(
        "usage unknown finalization did not update its pending row",
      );
    }
  } catch {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId,
    });
  }
}

function invocationClaimFence(input: {
  operationId: string;
  claimFence?: { claimedBy: string; expectedVersion: number };
}): FinalizeUsageInput["claimFence"] {
  return input.claimFence
    ? { operationId: input.operationId, ...input.claimFence }
    : undefined;
}
