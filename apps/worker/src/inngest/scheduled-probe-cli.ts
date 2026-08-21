import { createHash, randomUUID } from "node:crypto";
import {
  ATTEMPT_OUTCOMES,
  type AttemptOutcome,
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME,
  SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX,
} from "@rz-chain-reporter/contracts";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { createOperation } from "@rz-chain-reporter/db/repositories/operation";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { draftRevision } from "@rz-chain-reporter/db/schema/draft-revision";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { schedule } from "@rz-chain-reporter/db/schema/schedule";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";

import { workerEnv } from "../runtime/env";
import { assertWorkspace, openWorkerRuntime } from "./runtime";
import { diagnosticIdempotencyKey } from "./scheduled-effect-probe";

const EXIT_FAILURE = 1;
const DEFAULT_DELAY_SECONDS = 30;
const delaySecondsSchema = z.coerce.number().int().min(1).max(3600);
const operationIdSchema = z.uuid();

if (workerEnv.INNGEST_DEV === undefined) {
  console.error("scheduled-probe failed [DIAGNOSTIC_MODE_REQUIRED]");
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
      `scheduled-probe failed [${
        error instanceof Error ? error.message : "UNKNOWN"
      }]`,
    );
  }
} finally {
  await database.close();
}

async function createProbe(workspaceId: string, args: string[]) {
  const outcome = ATTEMPT_OUTCOMES.find((value) => value === args[0]);
  const delay = delaySecondsSchema.safeParse(args[1] ?? DEFAULT_DELAY_SECONDS);
  if (!outcome || !delay.success || args.length > 2) {
    failUsage();
  }

  const operationId = randomUUID();
  const scheduleId = randomUUID();
  const effectiveAt = new Date(Date.now() + delay.data * 1000);
  const commandType = `${SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX}${outcome}`;
  const idempotencyKey = diagnosticIdempotencyKey(scheduleId, operationId);
  const requestHash = createHash("sha256")
    .update(`${idempotencyKey}:${commandType}:${effectiveAt.toISOString()}`)
    .digest("hex");

  const result = await database.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [actor] = await tx
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt))
      .limit(1);
    const [draft] = await tx
      .select({
        id: draftRevision.id,
        platform: platformDraft.platform,
      })
      .from(draftRevision)
      .innerJoin(
        platformDraft,
        and(
          eq(platformDraft.id, draftRevision.platformDraftId),
          eq(platformDraft.workspaceId, workspaceId),
        ),
      )
      .where(eq(draftRevision.workspaceId, workspaceId))
      .orderBy(desc(draftRevision.createdAt))
      .limit(1);
    if (!actor || !draft) {
      throw new Error("DIAGNOSTIC_FIXTURE_REQUIRED");
    }

    await tx.insert(schedule).values({
      id: scheduleId,
      draftRevisionId: draft.id,
      effectiveAt,
      platform: draft.platform,
      scheduledAt: effectiveAt,
      timezone: "UTC",
      workspaceId,
    });

    return createOperation(tx, workspaceId, {
      actor: actor.id,
      commandType,
      event: {
        payload: {
          operationId,
          scheduleId,
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          workspaceId,
        },
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        type: OPERATION_SCHEDULED_EFFECT_REQUESTED_EVENT_NAME,
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
  console.log(
    `Scheduled effect created operation=${operationId} schedule=${scheduleId} outcome=${outcome} effectiveAt=${effectiveAt.toISOString()}`,
  );
}

async function inspectProbe(workspaceId: string, args: string[]) {
  const parsedId = operationIdSchema.safeParse(args[0]);
  if (!parsedId.success || args.length !== 1) {
    failUsage();
  }

  const [row] = await database.db
    .select({
      attemptOutcome: operationAttempt.outcome,
      lifecycle: operation.lifecycle,
      operationId: operation.id,
      providerResultId: operationAttempt.providerResultId,
    })
    .from(operation)
    .leftJoin(
      operationAttempt,
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(operationAttempt.operationId, operation.id),
      ),
    )
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, parsedId.data),
      ),
    )
    .orderBy(desc(operationAttempt.attemptNumber))
    .limit(1);
  if (!row) {
    throw new Error("NOT_FOUND");
  }

  const attempts = await database.db
    .select({ providerResultId: operationAttempt.providerResultId })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(operationAttempt.operationId, parsedId.data),
      ),
    );
  const effectIdentity = `probe:${parsedId.data}`;

  const [event] = await database.db
    .select({ payload: outboxEvent.payload })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.workspaceId, workspaceId),
        eq(outboxEvent.operationId, parsedId.data),
      ),
    )
    .limit(1);
  const payloadKeys =
    event && typeof event.payload === "object" && event.payload !== null
      ? Object.keys(event.payload).sort().join(",")
      : "invalid";

  console.log(`Scheduled effect operation=${row.operationId}`);
  console.log(`lifecycle=${row.lifecycle}`);
  console.log(`attempt=${attemptLabel(row.attemptOutcome)}`);
  console.log(`outcome=${row.attemptOutcome ?? "none"}`);
  console.log(`providerResultId=${row.providerResultId ?? "none"}`);
  console.log(`attemptCount=${attempts.length}`);
  console.log(
    `recordedEffectCount=${
      attempts.filter((attempt) => attempt.providerResultId === effectIdentity)
        .length
    }`,
  );
  console.log(`eventPayloadKeys=${payloadKeys}`);
}

function attemptLabel(outcome: AttemptOutcome | null) {
  if (outcome === null) {
    return "never-attempted";
  }
  if (outcome === "succeeded") {
    return "attempted-ok";
  }
  if (outcome === "ambiguous") {
    return "attempted-unknown";
  }
  return "attempted-failed";
}

function failUsage(): never {
  throw new Error(
    "USAGE: create <succeeded|failed_retryable|failed_terminal|ambiguous> [delay-seconds] | inspect <operation-id>",
  );
}
