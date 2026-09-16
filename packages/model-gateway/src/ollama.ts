import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import {
  generateEmbeddings,
  generateStructured,
  streamSynthesis,
} from "./generate";
import type {
  ModelAdapter,
  ModelCallObservation,
  ObservedModelStep,
} from "./types";
import { commonObservation } from "./usage";

export function createOllamaAdapter(
  baseUrl: string,
  options: { fetch?: typeof fetch } = {},
): ModelAdapter {
  let provider: ReturnType<typeof createOpenAICompatible> | undefined;
  const getProvider = () =>
    (provider ??= createOpenAICompatible({
      baseURL: `${baseUrl.replace(/\/$/, "")}/v1`,
      fetch: options.fetch,
      name: "ollama",
      supportsStructuredOutputs: true,
    }));

  return {
    embedMany(input) {
      return generateEmbeddings(
        getProvider().embeddingModel(input.model),
        input,
        emptyObservation(input.model),
        (result) => ({
          costAuthority: "local",
          generationId: null,
          promptTokens: finiteTokens(result.usage.tokens),
          resolvedModel: input.model,
          totalTokens: finiteTokens(result.usage.tokens),
        }),
      );
    },

    generateStructured(input) {
      return generateStructured(
        getProvider().chatModel(input.model),
        withNoThink(input),
        emptyObservation(input.model),
        observeOllamaStep,
      );
    },

    streamText(input) {
      const forwarded = withNoThink(input);
      return streamSynthesis(
        getProvider().chatModel(forwarded.model),
        forwarded,
        observeOllamaStep,
      );
    },
  };
}

function finiteTokens(tokens: number | undefined) {
  return tokens === undefined || !Number.isFinite(tokens) ? null : tokens;
}

function emptyObservation(model: string): ModelCallObservation {
  return {
    costAuthority: "local",
    resolvedModel: model,
  };
}

function withNoThink<T extends { prompt: string; providerOptions?: unknown }>(
  input: T,
): T {
  const thinkDisabled =
    (input.providerOptions as { ollama?: { think?: boolean } } | undefined)
      ?.ollama?.think === false;
  return thinkDisabled && !input.prompt.endsWith(" /no_think")
    ? { ...input, prompt: `${input.prompt} /no_think` }
    : input;
}

function observeOllamaStep(step: ObservedModelStep): ModelCallObservation {
  return {
    ...commonObservation(step),
    costAuthority: "local",
    generationId: null,
  };
}
