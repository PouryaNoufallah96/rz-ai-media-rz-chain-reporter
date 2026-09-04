import {
  contentLocaleSchema,
  PUBLISH_CHECKPOINT_KINDS,
  type PublicationFailureCode,
  platformSchema,
  publicationFailureCodeSchema,
} from "@rz-chain-reporter/contracts";
import { z } from "zod";

export const publishRequestSchema = z.strictObject({
  workspaceId: z.uuid(),
  operationId: z.uuid(),
  publicationId: z.uuid(),
});

export type PublishRequest = z.infer<typeof publishRequestSchema>;

export const providerFailureSchema = z.strictObject({
  class: z.enum([
    "invalid",
    "auth",
    "rate",
    "transport",
    "timeout",
    "provider",
    "permanent",
  ]),
  effectScope: z.enum(["preparation", "publication"]),
  certainty: z.enum(["definite", "preparation_unknown", "delivery_unknown"]),
  next: z.enum([
    "none",
    "retry_preparation",
    "retry_after_provider_time",
    "reconcile_first",
    "operator_repair",
  ]),
  code: publicationFailureCodeSchema,
  retryAt: z.iso.datetime().optional(),
});

export type ProviderFailure = z.infer<typeof providerFailureSchema>;

export const providerCheckpointSchema = z.strictObject({
  kind: z.enum(PUBLISH_CHECKPOINT_KINDS),
  providerReferenceId: z.string().trim().min(1).max(512),
});

type ProviderCheckpoint = z.infer<typeof providerCheckpointSchema>;

export const publishMaterialSchema = z.strictObject({
  contentLocale: contentLocaleSchema,
  destinationKey: z.string().trim().min(1).max(100),
  draft: z.strictObject({
    body: z.string().trim().min(1),
    hashtags: z.array(z.string().trim().min(1)).min(1),
    headline: z.string().trim().min(1),
  }),
  media: z
    .strictObject({
      actualBytes: z.int().positive(),
      mimeType: z.string().trim().min(1).max(100),
      objectKey: z.string().trim().min(1).max(1024),
    })
    .nullable(),
  platform: platformSchema,
  source: z
    .strictObject({
      attribution: z.string().trim().min(1).max(500),
      canonicalUrl: z.url(),
    })
    .nullable(),
});

export type PublishMaterial = z.infer<typeof publishMaterialSchema>;

type PublishAttempt = {
  id: string;
  number: number;
  resumed: boolean;
};

type PreparedPublish =
  | {
      attempt: PublishAttempt;
      checkpoints: readonly ProviderCheckpoint[];
      platform: "telegram";
      method: "sendMessage";
    }
  | {
      attempt: PublishAttempt;
      checkpoints: readonly ProviderCheckpoint[];
      platform: "telegram";
      method: "sendPhoto";
    }
  | {
      attempt: PublishAttempt;
      checkpoints: readonly ProviderCheckpoint[];
      platform: "x";
      mediaId: string | null;
    }
  | {
      attempt: PublishAttempt;
      checkpoints: readonly ProviderCheckpoint[];
      containerId: string;
      platform: "instagram";
    };

type PrepareResult =
  | { status: "prepared"; prepared: PreparedPublish }
  | { status: "failed"; attemptId: string | null; failure: ProviderFailure };

export type PublishResult =
  | {
      status: "confirmed";
      attemptId: string;
      checkpoint: ProviderCheckpoint;
      providerResultId: string;
    }
  | { status: "failed"; attemptId: string; failure: ProviderFailure };

type ReconcileResult =
  | {
      status: "delivered";
      checkpoint: ProviderCheckpoint;
      providerResultId: string;
    }
  | { status: "failed"; failure: ProviderFailure }
  | { status: "not_delivered" }
  | { status: "still_unknown" };

export type ReconciliationReference = {
  notBefore: Date;
};

export interface Publisher {
  readonly platform: PublishMaterial["platform"];
  prepare(request: PublishRequest): Promise<PrepareResult>;
  publish(prepared: PreparedPublish): Promise<PublishResult>;
  reconcile(checkpoint: ProviderCheckpoint | null): Promise<ReconcileResult>;
}

export type PublisherRuntime = {
  beginAttempt(request: PublishRequest): Promise<PublishAttempt>;
  claimFinalEffect(attemptId: string): Promise<boolean>;
  existingCheckpoint(
    request: PublishRequest,
    kind: ProviderCheckpoint["kind"],
  ): Promise<ProviderCheckpoint | null>;
  readMedia(objectKey: string): Promise<Uint8Array<ArrayBuffer>>;
  renewLease(): Promise<void>;
  run<T>(name: string, effect: () => Promise<T>): Promise<T>;
  sleep(duration: string): Promise<void>;
  withMaterial<T>(
    name: string,
    effect: (material: PublishMaterial) => Promise<T>,
  ): Promise<T>;
};

const MAX_AUTOMATIC_PUBLISH_ATTEMPTS = 5;
export const PROVIDER_REQUEST_TIMEOUT_MS = 30_000;
export const PROVIDER_MEDIA_UPLOAD_TIMEOUT_MS = 120_000;
export const PROVIDER_RESPONSE_MAX_BYTES = 512 * 1024;

export function providerRequestTimeoutMs(init?: RequestInit) {
  return init?.body instanceof FormData
    ? PROVIDER_MEDIA_UPLOAD_TIMEOUT_MS
    : PROVIDER_REQUEST_TIMEOUT_MS;
}

const MIN_RETRY_DELAY_MS = 5_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;

export function boundedRetry(
  failure: ProviderFailure,
  attemptNumber: number,
  now: number,
  providerDelayMs?: number,
): ProviderFailure {
  if (attemptNumber >= MAX_AUTOMATIC_PUBLISH_ATTEMPTS) {
    return providerFailureSchema.parse({
      ...failure,
      next: "operator_repair",
      retryAt: undefined,
    });
  }
  const exponential = Math.min(
    MIN_RETRY_DELAY_MS * 2 ** Math.max(0, attemptNumber - 1),
    MAX_RETRY_DELAY_MS,
  );
  const delay = Math.min(
    Math.max(providerDelayMs ?? exponential, MIN_RETRY_DELAY_MS),
    MAX_RETRY_DELAY_MS,
  );
  return providerFailureSchema.parse({
    ...failure,
    retryAt: new Date(now + delay).toISOString(),
  });
}

export function definiteFailure(
  code: PublicationFailureCode,
  failureClass: ProviderFailure["class"],
  effectScope: ProviderFailure["effectScope"],
  next: ProviderFailure["next"] = "operator_repair",
): ProviderFailure {
  return providerFailureSchema.parse({
    class: failureClass,
    effectScope,
    certainty: "definite",
    next,
    code,
  });
}

export function unknownFailure(
  code: PublicationFailureCode,
  failureClass: ProviderFailure["class"],
  certainty: "preparation_unknown" | "delivery_unknown",
): ProviderFailure {
  return providerFailureSchema.parse({
    class: failureClass,
    effectScope:
      certainty === "delivery_unknown" ? "publication" : "preparation",
    certainty,
    next:
      certainty === "delivery_unknown"
        ? "reconcile_first"
        : "retry_preparation",
    code,
  });
}

export function failed(
  attemptId: string,
  failure: ProviderFailure,
): PublishResult {
  return { status: "failed", attemptId, failure };
}

export function providerFailureClass(
  error: unknown,
): "provider" | "timeout" | "transport" {
  if (error instanceof DOMException && error.name === "TimeoutError") {
    return "timeout";
  }
  return error instanceof SyntaxError ||
    (error instanceof Error && error.message === "PROVIDER_RESPONSE_TOO_LARGE")
    ? "provider"
    : "transport";
}

export function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
