import type {
  ImageAspectRatio,
  InvocationKey,
} from "@rz-chain-reporter/contracts";
import type { ModelTaskKey } from "@rz-chain-reporter/customer-template/schema";
import type { Transaction } from "@rz-chain-reporter/db/executor";
import type { FinalizeUsageInput } from "@rz-chain-reporter/db/repositories/ai-usage-event";
import type {
  ActiveTools,
  GenerateTextOnStepEndCallback,
  GenerateTextOnStepStartCallback,
  InferUIMessageChunk,
  InferUITools,
  Instructions,
  LanguageModel,
  LanguageModelResponseMetadata,
  LanguageModelUsage,
  PrepareStepFunction,
  StopCondition,
  TelemetryOptions,
  TimeoutConfiguration,
  ToolApprovalConfiguration,
  ToolChoice,
  ToolLoopAgentSettings,
  ToolSet,
  UIMessage,
} from "ai";
import type { z } from "zod";

export type ModelBindings = {
  OLLAMA_BASE_URL?: string;
  OPENROUTER_API_KEY?: string;
};

export type ModelCallObservation = Omit<
  FinalizeUsageInput,
  "claimFence" | "finalizedAt" | "id" | "status"
>;

export type ModelTelemetryContext = {
  operationAttemptId: string;
  operationId: string;
  usageEventId: string;
};

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

export type TextStreamAgentBaseSettings<TOOLS extends ToolSet> = {
  activeTools?: ActiveTools<TOOLS>;
  experimental_toolApprovalSecret?: string | Uint8Array;
  id?: string;
  instructions?: Instructions;
  maxOutputTokens?: number;
  maxRetries?: number;
  model: LanguageModel;
  onStepEnd?: GenerateTextOnStepEndCallback<TOOLS, ModelTelemetryContext>;
  onStepStart?: GenerateTextOnStepStartCallback<
    TOOLS,
    ModelTelemetryContext,
    never
  >;
  prepareStep?: PrepareStepFunction<TOOLS, ModelTelemetryContext>;
  runtimeContext?: ModelTelemetryContext;
  stopWhen?: StopCondition<TOOLS, ModelTelemetryContext>;
  telemetry?: TelemetryOptions<ModelTelemetryContext, TOOLS>;
  timeout?: TimeoutConfiguration<TOOLS>;
  toolApproval?: ToolApprovalConfiguration<TOOLS, ModelTelemetryContext>;
  toolChoice?: ToolChoice<TOOLS>;
};

export type TextStreamToolOptions<TOOLS extends ToolSet> = {
  activeTools?: ActiveTools<TOOLS>;
  bindAgentTools: (
    settings: TextStreamAgentBaseSettings<TOOLS>,
  ) => ToolLoopAgentSettings<never, TOOLS, ModelTelemetryContext>;
  prepareStep?: PrepareStepFunction<TOOLS, ModelTelemetryContext>;
  stopWhen?: StopCondition<TOOLS, ModelTelemetryContext>;
  toolApproval?: ToolApprovalConfiguration<TOOLS, ModelTelemetryContext>;
  toolApprovalSecret?: string;
  toolChoice?: ToolChoice<TOOLS>;
};

export type TextStreamAdapterInput<TOOLS extends ToolSet> =
  TextStreamToolOptions<TOOLS> & {
    abortSignal?: AbortSignal;
    deadlineMs: number;
    instructions: string;
    maxOutputTokens: number;
    model: string;
    prompt: string;
    telemetry: ModelTelemetryContext;
    onStepEnd: (
      stepNumber: number,
      observation: ModelCallObservation,
    ) => Promise<void>;
    onStepStart: (stepNumber: number) => Promise<void>;
  };

export type TextStreamUIMessage<TOOLS extends ToolSet> = UIMessage<
  never,
  never,
  InferUITools<TOOLS>
>;

export type TextStreamAdapterResult<UI_MESSAGE extends UIMessage> = {
  uiStream: ReadableStream<InferUIMessageChunk<UI_MESSAGE>>;
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
};

export type ImageAdapterInput = {
  abortSignal?: AbortSignal;
  aspectRatio?: ImageAspectRatio;
  deadlineMs: number;
  model: string;
  prompt: string;
  references?: readonly ImageReference[];
};

export type ImageReference = {
  bytes: Uint8Array;
  height: number;
  mimeType: string;
  width: number;
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
  streamText?<
    TOOLS extends ToolSet,
    UI_MESSAGE extends UIMessage = TextStreamUIMessage<TOOLS>,
  >(
    input: TextStreamAdapterInput<TOOLS>,
  ): Promise<TextStreamAdapterResult<UI_MESSAGE>>;
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
  claimFence?: ModelInvocationClaimFence;
  deadlineMs: number;
  invocationKey: InvocationKey;
  operationAttemptId: string;
  operationId: string;
  persistResult?: (tx: Transaction, embeddings: number[][]) => Promise<void>;
  taskKey: ModelTaskKey;
  values: string[];
  workspaceId: string;
};

export type TextStreamModelInvocation<TOOLS extends ToolSet> =
  TextStreamToolOptions<TOOLS> & {
    abortSignal?: AbortSignal;
    deadlineMs: number;
    instructions: string;
    invocationKey: InvocationKey;
    maxOutputTokens: number;
    operationAttemptId: string;
    operationId: string;
    prompt: string;
    taskKey: ModelTaskKey;
    workspaceId: string;
  };

export type EmbeddingModelResult = {
  embeddings: number[][];
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
  aspectRatio: ImageAspectRatio;
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
  references?: readonly ImageReference[];
  taskKey: ModelTaskKey;
  workspaceId: string;
  claimFence?: ModelInvocationClaimFence;
};

export type ImageModelResult = {
  prepared: PreparedImageResult;
  usageEventId: string;
};
