import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
  operationsChangedRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import { createDb } from "@rz-chain-reporter/db";
import { createOperation } from "@rz-chain-reporter/db/repositories/operation";
import { markOutboxDispatched } from "@rz-chain-reporter/db/repositories/outbox-relay";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { workspace } from "@rz-chain-reporter/db/schema/workspace";
import { asc, eq, inArray } from "drizzle-orm";

import { createInngestClient } from "../inngest/client";
import {
  createInngestEvent,
  OutboxEventContractError,
} from "../inngest/events";
import { workerLogger } from "../logging/logger";
import { workerEnv } from "../runtime/env";
import { OutboxRelay } from "./relay";

const databaseUrl = new URL(workerEnv.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname) ||
  databaseUrl.pathname !== "/rz-chain-reporter"
) {
  throw new Error("LOCAL_DATABASE_REQUIRED");
}

const database = createDb(workerEnv.DATABASE_URL);
const workspaceId = randomUUID();
const operationIds: string[] = [];
const claimedBy = `relay-probe:${randomUUID()}`;
let releaseBatch: () => void = () => undefined;
const batchReleased = new Promise<void>((resolve) => {
  releaseBatch = resolve;
});
let batchEnteredResolve: () => void = () => undefined;
const batchEntered = new Promise<void>((resolve) => {
  batchEnteredResolve = resolve;
});
let relay: OutboxRelay | null = null;
const operationChangeAttempts: unknown[] = [];
const operationChanges: unknown[] = [];
const warningEvents: string[] = [];
const originalWarn = workerLogger.warn;
workerLogger.warn = (event, fields) => {
  warningEvents.push(event);
  originalWarn(event, fields);
};

try {
  const marketAnalysisId = randomUUID();
  const marketOperationId = randomUUID();
  assert.throws(
    () =>
      createInngestEvent({
        eventType: "toString",
        id: randomUUID(),
        payload: {},
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      }),
    (error) =>
      error instanceof OutboxEventContractError &&
      error.code === "OUTBOX_EVENT_TYPE_UNSUPPORTED",
  );
  assert.equal(
    createInngestEvent({
      eventType: OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
      id: randomUUID(),
      payload: {
        marketAnalysisId,
        operationId: marketOperationId,
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
      },
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    }).name,
    OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
  );
  assert.equal(
    createInngestEvent({
      eventType: OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
      id: randomUUID(),
      payload: {
        operationId: marketOperationId,
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
      },
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
    }).name,
    OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
  );
  const [actor] = await database.db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);
  if (!actor) throw new Error("RELAY_PROBE_ACTOR_REQUIRED");
  await database.db.insert(workspace).values({
    id: workspaceId,
    name: `Relay probe ${workspaceId}`,
  });

  for (let index = 0; index < 6; index += 1) {
    const operationId = randomUUID();
    operationIds.push(operationId);
    const created = await createOperation(database.db, workspaceId, {
      actor: actor.id,
      commandType: "relay-probe",
      event: {
        payload: {
          operationId,
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          workspaceId,
        },
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        type: OPERATION_GENERATION_REQUESTED_EVENT_NAME,
      },
      idempotencyKey: `relay-probe:${index}`,
      operationId,
      requestHash: `relay-probe:${operationId}`,
      requestId: null,
    });
    assert.equal(created.status, "created");
  }

  const client = createInngestClient("relay-probe");
  const sentIds: string[] = [];
  let activeSends = 0;
  let maximumActiveSends = 0;
  let rejectOperationChange = true;
  client.realtime.publish = (async (_topic, data) => {
    operationChangeAttempts.push(data);
    if (rejectOperationChange) {
      rejectOperationChange = false;
      throw new Error("RELAY_PROBE_REALTIME_FAILED");
    }
    operationChanges.push(data);
  }) as typeof client.realtime.publish;
  client.send = (async (input: unknown) => {
    if (
      typeof input !== "object" ||
      input === null ||
      !("id" in input) ||
      typeof input.id !== "string"
    ) {
      throw new Error("RELAY_PROBE_EVENT_ID_REQUIRED");
    }
    sentIds.push(input.id);
    activeSends += 1;
    maximumActiveSends = Math.max(maximumActiveSends, activeSends);
    if (sentIds.length === 5) batchEnteredResolve();
    await batchReleased;
    activeSends -= 1;
    if (input.id === sentIds[0]) throw new Error("RELAY_PROBE_SEND_FAILED");
    return { ids: [input.id] };
  }) as typeof client.send;

  relay = new OutboxRelay(database.db, workspaceId, client, claimedBy);
  relay.start();
  await Promise.race([
    batchEntered,
    new Promise<never>((_, reject) =>
      setTimeout(reject, 2_000, new Error("RELAY_PROBE_BATCH_TIMEOUT")),
    ),
  ]);

  const claimed = await database.db
    .select()
    .from(outboxEvent)
    .where(eq(outboxEvent.workspaceId, workspaceId))
    .orderBy(asc(outboxEvent.id));
  const owned = claimed.filter(
    (event) => event.dispatchClaimedBy === claimedBy,
  );
  assert.equal(owned.length, 5);
  assert.equal(
    claimed.filter((event) => event.dispatchAttemptCount === 0).length,
    1,
  );
  assert.equal(maximumActiveSends, 5);
  assert.equal(new Set(sentIds).size, 5);
  for (const event of owned) {
    assert.ok(event.dispatchClaimedAt);
    assert.ok(event.dispatchLeaseExpiresAt);
    assert.equal(
      event.dispatchLeaseExpiresAt.getTime() -
        event.dispatchClaimedAt.getTime(),
      120_000,
    );
    assert.ok(sentIds.includes(`outbox:${event.eventType}:${event.id}`));
  }

  const wrongOwner = await markOutboxDispatched(database.db, workspaceId, {
    acceptedAt: new Date(),
    claimedBy: "relay-probe:wrong-owner",
    id: owned[0]?.id ?? "",
  });
  assert.equal(wrongOwner.status, "not_owned");

  let drained = false;
  const drain = relay.stopIntakeAndDrain().then(() => {
    drained = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(drained, false);
  releaseBatch();
  await drain;

  const settled = await database.db
    .select()
    .from(outboxEvent)
    .where(eq(outboxEvent.workspaceId, workspaceId));
  assert.equal(activeSends, 0);
  assert.equal(
    settled.filter((event) => event.dispatchedAt !== null).length,
    4,
  );
  assert.equal(
    settled.filter(
      (event) =>
        event.lastErrorCode === "INNGEST_SEND_FAILED" &&
        event.dispatchedAt === null,
    ).length,
    1,
  );
  assert.equal(
    settled.filter((event) => event.dispatchAttemptCount === 0).length,
    1,
  );
  assert.equal(
    settled.every((event) => event.dispatchClaimedBy === null),
    true,
  );
  assert.equal(operationChangeAttempts.length, 1);
  assert.equal(operationChanges.length, 0);
  const operationChange = operationsChangedRealtimeMessageSchema.parse(
    operationChangeAttempts[0],
  );
  assert.equal(operationChange.actorId, actor.id);
  assert.equal(operationChange.sharedImport, false);
  assert.equal(
    warningEvents.includes("worker.operations.realtime-unavailable"),
    true,
  );
  console.log(
    "relay probe batch=5 parallel=5 lease-ms=120000 stable-ids=true wrong-owner-rejected=true one-send-failed-isolated=true operations-changed-attempts=1 operations-changed-failed=1 audience-scoped=true failure-observable=true drain-waited=true post-stop-intake=0 status=pass",
  );
} finally {
  workerLogger.warn = originalWarn;
  releaseBatch();
  await relay?.stopIntakeAndDrain().catch(() => undefined);
  if (operationIds.length > 0) {
    await database.db
      .delete(outboxEvent)
      .where(inArray(outboxEvent.operationId, operationIds));
    await database.db
      .delete(operation)
      .where(inArray(operation.id, operationIds));
  }
  await database.db.delete(workspace).where(eq(workspace.id, workspaceId));
  await database.close();
}
