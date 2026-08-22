import type {
  ModelBackend,
  UsageProviderGateway,
  UsageStatus,
} from "@rz-chain-reporter/contracts";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  finalizeUsage,
  finalizeUsageWithResult,
  insertPendingUsage,
} from "@rz-chain-reporter/db/repositories/ai-usage-event";

import {
  assertAppliedIdentity,
  type InstallationIdentity,
  InstallationIdentityError,
} from "../identity/assert";
import {
  AdapterInvocationError,
  ModelBindingError,
  ModelGatewayInvocationError,
} from "./errors";
import { createOllamaAdapter } from "./ollama";
import { createOpenRouterAdapter } from "./openrouter";
import { resolveModelTask } from "./task";
import type {
  EmbeddingModelInvocation,
  EmbeddingModelResult,
  ModelAdapter,
  ModelBindings,
  ModelCallObservation,
  RemoteModelAdapter,
  StructuredModelInvocation,
  StructuredModelResult,
} from "./types";

const MAX_DEADLINE_MS = 120_000;
const MAX_EMBEDDING_VALUES = 400;
const MAX_EMBEDDING_VALUE_LENGTH = 500;
const MAX_INSTRUCTIONS_LENGTH = 24_000;
const MAX_OUTPUT_TOKENS = 4_096;
const MAX_PROMPT_LENGTH = 24_000;

export type ModelGateway = {
  embedMany(input: EmbeddingModelInvocation): Promise<EmbeddingModelResult>;
  invokeStructured<TOutput>(
    input: StructuredModelInvocation<TOutput>,
  ): Promise<StructuredModelResult<TOutput>>;
};

export function createModelGateway(options: {
  bindings: ModelBindings;
  executor: Executor;
  identity: InstallationIdentity;
  template: CustomerTemplate;
}): ModelGateway {
  let localAdapter: ModelAdapter | undefined;
  let remoteAdapter: RemoteModelAdapter | undefined;

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

      if (route.backend !== "remote") {
        throw new ModelBindingError(
          `model task "${taskKey}" selects a local backend, which has no embedding adapter`,
        );
      }

      remoteAdapter ??= createBoundRemoteAdapter(options.bindings);
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
          providerGateway: "openrouter",
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

      const embedded = await remoteAdapter
        .embedMany({
          abortSignal: input.abortSignal,
          deadlineMs: input.deadlineMs,
          model: route.model,
          values: input.values,
        })
        .catch((error: unknown) =>
          failInvocation(
            options.executor,
            input.workspaceId,
            pending.event.id,
            route.model,
            error,
          ),
        );

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

      const generated = await adapter
        .generateStructured({
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
        })
        .catch((error: unknown) =>
          failInvocation(
            options.executor,
            input.workspaceId,
            pending.event.id,
            route.model,
            error,
          ),
        );

      try {
        const finalized = await finalizeUsageWithResult(
          options.executor,
          input.workspaceId,
          {
            id: pending.event.id,
            status: "succeeded",
            ...generated.observation,
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
          route.model,
          generated.observation,
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
    resolvedModel: event.requestedModel,
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

async function failInvocation(
  executor: Executor,
  workspaceId: string,
  usageEventId: string,
  model: string,
  error: unknown,
): Promise<never> {
  if (!(error instanceof AdapterInvocationError)) {
    await finalizeUnknown(executor, workspaceId, usageEventId, model);
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId,
    });
  }

  await finalizeAdapterFailure(executor, workspaceId, usageEventId, error);
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
  model: string,
  observation?: ModelCallObservation,
) {
  try {
    const finalized = await finalizeUsage(executor, workspaceId, {
      id: usageEventId,
      status: "unknown",
      costAuthority: observation?.costAuthority ?? "unknown",
      resolvedModel: observation?.resolvedModel ?? model,
      ...observation,
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
