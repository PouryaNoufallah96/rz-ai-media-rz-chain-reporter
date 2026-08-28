import { createServer, type Server, type ServerResponse } from "node:http";

import { stableFailureCode } from "../logging/logger";
import type { WorkerRuntimeState } from "../runtime/state";
import { checkObjectStoreReachable } from "./object-store";

type ReadinessCheck = () => Promise<void>;

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

export function createHealthServer(
  state: WorkerRuntimeState,
  checkReadiness: ReadinessCheck,
) {
  return createServer((request, response) => {
    if (request.method !== "GET") {
      json(response, 405, { status: "method-not-allowed" });
      return;
    }

    if (request.url === "/health") {
      json(response, 200, { status: "live" });
      return;
    }

    if (request.url !== "/health/ready") {
      json(response, 404, { status: "not-found" });
      return;
    }

    const capabilities = state.capabilities();
    if (state.draining) {
      json(response, 503, {
        status: "draining",
        mode: state.config.mode,
        capabilities,
      });
      return;
    }

    void checkReadiness()
      .then(() =>
        state.config.objectStore === "bound"
          ? checkObjectStoreReachable()
          : undefined,
      )
      .then(() => {
        const runtimeReady = state.runtimeReady();
        json(response, runtimeReady ? 200 : 503, {
          status: runtimeReady ? "ready" : "starting",
          mode: state.config.mode,
          capabilities: state.capabilities(),
        });
      })
      .catch((error: unknown) => {
        json(response, 503, {
          status: "unavailable",
          errorCode: stableFailureCode(error, "WORKER_DEPENDENCY_UNAVAILABLE"),
          mode: state.config.mode,
          capabilities: state.capabilities(),
        });
      });
  });
}

export function listen(server: Server, port: number) {
  return new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

export function closeServer(server: Server) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}
