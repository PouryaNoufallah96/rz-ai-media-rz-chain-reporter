import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, type EmbeddingModel, embedMany } from "ai";
import { z } from "zod";

import { AdapterInvocationError } from "./errors";
import { generateStructured } from "./generate";
import type {
  EmbeddingAdapterInput,
  EmbeddingAdapterResult,
  ModelCallObservation,
  ObservedModelStep,
  RemoteModelAdapter,
} from "./types";
import { commonObservation } from "./usage";

const openRouterMetadataSchema = z.object({
  openrouter: z.object({
    provider: z.string(),
    usage: z.object({
      completionTokens: z.number(),
      completionTokensDetails: z
        .object({ reasoningTokens: z.number() })
        .optional(),
      cost: z.number().optional(),
      costDetails: z.object({ upstreamInferenceCost: z.number() }).optional(),
      promptTokens: z.number(),
      promptTokensDetails: z.object({ cachedTokens: z.number() }).optional(),
      totalTokens: z.number(),
    }),
  }),
});

export function createOpenRouterAdapter(apiKey: string): RemoteModelAdapter {
  let provider: ReturnType<typeof createOpenRouter> | undefined;

  return {
    embedMany(input) {
      provider ??= createOpenRouter({ apiKey, compatibility: "strict" });

      return embedManyRemote(provider.textEmbeddingModel(input.model), input);
    },

    generateStructured(input) {
      provider ??= createOpenRouter({ apiKey, compatibility: "strict" });
      const model = provider.chat(input.model);

      return generateStructured(
        model,
        input,
        emptyObservation(input.model),
        observeOpenRouterStep,
      );
    },
  };
}

async function embedManyRemote(
  model: EmbeddingModel,
  input: EmbeddingAdapterInput,
): Promise<EmbeddingAdapterResult> {
  const deadline = AbortSignal.timeout(input.deadlineMs);
  const result = await embedMany({
    model,
    values: input.values,
    maxRetries: 0,
    abortSignal: input.abortSignal
      ? AbortSignal.any([input.abortSignal, deadline])
      : deadline,
    telemetry: {
      functionId: "model-gateway.embed-many",
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
    },
  }).catch((error: unknown) => {
    throw classifyEmbeddingFailure(error, input);
  });

  const parsed = openRouterMetadataSchema.safeParse(result.providerMetadata);
  const metadata = parsed.success ? parsed.data.openrouter : undefined;
  const usage = metadata?.usage;
  const observation: ModelCallObservation = {
    completionTokens: finiteTokens(usage?.completionTokens),
    costAuthority: usage?.cost === undefined ? "unknown" : "billed_openrouter",
    generationId: null,
    openrouterCost: usage?.cost === undefined ? undefined : String(usage.cost),
    promptTokens: finiteTokens(usage?.promptTokens ?? result.usage.tokens),
    resolvedModel: input.model,
    totalTokens: finiteTokens(usage?.totalTokens ?? result.usage.tokens),
    upstreamProvider: metadata?.provider,
  };

  if (result.embeddings.length !== input.values.length) {
    throw new AdapterInvocationError("failed", false, observation);
  }

  return {
    embeddings: result.embeddings,
    observation,
    responseBody: result.responses?.[0]?.body,
  };
}

function classifyEmbeddingFailure(
  error: unknown,
  input: EmbeddingAdapterInput,
): AdapterInvocationError {
  const observation = emptyObservation(input.model);

  if (input.abortSignal?.aborted) {
    return new AdapterInvocationError("cancelled", false, observation);
  }

  if (
    (error instanceof Error || error instanceof DOMException) &&
    (error.name === "TimeoutError" || error.name === "AbortError")
  ) {
    return new AdapterInvocationError("unknown", false, observation);
  }

  if (APICallError.isInstance(error)) {
    return new AdapterInvocationError(
      error.statusCode === undefined ? "unknown" : "failed",
      error.isRetryable,
      observation,
    );
  }

  return new AdapterInvocationError("failed", false, observation);
}

function finiteTokens(tokens: number | undefined) {
  return tokens === undefined || !Number.isFinite(tokens) ? null : tokens;
}

function emptyObservation(model: string): ModelCallObservation {
  return {
    costAuthority: "unknown",
    resolvedModel: model,
  };
}

function observeOpenRouterStep(step: ObservedModelStep): ModelCallObservation {
  const parsed = openRouterMetadataSchema.safeParse(step.providerMetadata);
  const metadata = parsed.success ? parsed.data.openrouter : undefined;
  const usage = metadata?.usage;
  const generationId =
    step.response.headers?.["x-generation-id"] ?? step.response.id;

  return {
    ...commonObservation(step),
    cacheReadTokens:
      usage?.promptTokensDetails?.cachedTokens ??
      step.usage.inputTokenDetails.cacheReadTokens,
    completionTokens: usage?.completionTokens ?? step.usage.outputTokens,
    costAuthority: usage?.cost === undefined ? "unknown" : "billed_openrouter",
    generationId,
    openrouterCost: usage?.cost === undefined ? undefined : String(usage.cost),
    promptTokens: usage?.promptTokens ?? step.usage.inputTokens,
    reasoningTokens:
      usage?.completionTokensDetails?.reasoningTokens ??
      step.usage.outputTokenDetails.reasoningTokens,
    totalTokens: usage?.totalTokens ?? step.usage.totalTokens,
    upstreamInferenceCost:
      usage?.costDetails?.upstreamInferenceCost === undefined
        ? undefined
        : String(usage.costDetails.upstreamInferenceCost),
    upstreamProvider: metadata?.provider,
  };
}
