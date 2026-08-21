import type { LanguageModel } from "ai";
import {
  APICallError,
  generateText,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";

import { AdapterInvocationError } from "./errors";
import type {
  ModelCallObservation,
  ObservedModelStep,
  StructuredAdapterInput,
  StructuredAdapterResult,
} from "./types";

export async function generateStructured<TOutput>(
  model: LanguageModel,
  input: StructuredAdapterInput<TOutput>,
  emptyObservation: ModelCallObservation,
  observe: (step: ObservedModelStep) => ModelCallObservation,
): Promise<StructuredAdapterResult<TOutput>> {
  let observation = emptyObservation;

  try {
    const result = await generateText({
      model,
      instructions: input.instructions,
      prompt: input.prompt,
      output: Output.object({
        name: input.outputName,
        schema: input.schema,
      }),
      maxOutputTokens: input.maxOutputTokens,
      maxRetries: 0,
      timeout: { totalMs: input.deadlineMs },
      abortSignal: input.abortSignal,
      runtimeContext: input.telemetry,
      telemetry: {
        functionId: "model-gateway.generate-structured",
        includeRuntimeContext: {
          operationAttemptId: true,
          operationId: true,
          usageEventId: true,
        },
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
      },
      onStepEnd(step) {
        observation = observe({
          finishReason: step.finishReason,
          modelId: step.model.modelId,
          providerMetadata: step.providerMetadata,
          rawFinishReason: step.rawFinishReason,
          response: step.response,
          usage: step.usage,
        });
      },
    });

    return { observation, output: result.output };
  } catch (error) {
    if (
      NoObjectGeneratedError.isInstance(error) ||
      NoOutputGeneratedError.isInstance(error)
    ) {
      throw new AdapterInvocationError(
        "structured-output-invalid",
        false,
        observation,
      );
    }

    if (input.abortSignal?.aborted) {
      throw new AdapterInvocationError("cancelled", false, observation);
    }

    if (
      (error instanceof Error || error instanceof DOMException) &&
      (error.name === "TimeoutError" || error.name === "AbortError")
    ) {
      throw new AdapterInvocationError("unknown", false, observation);
    }

    if (APICallError.isInstance(error)) {
      throw new AdapterInvocationError(
        error.statusCode === undefined ? "unknown" : "failed",
        error.isRetryable,
        observation,
      );
    }

    throw new AdapterInvocationError("failed", false, observation);
  }
}
