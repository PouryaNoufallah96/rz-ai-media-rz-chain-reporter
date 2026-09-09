import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  canonicalRunConfiguration,
  type RunConfiguration,
  type RunConfigurationTransport,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";

import { createDb } from "../index";
import {
  ANALYSIS_RUN_COMMAND_TYPE,
  findAnalysisRunByIdempotencyKey,
  startAnalysisRun,
} from "../repositories/analysis-run";
import { analysisRun } from "../schema/analysis-run";
import { user } from "../schema/auth";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const target = new URL(MIGRATION_DATABASE_URL);
assert.ok(
  target.hostname === "127.0.0.1" || target.hostname === "localhost",
  "assistant run-start probe requires a loopback PostgreSQL target",
);
assert.equal(
  target.pathname.slice(1),
  "rz-chain-reporter",
  "assistant run-start probe requires the project-owned database",
);

const database = createDb(MIGRATION_DATABASE_URL, { max: 4, pipeline: true });
const workspaceId = randomUUID();
const actorId = `assistant-run-start-probe-${randomUUID()}`;
const templateFingerprint = createHash("sha256")
  .update(`assistant-run-start:${workspaceId}`)
  .digest("hex");
const configuration = {
  kind: "promo",
  models: ["probe-model"],
  platforms: ["telegram"],
  promo: {
    brands: ["probe-brand"],
    prompts: { "probe-brand": "Prepare the launch" },
  },
} satisfies RunConfiguration & RunConfigurationTransport;
const changedConfiguration = {
  ...configuration,
  promo: {
    ...configuration.promo,
    prompts: { "probe-brand": "Changed launch" },
  },
} satisfies RunConfiguration & RunConfigurationTransport;
const requestHash = hashConfiguration(configuration);
const changedRequestHash = hashConfiguration(changedConfiguration);
const stableKey = randomUUID();
const persistedKey = `${ANALYSIS_RUN_COMMAND_TYPE}:${stableKey}`;

try {
  await database.db.insert(user).values({
    id: actorId,
    email: `${actorId}@example.test`,
    name: "Assistant Run Start Probe",
  });
  await database.db.insert(workspace).values({
    id: workspaceId,
    name: `Assistant Run Start Probe ${workspaceId}`,
    customerTemplateAppliedAt: new Date(),
    customerTemplateFingerprint: templateFingerprint,
    customerTemplateKey: `assistant-run-start-${workspaceId}`,
  });

  const input = () => ({
    actor: actorId,
    configuration,
    idempotencyKey: persistedKey,
    kind: configuration.kind,
    operationId: randomUUID(),
    requestHash,
    requestId: randomUUID(),
    templateFingerprint,
  });
  const concurrent = await Promise.all([
    startAnalysisRun(database.db, workspaceId, input()),
    startAnalysisRun(database.db, workspaceId, input()),
  ]);
  assert.deepEqual(concurrent.map((result) => result.status).sort(), [
    "created",
    "replayed",
  ]);
  const identities = concurrent.filter(
    (result): result is Extract<typeof result, { analysisRunId: string }> =>
      "analysisRunId" in result,
  );
  assert.equal(
    new Set(identities.map((result) => result.analysisRunId)).size,
    1,
  );
  assert.equal(new Set(identities.map((result) => result.operationId)).size, 1);

  const operationRows = await database.db
    .select({ id: operation.id })
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.actor, actorId),
        eq(operation.commandType, ANALYSIS_RUN_COMMAND_TYPE),
        eq(operation.idempotencyKey, persistedKey),
      ),
    );
  const runRows = await database.db
    .select({ id: analysisRun.id, operationId: analysisRun.operationId })
    .from(analysisRun)
    .where(eq(analysisRun.workspaceId, workspaceId));
  assert.equal(operationRows.length, 1);
  assert.equal(runRows.length, 1);
  assert.equal(runRows[0]?.operationId, operationRows[0]?.id);

  const exact = await findAnalysisRunByIdempotencyKey(
    database.db,
    workspaceId,
    actorId,
    stableKey,
  );
  assert.deepEqual(exact, {
    analysisRunId: runRows[0]?.id,
    operationId: operationRows[0]?.id,
    requestHash,
  });
  assert.equal(
    await findAnalysisRunByIdempotencyKey(
      database.db,
      workspaceId,
      "another-operator",
      stableKey,
    ),
    null,
  );

  const mismatch = await startAnalysisRun(database.db, workspaceId, {
    ...input(),
    configuration: changedConfiguration,
    requestHash: changedRequestHash,
  });
  assert.deepEqual(mismatch, { status: "mismatch" });

  const newerKey = randomUUID();
  const newer = await startAnalysisRun(database.db, workspaceId, {
    ...input(),
    idempotencyKey: `${ANALYSIS_RUN_COMMAND_TYPE}:${newerKey}`,
  });
  assert.equal(newer.status, "created");
  assert.equal(
    await findAnalysisRunByIdempotencyKey(
      database.db,
      workspaceId,
      actorId,
      randomUUID(),
    ),
    null,
  );
  assert.deepEqual(
    await findAnalysisRunByIdempotencyKey(
      database.db,
      workspaceId,
      actorId,
      stableKey,
    ),
    exact,
  );

  const finalOperations = await database.db
    .select({ id: operation.id })
    .from(operation)
    .where(eq(operation.workspaceId, workspaceId));
  const finalRuns = await database.db
    .select({ id: analysisRun.id })
    .from(analysisRun)
    .where(eq(analysisRun.workspaceId, workspaceId));
  assert.equal(finalOperations.length, 2);
  assert.equal(finalRuns.length, 2);

  process.stdout.write(
    `${JSON.stringify({
      concurrentStatuses: concurrent.map((result) => result.status).sort(),
      exactRecovery: true,
      mismatchRejected: true,
      newestFallback: false,
      stableRunCount: 1,
      stableOperationCount: 1,
      totalRunsAfterDistinctRequest: finalRuns.length,
      totalOperationsAfterDistinctRequest: finalOperations.length,
    })}\n`,
  );
} finally {
  await database.db
    .delete(outboxEvent)
    .where(eq(outboxEvent.workspaceId, workspaceId));
  await database.db
    .delete(analysisRun)
    .where(eq(analysisRun.workspaceId, workspaceId));
  await database.db
    .delete(operation)
    .where(eq(operation.workspaceId, workspaceId));
  await database.db.delete(workspace).where(eq(workspace.id, workspaceId));
  await database.db.delete(user).where(eq(user.id, actorId));
  await database.close();
}

function hashConfiguration(value: RunConfigurationTransport) {
  return createHash("sha256")
    .update(canonicalRunConfiguration(value))
    .digest("hex");
}
