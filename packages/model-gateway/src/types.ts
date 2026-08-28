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
  "claimFence" | "finalizedAt" | "id" | "status"
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

export type EmbeddingAdapterInput = {
  abortSignal?: AbortSignal;
  deadlineMs: number;
  model: string;
  values: string[];
};

export type EmbeddingAdapterResult = {
  embeddings: number[][];
  observation: ModelCallObservation;
  responseBody: unknown;
};

export type ImageAdapterInput = {
  abortSignal?: AbortSignal;
  deadlineMs: number;
  model: string;
  prompt: string;
  reference?: { bytes: Uint8Array; mimeType: string };
};

export type ImageAdapterResult = {
  bytes: Uint8Array;
  mimeType: string;
  observation: ModelCallObservation;
};

export interface ModelAdapter {
  embedMany?(input: EmbeddingAdapterInput): Promise<EmbeddingAdapterResult>;
  generateStructured<TOutput>(
    input: StructuredAdapterInput<TOutput>,
  ): Promise<StructuredAdapterResult<TOutput>>;
}

export interface RemoteModelAdapter extends ModelAdapter {
  embedMany(input: EmbeddingAdapterInput): Promise<EmbeddingAdapterResult>;
  generateImage(input: ImageAdapterInput): Promise<ImageAdapterResult>;
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
  persistDefiniteFailure?: (
    tx: Transaction,
    failure: StructuredModelDefiniteFailure,
  ) => Promise<void>;
  persistResult: (tx: Transaction, output: TOutput) => Promise<void>;
  prompt: string;
  schema: z.ZodType<TOutput>;
  taskKey: ModelTaskKey;
  workspaceId: string;
  claimFence?: ModelInvocationClaimFence;
};

export type ModelInvocationClaimFence = {
  claimedBy: string;
  expectedVersion: number;
};

export type StructuredModelDefiniteFailure = {
  code: "STRUCTURED_OUTPUT_INVALID";
};

export type StructuredModelResult<TOutput> = {
  output: TOutput;
  usageEventId: string;
};

export type EmbeddingModelInvocation = {
  abortSignal?: AbortSignal;
  deadlineMs: number;
  invocationKey: InvocationKey;
  operationAttemptId: string;
  operationId: string;
  persistResult?: (tx: Transaction, embeddings: number[][]) => Promise<void>;
  taskKey: ModelTaskKey;
  values: string[];
  workspaceId: string;
};

export type EmbeddingModelResult = {
  embeddings: number[][];
  responseBody: unknown;
  usageEventId: string;
};

export type PreparedImageResult = {
  actualBytes: number;
  checksum: string;
  height: number;
  mediaAssetId: string;
  mimeType: string;
  objectKey: string;
  width: number;
};

export type ImageModelInvocation = {
  abortSignal?: AbortSignal;
  deadlineMs: number;
  invocationKey: InvocationKey;
  operationAttemptId: string;
  operationId: string;
  persistResult: (
    tx: Transaction,
    result: PreparedImageResult,
  ) => Promise<void>;
  compensatePreparedResult: (
    result: PreparedImageResult,
  ) => Promise<"compensated" | "uncertain">;
  rejectUnpreparedResult: () => Promise<"rejected" | "uncertain">;
  resolvePreparedResult: (
    result: PreparedImageResult,
    usageEventId: string,
  ) => Promise<"absent" | "committed" | "uncertain">;
  prepareResult: (input: {
    bytes: Uint8Array;
    mimeType: string;
    usageEventId: string;
  }) => Promise<PreparedImageResult>;
  prompt: string;
  reference?: { bytes: Uint8Array; mimeType: string };
  taskKey: ModelTaskKey;
  workspaceId: string;
  claimFence?: ModelInvocationClaimFence;
};

export type ImageModelResult = {
  prepared: PreparedImageResult;
  usageEventId: string;
};
