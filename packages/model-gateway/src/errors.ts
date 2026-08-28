import type { ModelCallObservation } from "./types";

export type AdapterFailureKind =
  | "cancelled"
  | "failed"
  | "structured-output-invalid"
  | "unknown";

export type ModelInvocationFailureReason =
  | "adapter-cancelled"
  | "adapter-failed"
  | "adapter-timeout"
  | "adapter-unknown"
  | "invocation-bounds"
  | "result-persistence-failed"
  | "structured-output-invalid"
  | "template-drift"
  | "unexpected-error"
  | "unit-deadline-exhausted"
  | "unspecified"
  | "usage-finalization-lost"
  | "usage-slot-replayed";

const ADAPTER_KIND_REASONS = {
  cancelled: "adapter-cancelled",
  failed: "adapter-failed",
  "structured-output-invalid": "structured-output-invalid",
  unknown: "adapter-unknown",
} satisfies Record<AdapterFailureKind, ModelInvocationFailureReason>;

export class AdapterInvocationError extends Error {
  readonly kind: AdapterFailureKind;
  readonly observation: ModelCallObservation;
  readonly reason: ModelInvocationFailureReason;
  readonly retryable: boolean;

  constructor(
    kind: AdapterFailureKind,
    retryable: boolean,
    observation: ModelCallObservation,
    reason?: ModelInvocationFailureReason,
  ) {
    super("model adapter invocation failed");
    this.name = "AdapterInvocationError";
    this.kind = kind;
    this.retryable = retryable;
    this.observation = observation;
    this.reason = reason ?? ADAPTER_KIND_REASONS[kind];
  }
}

export class ImagePreparationError extends Error {
  readonly ambiguous: boolean;

  constructor(options: { outcome: "ambiguous" | "definite" }) {
    super("image result preparation failed");
    this.name = "ImagePreparationError";
    this.ambiguous = options.outcome === "ambiguous";
  }
}

export class ModelTaskConfigurationError extends Error {
  readonly code = "MODEL_TASK_CONFIGURATION";

  constructor(message: string) {
    super(message);
    this.name = "ModelTaskConfigurationError";
  }
}

export class ModelBindingError extends Error {
  readonly code = "UNBOUND_SERVICE";

  constructor(message: string) {
    super(message);
    this.name = "ModelBindingError";
  }
}

export class ModelGatewayInvocationError extends Error {
  readonly ambiguous: boolean;
  readonly code:
    | "MODEL_INVOCATION_FAILED"
    | "STRUCTURED_OUTPUT_INVALID"
    | "TEMPLATE_DRIFT";
  readonly reason: ModelInvocationFailureReason;
  readonly retryable: boolean;
  readonly usageEventId: string | null;

  constructor(
    code: ModelGatewayInvocationError["code"],
    options: {
      ambiguous?: boolean;
      reason?: ModelInvocationFailureReason;
      retryable?: boolean;
      usageEventId?: string;
    } = {},
  ) {
    super(code);
    this.name = "ModelGatewayInvocationError";
    this.code = code;
    this.ambiguous = options.ambiguous ?? false;
    this.reason = options.reason ?? "unspecified";
    this.retryable = options.retryable ?? false;
    this.usageEventId = options.usageEventId ?? null;
  }
}
