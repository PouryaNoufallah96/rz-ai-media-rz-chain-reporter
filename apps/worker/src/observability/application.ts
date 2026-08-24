import { closeServer, createHealthServer, listen } from "../health/server";
import { assertAppliedIdentity } from "../identity/assert";
import type { WorkerInngestClient } from "../inngest/client";
import { connectWorker } from "../inngest/connect";
import { openWorkerRuntime } from "../inngest/runtime";
import { stableFailureCode, workerLogger } from "../logging/logger";
import { OutboxRelay } from "../relay/relay";
import { deriveWorkerRuntimeConfig } from "../runtime/config";
import { abortableDelay } from "../runtime/delay";
import { workerEnv } from "../runtime/env";
import { WorkerRuntimeState } from "../runtime/state";
import { reportCacheInvalidationConfiguration } from "../web-cache/notify";
import { captureWorkerFailure, shutdownWorkerObservability } from "./bootstrap";

const IDENTITY_RETRY_MS = 1_000;
const SHUTDOWN_DEADLINE_MS = 15_000;

export async function runWorkerApplication(client: WorkerInngestClient) {
  const config = deriveWorkerRuntimeConfig(workerEnv);
  const { database, identity, template } = openWorkerRuntime();
  const state = new WorkerRuntimeState(config);
  const checkReadiness = async () => {
    await database.check();
    await assertAppliedIdentity(database.db, identity);
  };
  const healthServer = createHealthServer(state, checkReadiness);
  const initializationAbort = new AbortController();

  let shutdownPromise: Promise<void> | null = null;
  let initialization: Promise<void> = Promise.resolve();

  const shutdown = (signal: string, exitCode: number) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    state.beginDrain();
    initializationAbort.abort();
    workerLogger.info("worker.drain.started", { signal });

    const orderedDrain = (async () => {
      await initialization.catch(() => undefined);

      if (state.relay) {
        await state.relay.stopIntakeAndDrain();
      }
      workerLogger.info("worker.drain.relay-stopped");

      if (state.connection) {
        await state.connection.close();
        await state.connection.closed;
      }
      workerLogger.info("worker.drain.connect-closed");

      await closeServer(healthServer);
      workerLogger.info("worker.drain.health-closed");

      await database.close();
      workerLogger.info("worker.drain.database-closed");
      await shutdownWorkerObservability();
      process.exitCode = exitCode;
    })();

    let deadlineTimer: ReturnType<typeof setTimeout>;
    shutdownPromise = Promise.race([
      orderedDrain,
      new Promise<never>((_, reject) => {
        deadlineTimer = setTimeout(
          reject,
          SHUTDOWN_DEADLINE_MS,
          new Error("shutdown deadline exceeded"),
        );
      }),
    ])
      .finally(() => clearTimeout(deadlineTimer))
      .catch(() => {
        workerLogger.error("worker.drain.deadline-exceeded", {
          errorCode: "SHUTDOWN_DEADLINE_EXCEEDED",
        });
        captureWorkerFailure("SHUTDOWN_DEADLINE_EXCEEDED");
        process.exit(1);
      });

    return shutdownPromise;
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT", 0);
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM", 0);
  });

  await listen(healthServer, workerEnv.WORKER_HEALTH_PORT);
  workerLogger.info("worker.health.listening", {
    mode: config.mode,
    port: workerEnv.WORKER_HEALTH_PORT,
  });

  if (config.mode === "health-only") {
    workerLogger.info("worker.ready", { mode: config.mode });
    return;
  }

  reportCacheInvalidationConfiguration();

  initialization = (async () => {
    let installation:
      | Awaited<ReturnType<typeof assertAppliedIdentity>>
      | undefined;
    let reportedFailureCode: string | null = null;
    while (!initializationAbort.signal.aborted) {
      try {
        await database.check();
        installation = await assertAppliedIdentity(database.db, identity);
        if (reportedFailureCode !== null) {
          reportedFailureCode = null;
          workerLogger.info("worker.runtime.dependency-recovered");
        }
        break;
      } catch (error) {
        const errorCode = stableFailureCode(
          error,
          "WORKER_DEPENDENCY_UNAVAILABLE",
        );
        if (errorCode !== reportedFailureCode) {
          reportedFailureCode = errorCode;
          workerLogger.warn("worker.runtime.dependency-unavailable", {
            errorCode,
          });
        }
        await abortableDelay(IDENTITY_RETRY_MS, initializationAbort.signal);
      }
    }

    if (!installation || initializationAbort.signal.aborted) {
      return;
    }

    const connection = await connectWorker(client, config, {
      db: database.db,
      identity,
      template,
    });
    state.connection = connection;
    workerLogger.info("worker.connect.active", {
      appVersion: config.appVersion ?? "",
      connectionState: connection.state,
    });

    if (state.draining) {
      return;
    }

    const relay = new OutboxRelay(
      database.db,
      installation.workspaceId,
      client,
      `worker:${connection.connectionId}`,
    );
    state.relay = relay;
    relay.start();
    workerLogger.info("worker.ready", { mode: config.mode });
  })();

  void initialization.catch(() => {
    workerLogger.error("worker.runtime.failed", {
      errorCode: "WORKER_RUNTIME_FAILED",
    });
    captureWorkerFailure("WORKER_RUNTIME_FAILED");
    void shutdown("runtime-failure", 1);
  });
}
