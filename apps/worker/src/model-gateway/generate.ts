import type { EmbeddingModel, LanguageModel } from "ai";
import {
  APICallError,
  embedMany,
  generateImage,
  generateText,
  NoContentGeneratedError,
  NoImageGeneratedError,
  NoObjectGeneratedError,
  NoOutputGeneratedError,
  Output,
} from "ai";

import { AdapterInvocationError } from "./errors";
import type {
  EmbeddingAdapterInput,
  EmbeddingAdapterResult,
  ImageAdapterInput,
  ImageAdapterResult,
  ModelCallObservation,
  ObservedModelStep,
  StructuredAdapterInput,
  StructuredAdapterResult,
} from "./types";
import { diagnoseProviderCall, recordProviderFailure } from "./usage";

export async function generateImageOnce(
  model: Parameters<typeof generateImage>[0]["model"],
  input: ImageAdapterInput,
): Promise<
  Omit<ImageAdapterResult, "observation"> & {
    responses: Awaited<ReturnType<typeof generateImage>>["responses"];
    usage: Awaited<ReturnType<typeof generateImage>>["usage"];
  }
> {
  try {
    const deadline = AbortSignal.timeout(input.deadlineMs);
    const result = await generateImage({
      abortSignal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, deadline])
        : deadline,
      maxRetries: 0,
      model,
      n: 1,
      prompt: input.reference
        ? { images: [input.reference.bytes], text: input.prompt }
        : input.prompt,
    });
    if (result.images.length !== 1) {
      throw noImageReturned();
    }
    return {
      bytes: result.image.uint8Array,
      mimeType: result.image.mediaType,
      responses: result.responses,
      usage: result.usage,
    };
  } catch (error) {
    if (error instanceof AdapterInvocationError) throw error;
    const observation = {
      costAuthority: "unknown" as const,
    };
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
      const diagnosis = diagnoseProviderCall(error);
      if (!diagnosis) {
        throw new AdapterInvocationError("unknown", false, observation);
      }
      throw recordProviderFailure(
        new AdapterInvocationError("failed", error.isRetryable, {
          ...observation,
          finishReason: diagnosis.code,
        }),
        diagnosis,
      );
    }
    if (
      NoImageGeneratedError.isInstance(error) ||
      NoContentGeneratedError.isInstance(error)
    ) {
      throw noImageReturned();
    }
    throw new AdapterInvocationError("unknown", false, observation);
  }
}

export async function generateEmbeddings(
  model: EmbeddingModel,
  input: EmbeddingAdapterInput,
  emptyObservation: ModelCallObservation,
  observe: (
    result: Awaited<ReturnType<typeof embedMany>>,
  ) => ModelCallObservation,
): Promise<EmbeddingAdapterResult> {
  let observation = emptyObservation;

  try {
    const deadline = AbortSignal.timeout(input.deadlineMs);
    const result = await embedMany({
      abortSignal: input.abortSignal
        ? AbortSignal.any([input.abortSignal, deadline])
        : deadline,
      maxRetries: 0,
      model,
      telemetry: {
        functionId: "model-gateway.embed-many",
        isEnabled: true,
        recordInputs: false,
        recordOutputs: false,
      },
      values: input.values,
    });
    observation = observe(result);

    const dimension = result.embeddings[0]?.length ?? 0;
    if (
      result.embeddings.length !== input.values.length ||
      dimension === 0 ||
      result.embeddings.some(
        (vector) =>
          vector.length !== dimension ||
          vector.some((value) => !Number.isFinite(value)),
      )
    ) {
      throw new AdapterInvocationError("failed", false, observation);
    }

    return {
      embeddings: result.embeddings,
      observation,
      responseBody: result.responses?.[0]?.body,
    };
  } catch (error) {
    if (error instanceof AdapterInvocationError) throw error;
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
      const diagnosis = diagnoseProviderCall(error);
      if (!diagnosis) {
        throw new AdapterInvocationError("unknown", false, observation);
      }
      throw recordProviderFailure(
        new AdapterInvocationError("failed", error.isRetryable, {
          ...observation,
          finishReason: diagnosis.code,
        }),
        diagnosis,
      );
    }
    throw new AdapterInvocationError("failed", false, observation);
  }
}

function noImageReturned() {
  return recordProviderFailure(
    new AdapterInvocationError("failed", false, {
      costAuthority: "unknown",
      finishReason: "NO_IMAGE_RETURNED",
    }),
    { code: "NO_IMAGE_RETURNED" },
  );
}

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
      const diagnosis = diagnoseProviderCall(error);
      if (!diagnosis) {
        throw new AdapterInvocationError("unknown", false, observation);
      }
      throw new AdapterInvocationError("failed", error.isRetryable, {
        ...observation,
        finishReason: diagnosis.code,
      });
    }

    throw new AdapterInvocationError("failed", false, observation);
  }
}
