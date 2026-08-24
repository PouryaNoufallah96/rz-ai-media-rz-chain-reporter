import { stableFailureCode, workerLogger } from "./logging/logger";
import {
  captureWorkerFailure,
  initializeWorkerObservability,
  shutdownWorkerObservability,
} from "./observability/bootstrap";
import { workerEnv } from "./runtime/env";

async function run() {
  const client = initializeWorkerObservability({
    appVersion: workerEnv.APP_VERSION ?? "",
    sentryDsn: workerEnv.SENTRY_DSN,
  });
  const { runWorkerApplication } = await import("./observability/application");
  await runWorkerApplication(client);
}

void run().catch(async (error: unknown) => {
  const errorCode = stableFailureCode(error, "WORKER_STARTUP_FAILED");
  workerLogger.error("worker.startup.failed", { errorCode });
  captureWorkerFailure(errorCode);
  await shutdownWorkerObservability();
  process.exit(1);
});
