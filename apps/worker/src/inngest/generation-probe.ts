import {
  GENERATION_PROBE_COMMAND_PREFIX,
  operationCommandVariant,
} from "@rz-chain-reporter/contracts";
import type { Executor, Transaction } from "@rz-chain-reporter/db/executor";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { ModelGatewayInvocationError } from "@rz-chain-reporter/model-gateway/errors";
import { and, desc, eq, sql } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { workerLogger } from "../logging/logger";

import { workerModelGateway } from "../model-gateway/worker-gateway";
import { notifyUsageLedgerChanged } from "../web-cache/usage-ledger";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import {
  createGenerationProbeFixture,
  type GenerationProbeMode,
} from "./generation-probe-fixture";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const CLAIM_LEASE_MS = 120_000;
const FUNCTION_ID = "generation-probe";
const WORKER_CLAIMANT = "generation-probe:v1";
const resultSchema = z.strictObject({ ok: z.literal(true) });

export function createGenerationProbeFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  return client.createFunction(
    {
      id: FUNCTION_ID,
      concurrency: 1,
      retries: 0,
      triggers: [durableEvents.operationGenerationRequested],
      onFailure: async ({ event, step }) => {
        await notifyUsageLedgerChanged(
          step,
          event.data.event.data.workspaceId,
          null,
          "failure",
        );
      },
    },
    async ({ event, step }) => {
      const claim = await step.run("claim-operation", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        return claimOperation(
          runtime.db,
          event.data.workspaceId,
          event.data.operationId,
        );
      });

      if (claim.status === "terminal") {
        await notifyUsageLedgerChanged(
          step,
          event.data.workspaceId,
          claim.actor,
          "replayed",
        );
        return {
          operationId: event.data.operationId,
          replayed: true,
          usageEventId: claim.usageEventId,
        };
      }

      const runningRealtimePublished = await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          actorId: claim.actor,
          attemptCount: claim.attemptNumber,
          lifecycle: "running",
          operationId: event.data.operationId,
          operationVersion: claim.operationVersion,
          sharedImport: false,
        },
        "worker.generation-probe.realtime-unavailable",
      );

      const invocation = await step.run("invoke-model", async () => {
        const startedAt = Date.now();
        try {
          await assertWorkspace(runtime, event.data.workspaceId);
          const gateway =
            claim.mode === "real"
              ? workerModelGateway(runtime)
              : createGenerationProbeFixture({
                  executor: runtime.db,
                  mode: claim.mode,
                  template: runtime.template,
                });

          const result = await gateway.invokeStructured({
            deadlineMs: 30_000,
            invocationKey: "primary",
            maxOutputTokens: 32,
            operationAttemptId: claim.attemptId,
            operationId: event.data.operationId,
            outputName: "generation_probe",
            persistResult: (tx) =>
              completeOperation(
                tx,
                event.data.workspaceId,
                event.data.operationId,
                claim.attemptId,
                Date.now() - startedAt,
              ),
            prompt: "Return a JSON object with ok set to true.",
            schema: resultSchema,
            taskKey: "generation-probe",
            workspaceId: event.data.workspaceId,
          });

          return {
            attemptOutcome: "succeeded" as const,
            status: "succeeded" as const,
            usageEventId: result.usageEventId,
          };
        } catch (error) {
          const failure = classifyFailure(error);
          await failOperation(
            runtime.db,
            event.data.workspaceId,
            event.data.operationId,
            claim.attemptId,
            Date.now() - startedAt,
            failure,
          );
          workerLogger.warn("worker.generation-probe.failed", {
            errorCode: failure.code,
            operationId: event.data.operationId,
            workspaceId: event.data.workspaceId,
          });
          return {
            attemptOutcome: failure.outcome,
            status: failure.lifecycle,
            usageEventId: failure.usageEventId,
          };
        }
      });

      const terminal = await step.run("read-terminal-status", async () => {
        await assertWorkspace(runtime, event.data.workspaceId);
        const [row] = await runtime.db
          .select({
            lifecycle: operation.lifecycle,
            version: operation.version,
          })
          .from(operation)
          .where(
            and(
              eq(operation.workspaceId, event.data.workspaceId),
              eq(operation.id, event.data.operationId),
            ),
          );
        if (!row) {
          throw new NonRetriableError("generation probe operation disappeared");
        }
        return row;
      });

      const { cacheInvalidation, usageRealtimePublished } =
        await notifyUsageLedgerChanged(
          step,
          event.data.workspaceId,
          claim.actor,
          "settled",
        );

      const terminalRealtimePublished = await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          actorId: claim.actor,
          attemptCount: claim.attemptNumber,
          latestAttemptOutcome: invocation.attemptOutcome,
          lifecycle: terminal.lifecycle,
          operationId: event.data.operationId,
          operationVersion: terminal.version,
          sharedImport: false,
        },
        "worker.generation-probe.realtime-unavailable",
      );

      return {
        cacheInvalidation,
        lifecycle: terminal.lifecycle,
        operationId: event.data.operationId,
        realtimePublished:
          runningRealtimePublished && terminalRealtimePublished,
        usageEventId: invocation.usageEventId,
        usageRealtimePublished,
      };
    },
  );
}

async function claimOperation(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, operationId),
        ),
      )
      .for("update");

    if (!current) {
      throw new NonRetriableError("generation probe operation not found");
    }

    const mode = parseMode(current.commandType);
    if (
      current.lifecycle === "succeeded" ||
      current.lifecycle === "failed" ||
      current.lifecycle === "cancelled" ||
      current.lifecycle === "unknown"
    ) {
      const [usage] = await tx
        .select({ id: aiUsageEvent.id })
        .from(aiUsageEvent)
        .where(
          and(
            eq(aiUsageEvent.workspaceId, workspaceId),
            eq(aiUsageEvent.operationId, operationId),
          ),
        )
        .orderBy(desc(aiUsageEvent.occurredAt))
        .limit(1);
      return {
        actor: current.actor,
        status: "terminal" as const,
        usageEventId: usage?.id ?? null,
      };
    }

    if (current.lifecycle !== "queued" && current.lifecycle !== "running") {
      throw new NonRetriableError("generation probe operation is settling");
    }

    let attemptId: string;
    let attemptNumber: number;
    if (current.lifecycle === "queued") {
      attemptNumber = current.attemptSeq + 1;
      const [attempt] = await tx
        .insert(operationAttempt)
        .values({
          attemptNumber,
          operationId,
          workspaceId,
        })
        .returning({ id: operationAttempt.id });
      if (!attempt) {
        throw new Error("generation probe attempt insert returned no row");
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
            eq(operationAttempt.workspaceId, workspaceId),
            eq(operationAttempt.operationId, operationId),
          ),
        )
        .orderBy(desc(operationAttempt.attemptNumber))
        .limit(1);
      if (!attempt) {
        throw new NonRetriableError("running generation probe has no attempt");
      }
      attemptId = attempt.id;
      attemptNumber = attempt.attemptNumber;
    }

    const now = new Date();
    const [claimed] = await tx
      .update(operation)
      .set({
        attemptSeq: attemptNumber,
        claimedAt: now,
        claimedBy: WORKER_CLAIMANT,
        leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
        lifecycle: "running",
        updatedAt: now,
        version: sql`${operation.version} + 1`,
      })
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, operationId),
        ),
      )
      .returning({ version: operation.version });
    if (!claimed) {
      throw new Error("generation probe claim update returned no row");
    }

    return {
      actor: current.actor,
      attemptId,
      attemptNumber,
      mode,
      operationVersion: claimed.version,
      status: "claimed" as const,
    };
  });
}

function parseMode(commandType: string): GenerationProbeMode {
  const variant = operationCommandVariant(
    commandType,
    GENERATION_PROBE_COMMAND_PREFIX,
  );
  if (
    variant === "real" ||
    variant === "invalid-output" ||
    variant === "fallback"
  ) {
    return variant;
  }
  throw new NonRetriableError("unsupported generation probe command");
}

async function completeOperation(
  tx: Transaction,
  workspaceId: string,
  operationId: string,
  attemptId: string,
  latencyMs: number,
) {
  const [attempt] = await tx
    .update(operationAttempt)
    .set({
      latencyMs,
      outcome: "succeeded",
      providerResultId: "generation-probe:v1:ok",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(operationAttempt.id, attemptId),
      ),
    )
    .returning({ id: operationAttempt.id });
  if (!attempt) {
    throw new Error("generation probe attempt completion updated no row");
  }

  const [settling] = await tx
    .update(operation)
    .set({
      lifecycle: "settling",
      updatedAt: new Date(),
      version: sql`${operation.version} + 1`,
    })
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, operationId),
        eq(operation.lifecycle, "running"),
      ),
    )
    .returning({ id: operation.id });
  if (!settling) {
    throw new Error("generation probe settling transition updated no row");
  }

  const [completed] = await tx
    .update(operation)
    .set({
      claimedAt: null,
      claimedBy: null,
      leaseExpiresAt: null,
      lifecycle: "succeeded",
      updatedAt: new Date(),
      version: sql`${operation.version} + 1`,
    })
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, operationId),
        eq(operation.lifecycle, "settling"),
      ),
    )
    .returning({ id: operation.id });
  if (!completed) {
    throw new Error("generation probe success transition updated no row");
  }
}

function classifyFailure(error: unknown) {
  if (error instanceof ModelGatewayInvocationError) {
    return {
      code: error.code,
      lifecycle: error.ambiguous ? ("unknown" as const) : ("failed" as const),
      outcome: error.ambiguous
        ? ("ambiguous" as const)
        : error.retryable
          ? ("failed_retryable" as const)
          : ("failed_terminal" as const),
      usageEventId: error.usageEventId,
    };
  }
  return {
    code: "INTERNAL_SERVER_ERROR" as const,
    lifecycle: "unknown" as const,
    outcome: "ambiguous" as const,
    usageEventId: null,
  };
}

async function failOperation(
  executor: Executor,
  workspaceId: string,
  operationId: string,
  attemptId: string,
  latencyMs: number,
  failure: ReturnType<typeof classifyFailure>,
) {
  await executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    const [attempt] = await tx
      .update(operationAttempt)
      .set({
        failureCode: failure.code,
        latencyMs,
        outcome: failure.outcome,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(operationAttempt.workspaceId, workspaceId),
          eq(operationAttempt.id, attemptId),
        ),
      )
      .returning({ id: operationAttempt.id });
    if (!attempt) {
      throw new Error("generation probe attempt failure updated no row");
    }

    const [failed] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: failure.lifecycle,
        updatedAt: new Date(),
        version: sql`${operation.version} + 1`,
      })
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, operationId),
          eq(operation.lifecycle, "running"),
        ),
      )
      .returning({ id: operation.id });
    if (!failed) {
      throw new Error("generation probe failure transition updated no row");
    }
  });
}
