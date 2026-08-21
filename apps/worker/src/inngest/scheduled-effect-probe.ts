import type {
  AttemptOutcome,
  OperationLifecycle,
} from "@rz-chain-reporter/contracts";
import {
  operationCommandVariant,
  SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { schedule } from "@rz-chain-reporter/db/schema/schedule";
import { and, desc, eq, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";

import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const CLAIM_LEASE_AFTER_WAKE_MS = 120_000;
const FUNCTION_ID = "scheduled-effect-probe";
const WORKER_CLAIMANT = "scheduled-effect-probe:v1";

type ScheduledEffectProbeInput = {
  attemptId: string;
  attemptNumber: number;
  claimVersion: number;
  effectiveAt: string;
  operationId: string;
  outcome: AttemptOutcome;
  scheduleId: string;
  workspaceId: string;
};

export function createScheduledEffectProbeFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  return client.createFunction(
    {
      id: FUNCTION_ID,
      concurrency: 1,
      retries: 2,
      triggers: [durableEvents.operationScheduledEffectRequested],
    },
    async ({ event, step }) => {
      const claim = await step.run("claim-scheduled-effect", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        return claimScheduledEffectProbe(runtime.db, {
          operationId: event.data.operationId,
          scheduleId: event.data.scheduleId,
          workspaceId: event.data.workspaceId,
        });
      });

      if (claim.status === "terminal") {
        return {
          effectIdentity: claim.effectIdentity,
          operationId: event.data.operationId,
          replayed: true,
        };
      }

      const runningPublished = await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          attemptCount: claim.attemptNumber,
          lifecycle: "running",
          operationId: event.data.operationId,
          operationVersion: claim.claimVersion,
        },
        "worker.scheduled-effect.realtime-unavailable",
      );

      await step.sleepUntil("wait-until-effective-at", claim.effectiveAt);

      await step.run("reassert-after-wake", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        await assertScheduledEffectProbe(runtime.db, claim);
      });

      const effect = await step.run("record-scheduled-effect", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        return runScheduledEffectProbe(runtime.db, claim);
      });

      const terminalPublished = await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          attemptCount: claim.attemptNumber,
          latestAttemptOutcome: effect.outcome,
          lifecycle: effect.lifecycle,
          operationId: event.data.operationId,
          operationVersion: effect.operationVersion,
        },
        "worker.scheduled-effect.realtime-unavailable",
      );

      return {
        effectIdentity: effect.effectIdentity,
        lifecycle: effect.lifecycle,
        operationId: event.data.operationId,
        realtimePublished: runningPublished && terminalPublished,
        replayed: effect.replayed,
      };
    },
  );
}

async function runScheduledEffectProbe(
  executor: Executor,
  input: ScheduledEffectProbeInput,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.workspaceId);
    const state = await loadProbeState(tx, input);
    const effectIdentity = `probe:${input.operationId}`;

    if (
      state.attempt.providerResultId === effectIdentity &&
      isTerminal(state.operation.lifecycle)
    ) {
      if (state.attempt.outcome === null) {
        throw new NonRetriableError(
          "scheduled effect terminal attempt has no outcome",
        );
      }
      return {
        effectIdentity,
        lifecycle: state.operation.lifecycle,
        operationVersion: state.operation.version,
        outcome: state.attempt.outcome,
        replayed: true,
      };
    }

    assertProbeState(state, input);
    if (state.attempt.providerResultId !== null) {
      throw new NonRetriableError(
        "scheduled effect attempt has a different result identity",
      );
    }

    const now = new Date();
    const lifecycle = lifecycleForOutcome(input.outcome);
    const [attempt] = await tx
      .update(operationAttempt)
      .set({
        failureCode:
          input.outcome === "succeeded" ? null : "INTERNAL_SERVER_ERROR",
        latencyMs: 0,
        outcome: input.outcome,
        providerResultId: effectIdentity,
        updatedAt: now,
      })
      .where(
        and(
          eq(operationAttempt.workspaceId, input.workspaceId),
          eq(operationAttempt.id, input.attemptId),
          sql`${operationAttempt.providerResultId} is null`,
          sql`${operationAttempt.outcome} is null`,
        ),
      )
      .returning({ id: operationAttempt.id });
    if (!attempt) {
      throw new Error("scheduled effect attempt update returned no row");
    }

    let operationVersion = input.claimVersion;
    if (lifecycle === "succeeded") {
      const [settling] = await tx
        .update(operation)
        .set({
          lifecycle: "settling",
          updatedAt: now,
          version: sql`${operation.version} + 1`,
        })
        .where(
          and(
            eq(operation.workspaceId, input.workspaceId),
            eq(operation.id, input.operationId),
            eq(operation.lifecycle, "running"),
            eq(operation.version, input.claimVersion),
            eq(operation.claimedBy, WORKER_CLAIMANT),
          ),
        )
        .returning({ version: operation.version });
      if (!settling) {
        throw new Error("scheduled effect settling transition updated no row");
      }
      operationVersion = settling.version;
    }

    const [completed] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle,
        updatedAt: now,
        version: sql`${operation.version} + 1`,
      })
      .where(
        and(
          eq(operation.workspaceId, input.workspaceId),
          eq(operation.id, input.operationId),
          eq(
            operation.lifecycle,
            lifecycle === "succeeded" ? "settling" : "running",
          ),
          eq(operation.version, operationVersion),
          eq(operation.claimedBy, WORKER_CLAIMANT),
        ),
      )
      .returning({ version: operation.version });
    if (!completed) {
      throw new Error("scheduled effect completion updated no row");
    }

    return {
      effectIdentity,
      lifecycle,
      operationVersion: completed.version,
      outcome: input.outcome,
      replayed: false,
    };
  });
}

async function claimScheduledEffectProbe(
  executor: Executor,
  input: Pick<
    ScheduledEffectProbeInput,
    "operationId" | "scheduleId" | "workspaceId"
  >,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.workspaceId);
    const [currentOperation] = await tx
      .select()
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, input.workspaceId),
          eq(operation.id, input.operationId),
        ),
      )
      .for("update");
    const [currentSchedule] = await tx
      .select()
      .from(schedule)
      .where(
        and(
          eq(schedule.workspaceId, input.workspaceId),
          eq(schedule.id, input.scheduleId),
        ),
      )
      .for("update");

    if (!currentOperation || !currentSchedule) {
      throw new NonRetriableError(
        "scheduled effect diagnostic state not found",
      );
    }

    const outcome = parseOutcome(currentOperation.commandType);
    assertDiagnosticEligibility(currentOperation, currentSchedule, input);

    if (isTerminal(currentOperation.lifecycle)) {
      const [attempt] = await tx
        .select({
          outcome: operationAttempt.outcome,
          providerResultId: operationAttempt.providerResultId,
        })
        .from(operationAttempt)
        .where(
          and(
            eq(operationAttempt.workspaceId, input.workspaceId),
            eq(operationAttempt.operationId, input.operationId),
          ),
        )
        .orderBy(desc(operationAttempt.attemptNumber))
        .limit(1);
      const effectIdentity = `probe:${input.operationId}`;
      if (
        !attempt ||
        attempt.outcome === null ||
        attempt.providerResultId !== effectIdentity
      ) {
        throw new NonRetriableError(
          "scheduled effect terminal state has no recorded effect",
        );
      }
      return { effectIdentity, status: "terminal" as const };
    }

    if (
      currentOperation.lifecycle !== "queued" &&
      !(
        currentOperation.lifecycle === "running" &&
        currentOperation.claimedBy === WORKER_CLAIMANT
      )
    ) {
      throw new NonRetriableError(
        "scheduled effect operation is not claimable",
      );
    }

    let attemptId: string;
    let attemptNumber: number;
    if (currentOperation.lifecycle === "queued") {
      attemptNumber = currentOperation.attemptSeq + 1;
      const [attempt] = await tx
        .insert(operationAttempt)
        .values({
          attemptNumber,
          operationId: input.operationId,
          workspaceId: input.workspaceId,
        })
        .returning({ id: operationAttempt.id });
      if (!attempt) {
        throw new Error("scheduled effect attempt insert returned no row");
      }
      attemptId = attempt.id;
    } else {
      const [attempt] = await tx
        .select({
          id: operationAttempt.id,
          attemptNumber: operationAttempt.attemptNumber,
        })
        .from(operationAttempt)
        .where(
          and(
            eq(operationAttempt.workspaceId, input.workspaceId),
            eq(operationAttempt.operationId, input.operationId),
          ),
        )
        .orderBy(desc(operationAttempt.attemptNumber))
        .limit(1);
      if (!attempt) {
        throw new NonRetriableError("running scheduled effect has no attempt");
      }
      attemptId = attempt.id;
      attemptNumber = attempt.attemptNumber;
    }

    const now = new Date();
    const leaseExpiresAt = new Date(
      Math.max(
        now.getTime() + CLAIM_LEASE_AFTER_WAKE_MS,
        currentSchedule.effectiveAt.getTime() + CLAIM_LEASE_AFTER_WAKE_MS,
      ),
    );
    const [claimed] = await tx
      .update(operation)
      .set({
        attemptSeq: attemptNumber,
        claimedAt: now,
        claimedBy: WORKER_CLAIMANT,
        leaseExpiresAt,
        lifecycle: "running",
        updatedAt: now,
        version: sql`${operation.version} + 1`,
      })
      .where(
        and(
          eq(operation.workspaceId, input.workspaceId),
          eq(operation.id, input.operationId),
        ),
      )
      .returning({ version: operation.version });
    if (!claimed) {
      throw new Error("scheduled effect claim update returned no row");
    }

    return {
      attemptId,
      attemptNumber,
      claimVersion: claimed.version,
      effectiveAt: currentSchedule.effectiveAt.toISOString(),
      operationId: input.operationId,
      outcome,
      scheduleId: input.scheduleId,
      status: "claimed" as const,
      workspaceId: input.workspaceId,
    };
  });
}

async function assertScheduledEffectProbe(
  executor: Executor,
  input: ScheduledEffectProbeInput,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.workspaceId);
    const state = await loadProbeState(tx, input);
    assertProbeState(state, input);
  });
}

async function loadProbeState(
  executor: Executor,
  input: ScheduledEffectProbeInput,
) {
  const [currentOperation] = await executor
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, input.workspaceId),
        eq(operation.id, input.operationId),
      ),
    )
    .for("update");
  const [currentSchedule] = await executor
    .select()
    .from(schedule)
    .where(
      and(
        eq(schedule.workspaceId, input.workspaceId),
        eq(schedule.id, input.scheduleId),
      ),
    )
    .for("update");
  const [attempt] = await executor
    .select()
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, input.workspaceId),
        eq(operationAttempt.id, input.attemptId),
        eq(operationAttempt.operationId, input.operationId),
      ),
    )
    .for("update");

  if (!currentOperation || !currentSchedule || !attempt) {
    throw new NonRetriableError(
      "scheduled effect diagnostic state disappeared",
    );
  }
  return { attempt, operation: currentOperation, schedule: currentSchedule };
}

function assertProbeState(
  state: Awaited<ReturnType<typeof loadProbeState>>,
  input: ScheduledEffectProbeInput,
) {
  assertDiagnosticEligibility(state.operation, state.schedule, input);
  if (
    state.operation.lifecycle !== "running" ||
    state.operation.claimedBy !== WORKER_CLAIMANT ||
    state.operation.version !== input.claimVersion ||
    state.operation.attemptSeq !== input.attemptNumber ||
    state.attempt.attemptNumber !== input.attemptNumber ||
    state.schedule.effectiveAt.toISOString() !== input.effectiveAt
  ) {
    throw new NonRetriableError(
      "scheduled effect post-wake ownership or version changed",
    );
  }
}

function assertDiagnosticEligibility(
  currentOperation: typeof operation.$inferSelect,
  currentSchedule: typeof schedule.$inferSelect,
  input: Pick<
    ScheduledEffectProbeInput,
    "operationId" | "scheduleId" | "workspaceId"
  >,
) {
  if (
    currentOperation.workspaceId !== input.workspaceId ||
    currentSchedule.workspaceId !== input.workspaceId ||
    currentOperation.idempotencyKey !==
      diagnosticIdempotencyKey(input.scheduleId, input.operationId) ||
    currentSchedule.status !== "scheduled"
  ) {
    throw new NonRetriableError(
      "scheduled effect is no longer diagnostic eligible",
    );
  }
}

function parseOutcome(commandType: string): AttemptOutcome {
  const outcome = operationCommandVariant(
    commandType,
    SCHEDULED_EFFECT_PROBE_COMMAND_PREFIX,
  );
  if (
    outcome === "succeeded" ||
    outcome === "failed_retryable" ||
    outcome === "failed_terminal" ||
    outcome === "ambiguous"
  ) {
    return outcome;
  }
  throw new NonRetriableError("unsupported scheduled effect probe command");
}

function lifecycleForOutcome(outcome: AttemptOutcome): OperationLifecycle {
  if (outcome === "succeeded") {
    return "succeeded";
  }
  if (outcome === "ambiguous") {
    return "unknown";
  }
  return "failed";
}

function isTerminal(lifecycle: OperationLifecycle) {
  return (
    lifecycle === "succeeded" ||
    lifecycle === "failed" ||
    lifecycle === "cancelled" ||
    lifecycle === "unknown"
  );
}

export function diagnosticIdempotencyKey(
  scheduleId: string,
  operationId: string,
) {
  return `scheduled-effect-probe:${scheduleId}:${operationId}`;
}
