import { AsyncLocalStorage } from "node:async_hooks";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { EmbedManyResult } from "ai";
import { z } from "zod";

import { AdapterInvocationError } from "./errors";
import {
  generateEmbeddings,
  generateImageOnce,
  generateStructured,
} from "./generate";
import type {
  ImageAdapterInput,
  ImageAdapterResult,
  ModelCallObservation,
  ObservedModelStep,
  RemoteModelAdapter,
} from "./types";
import {
  commonObservation,
  readProviderFailure,
  recordProviderFailure,
} from "./usage";

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

const imageResponseMetadataSchema = z.looseObject({
  id: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  usage: z
    .looseObject({
      completion_tokens: z.number().finite().nonnegative().optional(),
      cost: z.number().finite().nonnegative().optional(),
      prompt_tokens: z.number().finite().nonnegative().optional(),
      total_tokens: z.number().finite().nonnegative().optional(),
    })
    .optional(),
});

type ImageResponseMetadata = z.infer<typeof imageResponseMetadataSchema>;

export function createOpenRouterAdapter(
  apiKey: string,
  options: { fetch?: typeof fetch } = {},
): RemoteModelAdapter {
  let provider: ReturnType<typeof createOpenRouter> | undefined;
  const responseMetadata = new AsyncLocalStorage<{
    body?: ImageResponseMetadata;
    headers?: Record<string, string>;
  }>();
  const observedFetch: typeof fetch = async (input, init) => {
    const response = await (options.fetch ?? fetch)(input, init);
    const observer = responseMetadata.getStore();
    if (observer && response.ok) {
      observer.headers = Object.fromEntries(response.headers.entries());
      const parsed = imageResponseMetadataSchema.safeParse(
        await response
          .clone()
          .json()
          .catch(() => null),
      );
      if (parsed.success) observer.body = parsed.data;
    }
    return response;
  };

  const getProvider = () =>
    (provider ??= createOpenRouter({
      apiKey,
      compatibility: "strict",
      fetch: observedFetch,
    }));

  return {
    embedMany(input) {
      return generateEmbeddings(
        getProvider().textEmbeddingModel(input.model),
        input,
        emptyObservation(),
        observeOpenRouterEmbedding,
      );
    },

    async generateImage(input: ImageAdapterInput): Promise<ImageAdapterResult> {
      const observer: {
        body?: ImageResponseMetadata;
        headers?: Record<string, string>;
      } = {};
      let generated: Awaited<ReturnType<typeof generateImageOnce>>;
      try {
        generated = await responseMetadata.run(observer, () =>
          generateImageOnce(getProvider().imageModel(input.model), input),
        );
      } catch (error) {
        if (!(error instanceof AdapterInvocationError)) throw error;
        const observation = mergeImageFailureObservation(
          error.observation,
          inlineImageObservation(
            observer.headers?.["x-generation-id"] ?? observer.body?.id,
            observer.body,
          ),
        );
        const observedError = new AdapterInvocationError(
          error.kind,
          error.retryable,
          observation,
        );
        const diagnosis = readProviderFailure(error);
        throw diagnosis
          ? recordProviderFailure(observedError, diagnosis)
          : observedError;
      }
      const generationId =
        observer.headers?.["x-generation-id"] ?? observer.body?.id;
      const inlineObservation = inlineImageObservation(
        generationId,
        observer.body,
        generated.usage,
      );
      if (generated.responses.length !== 1 || !generationId) {
        throw new AdapterInvocationError("unknown", false, inlineObservation);
      }
      return {
        bytes: generated.bytes,
        mimeType: generated.mimeType,
        observation: inlineObservation,
      };
    },

    generateStructured(input) {
      const model = getProvider().chat(input.model);

      return generateStructured(
        model,
        input,
        emptyObservation(),
        observeOpenRouterStep,
      );
    },
  };
}

function observeOpenRouterEmbedding(
  result: EmbedManyResult,
): ModelCallObservation {
  const parsed = openRouterMetadataSchema.safeParse(result.providerMetadata);
  const metadata = parsed.success ? parsed.data.openrouter : undefined;
  const usage = metadata?.usage;

  return {
    completionTokens: finiteTokens(usage?.completionTokens),
    costAuthority: usage?.cost === undefined ? "unknown" : "billed_openrouter",
    generationId: null,
    openrouterCost: usage?.cost === undefined ? undefined : String(usage.cost),
    promptTokens: finiteTokens(usage?.promptTokens ?? result.usage.tokens),
    totalTokens: finiteTokens(usage?.totalTokens ?? result.usage.tokens),
    upstreamProvider: metadata?.provider,
  };
}

function inlineImageObservation(
  generationId: string | undefined,
  response: ImageResponseMetadata | undefined,
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  },
): ModelCallObservation {
  const responseUsage = response?.usage;
  const openrouterCost = responseUsage?.cost;

  return {
    costAuthority:
      openrouterCost === undefined ? "unknown" : "billed_openrouter",
    ...(generationId === undefined ? {} : { generationId }),
    ...(openrouterCost === undefined
      ? {}
      : { openrouterCost: String(openrouterCost) }),
    promptTokens: finiteTokens(
      responseUsage?.prompt_tokens ?? usage?.inputTokens,
    ),
    ...(response?.model === undefined ? {} : { resolvedModel: response.model }),
    totalTokens: finiteTokens(
      responseUsage?.total_tokens ?? usage?.totalTokens,
    ),
    completionTokens: finiteTokens(
      responseUsage?.completion_tokens ?? usage?.outputTokens,
    ),
  };
}

function mergeImageFailureObservation(
  failure: ModelCallObservation,
  inline: ModelCallObservation,
): ModelCallObservation {
  return {
    ...failure,
    ...inline,
    finishReason: failure.finishReason ?? inline.finishReason,
  };
}

function finiteTokens(tokens: number | undefined) {
  return tokens === undefined || !Number.isFinite(tokens) ? null : tokens;
}

function emptyObservation(): ModelCallObservation {
  return {
    costAuthority: "unknown",
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
