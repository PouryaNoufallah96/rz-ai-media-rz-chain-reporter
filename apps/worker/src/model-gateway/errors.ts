import type { ModelCallObservation } from "./types";

export type AdapterFailureKind =
  | "cancelled"
  | "failed"
  | "structured-output-invalid"
  | "unknown";

export class AdapterInvocationError extends Error {
  readonly kind: AdapterFailureKind;
  readonly observation: ModelCallObservation;
  readonly retryable: boolean;

  constructor(
    kind: AdapterFailureKind,
    retryable: boolean,
    observation: ModelCallObservation,
  ) {
    super("model adapter invocation failed");
    this.name = "AdapterInvocationError";
    this.kind = kind;
    this.retryable = retryable;
    this.observation = observation;
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
  readonly retryable: boolean;
  readonly usageEventId: string | null;

  constructor(
    code: ModelGatewayInvocationError["code"],
    options: {
      ambiguous?: boolean;
      retryable?: boolean;
      usageEventId?: string;
    } = {},
  ) {
    super(code);
    this.name = "ModelGatewayInvocationError";
    this.code = code;
    this.ambiguous = options.ambiguous ?? false;
    this.retryable = options.retryable ?? false;
    this.usageEventId = options.usageEventId ?? null;
  }
}
