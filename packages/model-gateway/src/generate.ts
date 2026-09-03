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
  streamText,
} from "ai";

import { AdapterInvocationError } from "./errors";
import type {
  EmbeddingAdapterInput,
  EmbeddingAdapterResult,
  ImageAdapterInput,
  ImageAdapterResult,
  ModelCallObservation,
  ModelToolCall,
  ObservedModelStep,
  StructuredAdapterInput,
  StructuredAdapterResult,
  TextStreamAdapterInput,
  TextStreamAdapterResult,
} from "./types";
import { diagnoseProviderCall, recordProviderFailure } from "./usage";

function isTimeoutAbort(error: unknown) {
  return (
    (error instanceof Error || error instanceof DOMException) &&
    (error.name === "AbortError" ||
      error.name === "ResponseAborted" ||
      error.name === "TimeoutError")
  );
}

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
      ...(input.aspectRatio ? { aspectRatio: input.aspectRatio } : {}),
      maxRetries: 0,
      model,
      n: 1,
      prompt:
        input.references?.length || input.reference
          ? {
              images: (input.references ?? [input.reference]).flatMap(
                (reference) => (reference ? [reference.bytes] : []),
              ),
              text: input.prompt,
            }
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
    throw toAdapterError(
      error,
      input.abortSignal,
      observation,
      "unknown",
      (cause) =>
        NoImageGeneratedError.isInstance(cause) ||
        NoContentGeneratedError.isInstance(cause)
          ? noImageReturned()
          : null,
    );
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

    return { embeddings: result.embeddings, observation };
  } catch (error) {
    if (error instanceof AdapterInvocationError) throw error;
    throw toAdapterError(error, input.abortSignal, observation, "failed");
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
    if (error instanceof AdapterInvocationError) throw error;
    throw toAdapterError(
      error,
      input.abortSignal,
      observation,
      "failed",
      (cause) =>
        NoObjectGeneratedError.isInstance(cause) ||
        NoOutputGeneratedError.isInstance(cause)
          ? new AdapterInvocationError(
              "structured-output-invalid",
              false,
              observation,
            )
          : null,
    );
  }
}

export function streamSynthesis(
  model: LanguageModel,
  input: TextStreamAdapterInput,
  emptyObservation: ModelCallObservation,
  observe: (step: ObservedModelStep) => ModelCallObservation,
): TextStreamAdapterResult {
  let observation = emptyObservation;
  let failure: unknown;
  let toolCalls: readonly ModelToolCall[] = [];

  const result = streamText({
    model,
    instructions: input.instructions,
    prompt: input.prompt,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: 0,
    stopWhen: input.stopWhen,
    timeout: { totalMs: input.deadlineMs },
    abortSignal: input.abortSignal,
    toolChoice: input.toolChoice,
    tools: input.tools,
    runtimeContext: input.telemetry,
    telemetry: {
      functionId: "model-gateway.stream-synthesis",
      includeRuntimeContext: {
        operationAttemptId: true,
        operationId: true,
        usageEventId: true,
      },
      recordInputs: false,
      recordOutputs: false,
    },
    onError({ error }) {
      failure ??= error;
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

  async function* readTextStream() {
    try {
      for await (const delta of result.textStream) {
        yield delta;
      }

      toolCalls = (await result.toolResults).map((call) => ({
        output: call.output,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
      }));
    } catch (error) {
      failure ??= error;
    }

    if (failure !== undefined) {
      throw toAdapterError(failure, input.abortSignal, observation, "unknown");
    }
  }

  return {
    observation: () => observation,
    textStream: readTextStream(),
    toolCalls: () => toolCalls,
  };
}

function toAdapterError(
  error: unknown,
  abortSignal: AbortSignal | undefined,
  observation: ModelCallObservation,
  fallbackKind: "unknown" | "failed",
  specialCase?: (error: unknown) => AdapterInvocationError | null,
) {
  if (abortSignal?.aborted) {
    return new AdapterInvocationError("cancelled", false, observation);
  }

  if (isTimeoutAbort(error)) {
    return new AdapterInvocationError(
      "unknown",
      false,
      observation,
      "adapter-timeout",
    );
  }

  const special = specialCase?.(error);
  if (special) {
    return special;
  }

  if (APICallError.isInstance(error)) {
    const diagnosis = diagnoseProviderCall(error);

    if (diagnosis) {
      return recordProviderFailure(
        new AdapterInvocationError("failed", error.isRetryable, {
          ...observation,
          finishReason: diagnosis.code,
        }),
        diagnosis,
      );
    }

    return new AdapterInvocationError("unknown", false, observation);
  }

  return new AdapterInvocationError(fallbackKind, false, observation);
}
