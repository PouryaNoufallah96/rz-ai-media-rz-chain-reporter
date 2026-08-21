import { createOpenAICompatible } from "@ai-sdk/openai-compatible";

import { generateStructured } from "./generate";
import type {
  ModelAdapter,
  ModelCallObservation,
  ObservedModelStep,
} from "./types";
import { commonObservation } from "./usage";

export function createOllamaAdapter(baseUrl: string): ModelAdapter {
  let provider: ReturnType<typeof createOpenAICompatible> | undefined;

  return {
    generateStructured(input) {
      provider ??= createOpenAICompatible({
        baseURL: `${baseUrl.replace(/\/$/, "")}/v1`,
        name: "ollama",
        supportsStructuredOutputs: true,
      });

      return generateStructured(
        provider.chatModel(input.model),
        input,
        emptyObservation(input.model),
        observeOllamaStep,
      );
    },
  };
}

function emptyObservation(model: string): ModelCallObservation {
  return {
    costAuthority: "local",
    resolvedModel: model,
  };
}

function observeOllamaStep(step: ObservedModelStep): ModelCallObservation {
  return {
    ...commonObservation(step),
    costAuthority: "local",
    generationId: null,
  };
}
