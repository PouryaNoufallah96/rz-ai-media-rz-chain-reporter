import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";

import { generateStructured } from "./generate";
import type {
  ModelAdapter,
  ModelCallObservation,
  ObservedModelStep,
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

export function createOpenRouterAdapter(apiKey: string): ModelAdapter {
  let provider: ReturnType<typeof createOpenRouter> | undefined;

  return {
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
