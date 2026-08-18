import { createDb, DB_PROBE_TIMEOUT_MS } from "@rz-chain-reporter/db";
import {
  BindingProjectionError,
  recordDestinationBindingProjection,
} from "@rz-chain-reporter/db/bindings/projection";
import {
  DestinationBindingError,
  formatDestinationBindingReport,
} from "@rz-chain-reporter/env/destination-bindings";
import { workerEnv } from "@rz-chain-reporter/env/worker";

const EXIT_FAILURE = 1;
const EXIT_UNBOUND = 2;

const command = "bindings:record";
const database = createDb(workerEnv.DATABASE_URL, {
  connectionTimeoutMillis: DB_PROBE_TIMEOUT_MS,
});
let exitCode = 0;

try {
  const { report, written } = await recordDestinationBindingProjection(
    database.db,
    process.env,
  );

  console.log(command);
  console.log(formatDestinationBindingReport(report));
  console.log(`projection rows written ${written}`);

  // Record the projection before choosing the exit code so unbound destinations still show.
  if (!report.satisfied) {
    exitCode = EXIT_UNBOUND;
  }
} catch (error) {
  exitCode = EXIT_FAILURE;

  if (
    error instanceof BindingProjectionError ||
    error instanceof DestinationBindingError
  ) {
    console.error(`${command} failed [${error.code}]: ${error.message}`);
  } else {
    console.error(`${command} failed:`, error);
  }
} finally {
  await database.close();
}

process.exitCode = exitCode;
