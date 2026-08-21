import type { WorkerEnv } from "./env";

export type WorkerRuntimeConfig = {
  appVersion: string | null;
  inngestDev: boolean;
  maxWorkerConcurrency: number;
  mode: WorkerEnv["WORKER_MODE"];
  objectStore: "disabled" | "bound" | "unbound";
};

export class WorkerRuntimeConfigurationError extends Error {
  readonly code: "APP_VERSION_REQUIRED" | "APP_VERSION_MUTABLE";

  constructor(code: WorkerRuntimeConfigurationError["code"], message: string) {
    super(message);
    this.name = "WorkerRuntimeConfigurationError";
    this.code = code;
  }
}

export class WorkerRuntimeBindingError extends Error {
  readonly code = "UNBOUND_SERVICE";
  readonly missing: readonly ("event_key" | "object_store" | "signing_key")[];

  constructor(missing: WorkerRuntimeBindingError["missing"]) {
    super(`durable event transport missing ${missing.join(", ")}`);
    this.name = "WorkerRuntimeBindingError";
    this.missing = missing;
  }
}

export function deriveWorkerRuntimeConfig(env: WorkerEnv): WorkerRuntimeConfig {
  if (env.WORKER_MODE === "health-only") {
    return {
      appVersion: null,
      inngestDev: false,
      maxWorkerConcurrency: env.INNGEST_CONNECT_MAX_WORKER_CONCURRENCY,
      mode: env.WORKER_MODE,
      objectStore: "disabled",
    };
  }

  if (!env.APP_VERSION) {
    throw new WorkerRuntimeConfigurationError(
      "APP_VERSION_REQUIRED",
      "durable mode requires an immutable application version",
    );
  }

  if (env.NODE_ENV === "production" && env.APP_VERSION === "dev") {
    throw new WorkerRuntimeConfigurationError(
      "APP_VERSION_MUTABLE",
      "production durable mode requires an immutable application version",
    );
  }

  const inngestDev = env.INNGEST_DEV !== undefined;
  if (!inngestDev) {
    const missing: ("event_key" | "signing_key")[] = [];
    if (!env.INNGEST_EVENT_KEY) {
      missing.push("event_key");
    }
    if (!env.INNGEST_SIGNING_KEY) {
      missing.push("signing_key");
    }
    if (missing.length > 0) {
      throw new WorkerRuntimeBindingError(missing);
    }
  }

  const storageBindings = [
    env.S3_ACCESS_KEY_ID,
    env.S3_BUCKET,
    env.S3_ENDPOINT,
    env.S3_REGION,
    env.S3_SECRET_ACCESS_KEY,
  ];

  return {
    appVersion: env.APP_VERSION,
    inngestDev,
    maxWorkerConcurrency: env.INNGEST_CONNECT_MAX_WORKER_CONCURRENCY,
    mode: env.WORKER_MODE,
    objectStore: storageBindings.every(Boolean) ? "bound" : "unbound",
  };
}

export function assertObjectStoreBound(config: WorkerRuntimeConfig) {
  if (config.mode === "durable" && config.objectStore !== "bound") {
    throw new WorkerRuntimeBindingError(["object_store"]);
  }
}
