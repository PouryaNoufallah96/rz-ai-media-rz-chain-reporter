import type { ModelCallObservation, ObservedModelStep } from "./types";

export function commonObservation(
  step: ObservedModelStep,
): Pick<
  ModelCallObservation,
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "completionTokens"
  | "finishReason"
  | "promptTokens"
  | "providerRequestId"
  | "reasoningTokens"
  | "resolvedModel"
  | "totalTokens"
  | "rawUsage"
> {
  const nativeFinishReason = (step.rawFinishReason ?? step.finishReason).slice(
    0,
    128,
  );

  return {
    cacheReadTokens: step.usage.inputTokenDetails.cacheReadTokens,
    cacheWriteTokens: step.usage.inputTokenDetails.cacheWriteTokens,
    completionTokens: step.usage.outputTokens,
    finishReason: step.finishReason,
    promptTokens: step.usage.inputTokens,
    providerRequestId: step.response.id,
    reasoningTokens: step.usage.outputTokenDetails.reasoningTokens,
    resolvedModel: step.response.modelId ?? step.modelId,
    totalTokens: step.usage.totalTokens,
    rawUsage: nativeFinishReason ? { nativeFinishReason } : undefined,
  };
}
