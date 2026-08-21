import type { WorkerInngestClient } from "./client";
import { createGenerationProbeFunction } from "./generation-probe";
import { createMediaUploadVerificationFunction } from "./media-upload-function";
import type { WorkerRuntime } from "./runtime";
import { createScheduledEffectProbeFunction } from "./scheduled-effect-probe";
import { createStorageReconciliationFunction } from "./storage-reconciliation";

export function createWorkerFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  options: { diagnosticsEnabled: boolean },
) {
  const functions = [
    createGenerationProbeFunction(client, runtime),
    createMediaUploadVerificationFunction(client, runtime),
    createStorageReconciliationFunction(client, runtime),
  ];
  return options.diagnosticsEnabled
    ? [...functions, createScheduledEffectProbeFunction(client, runtime)]
    : functions;
}
