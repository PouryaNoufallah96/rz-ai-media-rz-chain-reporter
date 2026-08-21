import type { InvocationKey } from "@rz-chain-reporter/contracts";
import type { ModelTaskKey } from "@rz-chain-reporter/customer-template/schema";
import type { Transaction } from "@rz-chain-reporter/db/executor";
import type { FinalizeUsageInput } from "@rz-chain-reporter/db/repositories/ai-usage-event";
import type { LanguageModelResponseMetadata, LanguageModelUsage } from "ai";
import type { z } from "zod";

export type ModelBindings = {
  OLLAMA_BASE_URL?: string;
  OPENROUTER_API_KEY?: string;
};

export type ModelCallObservation = Omit<
  FinalizeUsageInput,
  "finalizedAt" | "id" | "status"
>;

export type ObservedModelStep = {
  finishReason: string;
  modelId: string;
  providerMetadata: Record<string, unknown> | undefined;
  rawFinishReason: string | undefined;
  response: LanguageModelResponseMetadata;
  usage: LanguageModelUsage;
};

export type StructuredAdapterInput<TOutput> = {
  abortSignal?: AbortSignal;
  deadlineMs: number;
  instructions?: string;
  maxOutputTokens: number;
  model: string;
  outputName: string;
  prompt: string;
  schema: z.ZodType<TOutput>;
  telemetry: {
    operationAttemptId: string;
    operationId: string;
    usageEventId: string;
  };
};

export type StructuredAdapterResult<TOutput> = {
  observation: ModelCallObservation;
  output: TOutput;
};

export interface ModelAdapter {
  generateStructured<TOutput>(
    input: StructuredAdapterInput<TOutput>,
  ): Promise<StructuredAdapterResult<TOutput>>;
}

export type StructuredModelInvocation<TOutput> = {
  abortSignal?: AbortSignal;
  deadlineMs: number;
  instructions?: string;
  invocationKey: InvocationKey;
  maxOutputTokens: number;
  operationAttemptId: string;
  operationId: string;
  outputName: string;
  persistResult: (tx: Transaction, output: TOutput) => Promise<void>;
  prompt: string;
  schema: z.ZodType<TOutput>;
  taskKey: ModelTaskKey;
  workspaceId: string;
};

export type StructuredModelResult<TOutput> = {
  output: TOutput;
  usageEventId: string;
};
