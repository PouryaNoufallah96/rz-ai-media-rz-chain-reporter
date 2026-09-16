import type { EmbeddingModel, LanguageModel, ToolSet, UIMessage } from "ai";
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
  ToolLoopAgent,
  toUIMessageStream,
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
  TextStreamAdapterInput,
  TextStreamAdapterResult,
  TextStreamAgentBaseSettings,
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
      prompt: input.references?.length
        ? {
            images: input.references.map((reference) => reference.bytes),
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
      providerOptions: input.providerOptions,
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

export async function streamSynthesis<
  TOOLS extends ToolSet,
  UI_MESSAGE extends UIMessage,
>(
  model: LanguageModel,
  input: TextStreamAdapterInput<TOOLS>,
  observe: (step: ObservedModelStep) => ModelCallObservation,
): Promise<TextStreamAdapterResult<UI_MESSAGE>> {
  type RuntimeContext = TextStreamAdapterInput<TOOLS>["telemetry"];
  const baseSettings = {
    activeTools: input.activeTools,
    experimental_toolApprovalSecret: input.toolApprovalSecret,
    id: "model-gateway-synthesis",
    model,
    instructions: input.instructions,
    maxOutputTokens: input.maxOutputTokens,
    maxRetries: 0,
    prepareStep: input.prepareStep,
    stopWhen: input.stopWhen,
    timeout: { totalMs: input.deadlineMs },
    ...(input.providerOptions
      ? { providerOptions: input.providerOptions }
      : {}),
    toolChoice: input.toolChoice,
    toolApproval: input.toolApproval,
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
    onStepStart({ stepNumber }) {
      return input.onStepStart(stepNumber);
    },
    onStepEnd(step) {
      const observation = observe({
        finishReason: step.finishReason,
        modelId: step.model.modelId,
        providerMetadata: step.providerMetadata,
        rawFinishReason: step.rawFinishReason,
        response: step.response,
        usage: step.usage,
      });
      return input.onStepEnd(step.stepNumber, observation);
    },
  } satisfies TextStreamAgentBaseSettings<TOOLS>;
  const settings = Object.assign(
    input.bindAgentTools(baseSettings),
    baseSettings,
  );
  const agent = new ToolLoopAgent<never, TOOLS, RuntimeContext>(settings);
  const result = await agent.stream({
    abortSignal: input.abortSignal,
    prompt: input.prompt,
  });

  return {
    uiStream: toUIMessageStream<TOOLS, UI_MESSAGE>({
      stream: result.stream,
      tools: agent.tools,
    }),
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
