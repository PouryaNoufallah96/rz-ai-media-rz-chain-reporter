import { createServer } from "node:http";
import { createDb } from "@rz-chain-reporter/db";
import { workerEnv } from "@rz-chain-reporter/env/worker";

const database = createDb(workerEnv.DATABASE_URL);
let acceptingWork = true;

const healthServer = createServer((request, response) => {
  if (request.url !== "/health/ready") {
    response.writeHead(404).end();
    return;
  }
  if (!acceptingWork) {
    response.writeHead(503, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: "draining" }));
    return;
  }
  void database
    .check()
    .then(() => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ready" }));
    })
    .catch(() => {
      response.writeHead(503, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "unavailable" }));
    });
});

healthServer.listen(workerEnv.WORKER_HEALTH_PORT, "0.0.0.0");

const shutdown = (signal: NodeJS.Signals) => {
  acceptingWork = false;
  process.stdout.write(
    `${JSON.stringify({ event: "worker.shutdown", signal })}\n`,
  );
  healthServer.close(() => {
    void database.close().finally(() => {
      process.exitCode = 0;
    });
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

process.stdout.write(`${JSON.stringify({ event: "worker.ready" })}\n`);
