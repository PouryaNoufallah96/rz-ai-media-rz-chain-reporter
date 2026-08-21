import { connect } from "inngest/connect";

import type { WorkerRuntimeConfig } from "../runtime/config";
import type { WorkerInngestClient } from "./client";
import { createWorkerFunctions } from "./functions";
import type { WorkerRuntime } from "./runtime";

export function connectWorker(
  client: WorkerInngestClient,
  config: WorkerRuntimeConfig,
  runtime: WorkerRuntime,
) {
  return connect({
    apps: [
      {
        client,
        functions: createWorkerFunctions(client, runtime, {
          diagnosticsEnabled: config.inngestDev,
        }),
      },
    ],
    handleShutdownSignals: [],
    isolateExecution: false,
    maxWorkerConcurrency: config.maxWorkerConcurrency,
  });
}
