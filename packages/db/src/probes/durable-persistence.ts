import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_GENERATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { eq, sql } from "drizzle-orm";
import { DatabaseError, Pool } from "pg";

import { createDb } from "../index";
import {
  enrichUsage,
  finalizeUsage,
  insertPendingUsage,
} from "../repositories/ai-usage-event";
import {
  claimMediaValidation,
  markMediaDeleteFailed,
  markMediaObjectRemoved,
  markMediaRejected,
  markMediaUploaded,
  markMediaVerified,
} from "../repositories/media-asset";
import { createOperation } from "../repositories/operation";
import { allocateOperationAttempt } from "../repositories/operation-attempt";
import {
  claimOutboxEvents,
  markOutboxDispatched,
  markOutboxFailed,
  rearmOutboxEvent,
} from "../repositories/outbox-relay";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { user } from "../schema/auth";
import { mediaAsset } from "../schema/media-asset";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { publishOperation } from "../schema/publish-operation";
import { workspace } from "../schema/workspace";

const databaseUrl = process.env.MIGRATION_DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL is required");
}

const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.startsWith("rz-chain-reporter-durable-proof-")) {
  throw new Error("durable persistence probe requires its disposable database");
}

const database = createDb(databaseUrl, { max: 20 });
const rawPool = new Pool({ connectionString: databaseUrl, max: 4 });
const workspaceId = randomUUID();
const actorId = `probe-${randomUUID()}`;

async function createProbeOperation(suffix: string) {
  const operationId = randomUUID();
  const result = await createOperation(database.db, workspaceId, {
    operationId,
    actor: actorId,
    commandType: "generation-probe",
    idempotencyKey: `probe-${suffix}`,
    requestHash: `hash-${suffix}`,
    requestId: null,
    event: {
      type: OPERATION_GENERATION_REQUESTED_EVENT_NAME,
      schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
      payload: {
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
        operationId,
      },
    },
  });
  assert.equal(result.status, "created");
  return operationId;
}

async function proveSkipLocked() {
  const first = await rawPool.connect();
  const second = await rawPool.connect();
  try {
    await first.query("begin");
    await second.query("begin");
    const firstRow = await first.query<{ id: string }>(
      `select id from outbox_event
       where workspace_id = $1 and dispatched_at is null and exhausted_at is null
       order by next_attempt_at, id for update skip locked limit 1`,
      [workspaceId],
    );
    const secondRow = await second.query<{ id: string }>(
      `select id from outbox_event
       where workspace_id = $1 and dispatched_at is null and exhausted_at is null
       order by next_attempt_at, id for update skip locked limit 1`,
      [workspaceId],
    );
    assert.equal(firstRow.rowCount, 1);
    assert.equal(secondRow.rowCount, 1);
    assert.notEqual(firstRow.rows[0]?.id, secondRow.rows[0]?.id);
  } finally {
    await Promise.allSettled([
      first.query("rollback"),
      second.query("rollback"),
    ]);
    first.release();
    second.release();
  }
}

async function proveRelay() {
  const [firstClaim, secondClaim] = await Promise.all([
    claimOutboxEvents(database.db, workspaceId, {
      claimedBy: "relay-a",
      leaseDurationMs: 60_000,
      limit: 1,
    }),
    claimOutboxEvents(database.db, workspaceId, {
      claimedBy: "relay-b",
      leaseDurationMs: 60_000,
      limit: 1,
    }),
  ]);
  assert.equal(firstClaim.length, 1);
  assert.equal(secondClaim.length, 1);
  assert.notEqual(firstClaim[0]?.id, secondClaim[0]?.id);

  const exhausted = firstClaim[0];
  assert(exhausted);
  const wrongOwner = await markOutboxFailed(database.db, workspaceId, {
    id: exhausted.id,
    claimedBy: "relay-wrong",
    errorCode: "SEND_FAILED",
    nextAttemptAt: new Date(),
    exhausted: true,
  });
  assert.equal(wrongOwner.status, "not_owned");
  const exhaustedResult = await markOutboxFailed(database.db, workspaceId, {
    id: exhausted.id,
    claimedBy: exhausted.dispatchClaimedBy ?? "",
    errorCode: "SEND_FAILED",
    nextAttemptAt: new Date(),
    exhausted: true,
  });
  assert.equal(exhaustedResult.status, "updated");
  const rearmed = await rearmOutboxEvent(database.db, workspaceId, {
    id: exhausted.id,
  });
  assert(rearmed);
  assert.equal(rearmed.dispatchAttemptCount, 1);
  assert.equal(rearmed.exhaustedAt, null);

  const reclaimed = await claimOutboxEvents(database.db, workspaceId, {
    claimedBy: "relay-c",
    leaseDurationMs: 60_000,
    limit: 1,
  });
  assert.equal(reclaimed[0]?.id, exhausted.id);
  const dispatched = await markOutboxDispatched(database.db, workspaceId, {
    id: exhausted.id,
    claimedBy: "relay-c",
  });
  assert.equal(dispatched.status, "updated");
}

async function proveAllocator() {
  const operationId = await createProbeOperation("allocator");
  const attempts = await Promise.all(
    Array.from({ length: 12 }, () =>
      allocateOperationAttempt(database.db, workspaceId, operationId),
    ),
  );
  const numbers = attempts
    .map((attempt) => attempt?.attemptNumber)
    .sort((left, right) => (left ?? 0) - (right ?? 0));
  assert.deepEqual(
    numbers,
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  const [parent] = await database.db
    .select({ attemptSeq: operation.attemptSeq })
    .from(operation)
    .where(eq(operation.id, operationId));
  assert.equal(parent?.attemptSeq, 12);
}

function isGenerationUniqueViolation(error: unknown) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (current instanceof DatabaseError) {
      return (
        current.code === "23505" &&
        current.constraint ===
          "uq_ai_usage_event_provider_gateway_generation_id_present"
      );
    }
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

async function proveUsageLedger() {
  const operationId = await createProbeOperation("usage");
  const attempt = await allocateOperationAttempt(
    database.db,
    workspaceId,
    operationId,
  );
  assert(attempt);
  const pendingInput = {
    operationId,
    operationAttemptId: attempt.id,
    invocationKey: "primary" as const,
    taskKey: "generation-probe",
    apiKind: "chat" as const,
    backend: "remote" as const,
    providerGateway: "openrouter" as const,
    requestedModel: "openai/gpt-4o-mini",
  };
  const first = await insertPendingUsage(
    database.db,
    workspaceId,
    pendingInput,
  );
  const replay = await insertPendingUsage(
    database.db,
    workspaceId,
    pendingInput,
  );
  assert.equal(first.inserted, true);
  assert.equal(replay.inserted, false);
  assert.equal(first.event.id, replay.event.id);

  const finalized = await finalizeUsage(database.db, workspaceId, {
    id: first.event.id,
    status: "succeeded",
    resolvedModel: "openai/gpt-4o-mini",
    generationId: "generation-proof",
    promptTokens: 11,
    totalTokens: 11,
    openrouterCost: "0.0000010000",
    costAuthority: "billed_openrouter",
    rawUsage: { route: "inline" },
  });
  assert.equal(finalized.status, "updated");
  const enriched = await enrichUsage(database.db, workspaceId, {
    id: first.event.id,
    promptTokens: 99,
    completionTokens: 7,
    totalTokens: 18,
    openrouterCost: "9.0000000000",
    costAuthority: "estimated_openrouter",
    rawUsage: { route: "reconciled", nativeFinishReason: "stop" },
  });
  assert(enriched);
  assert.equal(enriched.promptTokens, 11);
  assert.equal(enriched.completionTokens, 7);
  assert.equal(enriched.openrouterCost, "0.0000010000");
  assert.equal(enriched.costAuthority, "billed_openrouter");
  assert.equal(enriched.rawUsage?.route, "inline");
  assert.equal(enriched.rawUsage?.nativeFinishReason, "stop");
  assert.equal(enriched.usageSource, "generation_reconciled");

  const duplicateCount = await database.db
    .select({ count: sql<number>`count(*)::int` })
    .from(aiUsageEvent)
    .where(eq(aiUsageEvent.operationAttemptId, attempt.id));
  assert.equal(duplicateCount[0]?.count, 1);

  const secondAttempt = await allocateOperationAttempt(
    database.db,
    workspaceId,
    operationId,
  );
  assert(secondAttempt);
  const secondPending = await insertPendingUsage(database.db, workspaceId, {
    ...pendingInput,
    operationAttemptId: secondAttempt.id,
  });
  let uniqueViolation = false;
  try {
    await finalizeUsage(database.db, workspaceId, {
      id: secondPending.event.id,
      status: "succeeded",
      generationId: "generation-proof",
      costAuthority: "billed_openrouter",
    });
  } catch (error) {
    uniqueViolation = isGenerationUniqueViolation(error);
  }
  assert.equal(uniqueViolation, true);
}

async function proveMediaCas() {
  const [rejectedAsset, verifiedAsset] = await database.db
    .insert(mediaAsset)
    .values([
      {
        workspaceId,
        kind: "upload",
        objectKey: "proof/rejected.png",
        mimeType: "image/png",
        declaredBytes: 10,
      },
      {
        workspaceId,
        kind: "upload",
        objectKey: "proof/verified.png",
        mimeType: "image/png",
        declaredBytes: 10,
      },
    ])
    .returning();
  assert(rejectedAsset);
  assert(verifiedAsset);

  const uploaded = await markMediaUploaded(database.db, workspaceId, {
    id: rejectedAsset.id,
    version: rejectedAsset.version,
  });
  assert.equal(uploaded.status, "updated");
  const stale = await markMediaUploaded(database.db, workspaceId, {
    id: rejectedAsset.id,
    version: rejectedAsset.version,
  });
  assert.equal(stale.status, "conflict");
  assert.equal(uploaded.status, "updated");
  const validating = await claimMediaValidation(database.db, workspaceId, {
    id: rejectedAsset.id,
    version: uploaded.asset.version,
  });
  assert.equal(validating.status, "updated");
  const rejected = await markMediaRejected(database.db, workspaceId, {
    id: rejectedAsset.id,
    version: validating.asset.version,
    reason: "CHECKSUM_MISMATCH",
    mimeType: "image/png",
    actualBytes: 10,
    checksum: "actual-checksum",
    width: 1,
    height: 1,
  });
  assert.equal(rejected.status, "updated");
  const deleteFailed = await markMediaDeleteFailed(database.db, workspaceId, {
    id: rejectedAsset.id,
    version: rejected.asset.version,
    lifecycle: "rejected",
  });
  assert.equal(deleteFailed.status, "updated");
  assert(deleteFailed.asset.deleteFailedAt);
  assert.equal(deleteFailed.asset.objectRemovedAt, null);
  const removed = await markMediaObjectRemoved(database.db, workspaceId, {
    id: rejectedAsset.id,
    version: deleteFailed.asset.version,
    lifecycle: "rejected",
  });
  assert.equal(removed.status, "updated");
  assert(removed.asset.objectRemovedAt);
  assert.equal(removed.asset.deleteFailedAt, null);

  const verifiedUploaded = await markMediaUploaded(database.db, workspaceId, {
    id: verifiedAsset.id,
    version: verifiedAsset.version,
  });
  assert.equal(verifiedUploaded.status, "updated");
  const verifiedValidating = await claimMediaValidation(
    database.db,
    workspaceId,
    { id: verifiedAsset.id, version: verifiedUploaded.asset.version },
  );
  assert.equal(verifiedValidating.status, "updated");
  const verified = await markMediaVerified(database.db, workspaceId, {
    id: verifiedAsset.id,
    version: verifiedValidating.asset.version,
    mimeType: "image/png",
    actualBytes: 10,
    checksum: "verified-checksum",
    width: 1,
    height: 1,
  });
  assert.equal(verified.status, "updated");
  assert(verified.asset.verifiedAt);
}

try {
  await database.db.insert(workspace).values({
    id: workspaceId,
    name: "Durable persistence proof",
  });
  await database.db.insert(user).values({
    id: actorId,
    name: "Persistence proof",
    email: `${actorId}@example.invalid`,
  });

  const producerOperationId = await createProbeOperation("producer");
  const [producerCounts] = await database.db
    .select({
      operations: sql<number>`count(distinct ${operation.id})::int`,
      outboxEvents: sql<number>`count(distinct ${outboxEvent.id})::int`,
      publishRows: sql<number>`count(distinct ${publishOperation.operationId})::int`,
    })
    .from(operation)
    .leftJoin(outboxEvent, eq(outboxEvent.operationId, operation.id))
    .leftJoin(publishOperation, eq(publishOperation.operationId, operation.id))
    .where(eq(operation.id, producerOperationId));
  assert.deepEqual(producerCounts, {
    operations: 1,
    outboxEvents: 1,
    publishRows: 0,
  });

  await createProbeOperation("relay-second");
  await proveSkipLocked();
  await proveRelay();
  await proveAllocator();
  await proveUsageLedger();
  await proveMediaCas();

  console.log(
    JSON.stringify({
      database: databaseName,
      producerAtomicNoPublish: true,
      skipLockedDistinctRows: true,
      relayOwnerConditionalExhaustRearm: true,
      allocatorConcurrentAttempts: 12,
      usageIdempotentEnrichWithoutOverwrite: true,
      generationIdPartialUnique: true,
      mediaCasAndDeleteFailureVisibility: true,
    }),
  );
} finally {
  await Promise.all([database.close(), rawPool.end()]);
}
