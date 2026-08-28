import type { APICallError } from "ai";

import type { AdapterInvocationError } from "./errors";
import type { ModelCallObservation, ObservedModelStep } from "./types";

export type ProviderFailureDiagnosis = {
  code:
    | "INSUFFICIENT_CREDITS"
    | "MODERATION_BLOCKED"
    | "NO_IMAGE_RETURNED"
    | "PROVIDER_5XX"
    | "PROVIDER_REJECTED_4XX"
    | "RATE_LIMITED";
  httpStatus?: number;
};

const providerFailures = new WeakMap<Error, ProviderFailureDiagnosis>();

export function diagnoseProviderCall(
  error: APICallError,
): ProviderFailureDiagnosis | undefined {
  const httpStatus = error.statusCode;
  if (httpStatus === undefined || httpStatus < 400 || httpStatus > 599) {
    return undefined;
  }
  if (httpStatus >= 500) return { code: "PROVIDER_5XX", httpStatus };
  if (httpStatus === 402) return { code: "INSUFFICIENT_CREDITS", httpStatus };
  if (httpStatus === 403) return { code: "MODERATION_BLOCKED", httpStatus };
  if (httpStatus === 429) return { code: "RATE_LIMITED", httpStatus };
  return { code: "PROVIDER_REJECTED_4XX", httpStatus };
}

export function recordProviderFailure(
  error: AdapterInvocationError,
  diagnosis: ProviderFailureDiagnosis,
): AdapterInvocationError {
  providerFailures.set(error, diagnosis);
  return error;
}

export function readProviderFailure(
  error: unknown,
): ProviderFailureDiagnosis | undefined {
  return error instanceof Error ? providerFailures.get(error) : undefined;
}

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
