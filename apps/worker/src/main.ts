import { workerLogger } from "./logging/logger";
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

void run().catch(async () => {
  workerLogger.error("worker.startup.failed", {
    errorCode: "WORKER_STARTUP_FAILED",
  });
  captureWorkerFailure("WORKER_STARTUP_FAILED");
  await shutdownWorkerObservability();
  process.exitCode = 1;
});
