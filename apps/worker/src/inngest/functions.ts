import { createAnalysisRunFunctions } from "./analysis-run";
import type { WorkerInngestClient } from "./client";
import { createCopyGenerationFunctions } from "./copy-generation";
import { createCopyVariantTranslationFunctions } from "./copy-variant-translation";
import { createGenerationProbeFunction } from "./generation-probe";
import { createImageGenerationFunctions } from "./image-generation";
import { createMediaUploadVerificationFunction } from "./media-upload-function";
import { createPresentationTranslationFunctions } from "./presentation-translation";
import { createPublishingFunctions } from "./publishing";
import type { WorkerRuntime } from "./runtime";
import { createScheduledEffectProbeFunction } from "./scheduled-effect-probe";
import { createSourceImportFunctions } from "./source-import";
import { createStorageReconciliationFunction } from "./storage-reconciliation";

export function createWorkerFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  options: { diagnosticsEnabled: boolean },
) {
  const publishing = createPublishingFunctions(client, runtime);
  const functions = [
    createGenerationProbeFunction(client, runtime),
    createMediaUploadVerificationFunction(client, runtime),
    createStorageReconciliationFunction(client, runtime),
    ...createSourceImportFunctions(client, runtime),
    ...createAnalysisRunFunctions(client, runtime),
    ...createCopyGenerationFunctions(client, runtime),
    ...createCopyVariantTranslationFunctions(client, runtime),
    ...createImageGenerationFunctions(client, runtime),
    ...createPresentationTranslationFunctions(client, runtime),
    publishing.effect,
    publishing.parent,
    publishing.reconciliation,
  ];
  return options.diagnosticsEnabled
    ? [...functions, createScheduledEffectProbeFunction(client, runtime)]
    : functions;
}
