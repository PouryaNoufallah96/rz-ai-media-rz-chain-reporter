import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import { settleAnalysisRun } from "@rz-chain-reporter/db/repositories/analysis-run";
import { z } from "zod";

import { notifyCacheInvalidation } from "../web-cache/notify";
import { assertWorkspace, openWorkerRuntime } from "./runtime";

const EXIT_FAILURE = 1;
const operationIdSchema = z.uuid();

const { database, identity } = openWorkerRuntime();

try {
  const installation = await assertWorkspace({ db: database.db, identity });
  const [command, ...args] = process.argv.slice(2);

  if (command === "settle") {
    await settleRun(installation.workspaceId, args);
  } else {
    failUsage();
  }
} catch (error) {
  if (process.exitCode === undefined) {
    process.exitCode = EXIT_FAILURE;
    console.error(`analysis-run failed [${failureOf(error)}]`);
  }
} finally {
  await database.close();
}

function failureOf(error: unknown) {
  const mapped = classifyDbError(error);
  if (mapped?.kind === "code") {
    return mapped.code;
  }
  return error instanceof Error && mapped === undefined
    ? error.message
    : "UNKNOWN";
}

async function settleRun(workspaceId: string, args: string[]) {
  const parsedId = operationIdSchema.safeParse(args[0]);
  if (!parsedId.success || args.length !== 1) {
    failUsage();
  }

  const settled = await settleAnalysisRun(database.db, workspaceId, {
    operationId: parsedId.data,
    failureCode: null,
  });
  if (!settled) {
    throw new Error("ALREADY_TERMINAL");
  }

  const cacheInvalidation = await notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "editorial"),
    workspaceCacheTag(workspaceId, "usage"),
  ]);
  console.log(
    `analysis-run settled operation=${parsedId.data} lifecycle=${settled.lifecycle} cache=${cacheInvalidation}`,
  );
}

function failUsage(): never {
  throw new Error("USAGE: settle <operation-id>");
}
