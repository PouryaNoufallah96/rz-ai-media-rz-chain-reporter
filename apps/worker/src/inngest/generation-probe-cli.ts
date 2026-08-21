import { createHash, randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  GENERATION_PROBE_COMMAND_PREFIX,
  OPERATION_GENERATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { createOperation } from "@rz-chain-reporter/db/repositories/operation";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { workerEnv } from "../runtime/env";
import { assertWorkspace, openWorkerRuntime } from "./runtime";

const EXIT_FAILURE = 1;
const MODES = ["real", "invalid-output", "fallback"] as const;
const operationIdSchema = z.uuid();

if (workerEnv.INNGEST_DEV === undefined) {
  console.error("generation-probe failed [DIAGNOSTIC_MODE_REQUIRED]");
  process.exit(EXIT_FAILURE);
}

const { database, identity } = openWorkerRuntime();

try {
  const installation = await assertWorkspace({ db: database.db, identity });
  const [command, ...args] = process.argv.slice(2);

  if (command === "create") {
    await createProbe(installation.workspaceId, args);
  } else if (command === "inspect") {
    await inspectProbe(installation.workspaceId, args);
  } else {
    failUsage();
  }
} catch (error) {
  if (process.exitCode === undefined) {
    process.exitCode = EXIT_FAILURE;
    console.error(
      `generation-probe failed [${
        error instanceof Error ? error.message : "UNKNOWN"
      }]`,
    );
  }
} finally {
  await database.close();
}

async function createProbe(workspaceId: string, args: string[]) {
  const mode = MODES.find((value) => value === args[0]);
  if (!mode || args.length > 1) {
    failUsage();
  }

  const operationId = randomUUID();
  const commandType = `${GENERATION_PROBE_COMMAND_PREFIX}${mode}`;
  const idempotencyKey = `generation-probe:${operationId}`;
  const requestHash = createHash("sha256")
    .update(`${idempotencyKey}:${commandType}`)
    .digest("hex");

  const result = await database.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [actor] = await tx
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt))
      .limit(1);
    if (!actor) {
      throw new Error("DIAGNOSTIC_FIXTURE_REQUIRED");
    }

    return createOperation(tx, workspaceId, {
      actor: actor.id,
      commandType,
      event: {
        payload: {
          operationId,
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          workspaceId,
        },
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        type: OPERATION_GENERATION_REQUESTED_EVENT_NAME,
      },
      idempotencyKey,
      operationId,
      requestHash,
      requestId: null,
    });
  });

  if (result.status !== "created") {
    throw new Error("CREATE_REJECTED");
  }
  console.log(`Generation probe created operation=${operationId} mode=${mode}`);
}

async function inspectProbe(workspaceId: string, args: string[]) {
  const parsedId = operationIdSchema.safeParse(args[0]);
  if (!parsedId.success || args.length !== 1) {
    failUsage();
  }

  const [row] = await database.db
    .select({ lifecycle: operation.lifecycle, version: operation.version })
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, parsedId.data),
      ),
    );
  if (!row) {
    throw new Error("NOT_FOUND");
  }

  const attempts = await database.db
    .select({
      attemptNumber: operationAttempt.attemptNumber,
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(operationAttempt.operationId, parsedId.data),
      ),
    )
    .orderBy(asc(operationAttempt.attemptNumber));

  const usage = await database.db
    .select({
      backend: aiUsageEvent.backend,
      cost: aiUsageEvent.openrouterCost,
      costAuthority: aiUsageEvent.costAuthority,
      invocationKey: aiUsageEvent.invocationKey,
      resolvedModel: aiUsageEvent.resolvedModel,
      status: aiUsageEvent.status,
      totalTokens: aiUsageEvent.totalTokens,
    })
    .from(aiUsageEvent)
    .where(
      and(
        eq(aiUsageEvent.workspaceId, workspaceId),
        eq(aiUsageEvent.operationId, parsedId.data),
      ),
    )
    .orderBy(asc(aiUsageEvent.occurredAt));

  console.log(`Generation probe operation=${parsedId.data}`);
  console.log(`lifecycle=${row.lifecycle} version=${row.version}`);
  console.log(`attemptCount=${attempts.length}`);
  for (const attempt of attempts) {
    console.log(
      `attempt=${attempt.attemptNumber} outcome=${attempt.outcome ?? "none"} failureCode=${attempt.failureCode ?? "none"}`,
    );
  }
  console.log(`usageRowCount=${usage.length}`);
  for (const row of usage) {
    console.log(
      `usage slot=${row.invocationKey} status=${row.status} backend=${row.backend} model=${row.resolvedModel ?? "none"} tokens=${row.totalTokens ?? "none"} cost=${row.cost ?? "none"} authority=${row.costAuthority}`,
    );
  }
}

function failUsage(): never {
  throw new Error(
    "USAGE: create <real|invalid-output|fallback> | inspect <operation-id>",
  );
}
