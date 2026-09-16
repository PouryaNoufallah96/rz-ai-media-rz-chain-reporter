import { randomUUID } from "node:crypto";
import {
  MARKET_CATALOG_REFRESH_COMMAND_PREFIX,
  marketCatalogRefreshRequestedPayloadSchema,
} from "@rz-chain-reporter/contracts";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import {
  claimMarketComparisonCatalogRefresh,
  ensureMarketComparisonCatalogRefresh,
  publishMarketComparisonCatalogBatch,
  recordMarketComparisonCatalogFailure,
  releaseMarketComparisonCatalogRefresh,
} from "@rz-chain-reporter/db/repositories/market-comparison-catalog";
import {
  claimOperationExecution,
  settleClaimedOperation,
} from "@rz-chain-reporter/db/repositories/operation";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { and, eq, gt, like, lte } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { z } from "zod";
import { workerLogger } from "../logging/logger";
import { resolveMarketProviderBindings } from "../market/bindings";
import { createMarketAdapters } from "../market/fetcher";
import { workerEnv } from "../runtime/env";
import { notifyMarketCatalogChanged } from "../web-cache/market-analysis";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const FUNCTION_ID = "market-catalog-refresh";
const CLAIM_LEASE_MS = 5 * 60_000;
const owner = (operationId: string) =>
  `${MARKET_CATALOG_REFRESH_COMMAND_PREFIX}${operationId}`;

const cancelledIdsSchema = z.object({
  data: z.object({ function_id: z.string(), run_id: z.string() }),
});

const cancelledEnvelopeSchema = z.object({
  data: z.object({
    event: z.object({ data: marketCatalogRefreshRequestedPayloadSchema }),
    run_id: z.string(),
  }),
});

async function refreshMarketCatalog(
  runtime: WorkerRuntime,
  input: {
    operationId: string;
    operationVersion: number;
    workspaceId: string;
  },
) {
  const market = runtime.template.marketAnalysis;
  if (!market.enabled) {
    throw new NonRetriableError("market analysis is disabled");
  }
  const rows = await createMarketAdapters(
    resolveMarketProviderBindings(runtime.template, workerEnv),
  ).catalogs[market.comparisonProvider].fetchCatalog();
  if (rows.length === 0) {
    const settled = await failOwnedCatalog(
      runtime,
      input.workspaceId,
      input.operationId,
      "MARKET_SERIES_UNAVAILABLE",
      input.operationVersion,
    );
    return {
      rowCount: 0,
      settled: settled !== null,
      status: "failed" as const,
    };
  }
  const claimedBy = owner(input.operationId);
  const publishedAt = new Date();
  const published = await runtime.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.workspaceId);
    const state = await publishMarketComparisonCatalogBatch(
      tx,
      input.workspaceId,
      {
        operationId: input.operationId,
        claimedBy,
        batchId: randomUUID(),
        rows,
        publishedAt,
        cleanupLimit: 500,
      },
    );
    const [settled] = await tx
      .update(operation)
      .set({
        claimedAt: null,
        claimedBy: null,
        leaseExpiresAt: null,
        lifecycle: "succeeded",
        updatedAt: publishedAt,
        version: input.operationVersion + 1,
      })
      .where(
        and(
          eq(operation.workspaceId, input.workspaceId),
          eq(operation.id, input.operationId),
          eq(operation.claimedBy, claimedBy),
          eq(operation.version, input.operationVersion),
          eq(operation.lifecycle, "running"),
          gt(operation.leaseExpiresAt, publishedAt),
        ),
      )
      .returning();
    if (!settled) throw new Error("market catalog lost operation ownership");
    return { batchId: state.currentBatchId, rowCount: rows.length };
  });
  return { ...published, settled: true, status: "succeeded" as const };
}

export function createMarketCatalogRefreshFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  const effect = client.createFunction(
    {
      id: FUNCTION_ID,
      retries: 3,
      timeouts: { finish: "8m" },
      triggers: [durableEvents.operationMarketCatalogRefreshRequested],
      onFailure: async ({ event, step }) => {
        const payload = event.data.event.data;
        const result = await step.run(
          "settle-failed-market-catalog",
          async () => {
            const settled = await failOwnedCatalog(
              runtime,
              payload.workspaceId,
              payload.operationId,
              "TRANSIENT_CONFLICT",
            );
            return settled
              ? {
                  settled: true as const,
                  actor: settled.actor,
                  operationVersion: settled.version,
                }
              : { settled: false as const };
          },
        );
        if (result.settled) {
          await notifyMarketCatalogChanged(
            step,
            payload.workspaceId,
            "failure",
          );
          await publishOperationStatus(
            step,
            payload.workspaceId,
            {
              actorId: result.actor,
              lifecycle: "failed",
              operationId: payload.operationId,
              operationVersion: result.operationVersion,
              sharedImport: false,
            },
            "worker.market-catalog.realtime-unavailable",
          );
        }
      },
    },
    async ({ event, step }) => {
      const operationOwner = owner(event.data.operationId);
      const claimed = await step.run(
        "claim-market-catalog-operation",
        async () => {
          await assertWorkspace(runtime, event.data.workspaceId);
          const now = new Date();
          const result = await claimOperationExecution(
            runtime.db,
            event.data.workspaceId,
            {
              id: event.data.operationId,
              claimedBy: operationOwner,
              now,
              leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
            },
          );
          if (result.status !== "claimed") return { status: result.status };
          if (
            !result.operation.commandType.startsWith(
              MARKET_CATALOG_REFRESH_COMMAND_PREFIX,
            )
          ) {
            throw new NonRetriableError("market catalog command type mismatch");
          }
          const catalogClaim = await runtime.db.transaction(async (tx) => {
            await withWorkspaceContext(tx, event.data.workspaceId);
            return claimMarketComparisonCatalogRefresh(
              tx,
              event.data.workspaceId,
              {
                operationId: event.data.operationId,
                claimedBy: operationOwner,
                claimedAt: now,
                leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
              },
            );
          });
          if (!catalogClaim) {
            throw new Error("market catalog refresh is busy");
          }
          return {
            status: "claimed" as const,
            actor: result.operation.actor,
            operationVersion: result.operation.version,
          };
        },
      );
      if (claimed.status !== "claimed") {
        if (claimed.status === "terminal") {
          await notifyMarketCatalogChanged(
            step,
            event.data.workspaceId,
            "replayed",
          );
        }
        return { status: claimed.status };
      }
      await publishOperationStatus(
        step,
        event.data.workspaceId,
        {
          actorId: claimed.actor,
          lifecycle: "running",
          operationId: event.data.operationId,
          operationVersion: claimed.operationVersion,
          sharedImport: false,
        },
        "worker.market-catalog.realtime-unavailable",
      );
      const refreshed = await step.run(
        "fetch-publish-and-settle-market-catalog",
        () =>
          refreshMarketCatalog(runtime, {
            operationId: event.data.operationId,
            operationVersion: claimed.operationVersion,
            workspaceId: event.data.workspaceId,
          }),
      );
      if (refreshed.settled) {
        await notifyMarketCatalogChanged(
          step,
          event.data.workspaceId,
          refreshed.status === "failed" ? "empty" : "settled",
        );
        await publishOperationStatus(
          step,
          event.data.workspaceId,
          {
            actorId: claimed.actor,
            lifecycle: refreshed.status === "failed" ? "failed" : "succeeded",
            operationId: event.data.operationId,
            operationVersion: claimed.operationVersion + 1,
            sharedImport: false,
          },
          "worker.market-catalog.realtime-unavailable",
        );
      }
      return refreshed;
    },
  );
  const cancelled = client.createFunction(
    {
      id: `${FUNCTION_ID}-cancelled`,
      retries: 3,
      triggers: [
        {
          event: "inngest/function.cancelled",
          if: `event.data.function_id == '${client.id}-${FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = cancelledEnvelopeSchema.safeParse(event);
      if (!envelope.success) {
        const ids = cancelledIdsSchema.safeParse(event);
        await step.run("report-cancelled-market-catalog-invalid", () => {
          workerLogger.error("worker.market-catalog.cancelled-event-invalid", {
            errorCode: "VALIDATION_FAILED",
            functionId: ids.success ? ids.data.data.function_id : undefined,
            runId: ids.success ? ids.data.data.run_id : undefined,
          });
          return { parsed: false };
        });
        return { status: "invalid" };
      }
      const payload = envelope.data.data.event.data;
      const { operationId, workspaceId } = payload;
      const result = await step.run(
        "settle-cancelled-market-catalog",
        async () => {
          const settled = await settleCatalogCancellation(
            runtime,
            workspaceId,
            operationId,
          );
          return settled
            ? {
                settled: true as const,
                actor: settled.actor,
                operationVersion: settled.version,
              }
            : { settled: false as const };
        },
      );
      if (result.settled) {
        await notifyMarketCatalogChanged(step, workspaceId, "cancelled");
        await publishOperationStatus(
          step,
          workspaceId,
          {
            actorId: result.actor,
            lifecycle: "cancelled",
            operationId,
            operationVersion: result.operationVersion,
            sharedImport: false,
          },
          "worker.market-catalog.realtime-unavailable",
        );
      }
      return { status: result.settled ? "cancelled" : "ignored" };
    },
  );
  const schedule = client.createFunction(
    {
      id: `${FUNCTION_ID}-schedule`,
      retries: 3,
      triggers: [{ cron: "0 */6 * * *" }],
    },
    async ({ event, step }) => {
      return step.run("ensure-scheduled-market-catalog-command", async () => {
        const installation = await assertWorkspace(runtime);
        if (!runtime.template.marketAnalysis.enabled) {
          return { status: "disabled" as const };
        }
        return ensureMarketComparisonCatalogRefresh(
          runtime.db,
          installation.workspaceId,
          new Date(event.ts),
        );
      });
    },
  );
  return [effect, cancelled, schedule];
}

async function failOwnedCatalog(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
  failureCode: "TRANSIENT_CONFLICT" | "MARKET_SERIES_UNAVAILABLE",
  expectedVersion?: number,
) {
  const operationOwner = owner(operationId);
  return runtime.db.transaction(async (tx) => {
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
    if (
      !current ||
      current.claimedBy !== operationOwner ||
      (expectedVersion !== undefined && current.version !== expectedVersion)
    )
      return null;
    const now = new Date();
    const settled = await settleClaimedOperation(tx, workspaceId, {
      id: operationId,
      claimedBy: operationOwner,
      expectedVersion: current.version,
      lifecycle: "failed",
      now,
    });
    if (!settled) return null;
    await recordMarketComparisonCatalogFailure(tx, workspaceId, {
      operationId,
      claimedBy: operationOwner,
      failedAt: now,
      failureCode,
    });
    return settled;
  });
}

async function settleCatalogCancellation(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
) {
  const operationOwner = owner(operationId);
  return runtime.db.transaction(async (tx) => {
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
    if (!current || current.claimedBy !== operationOwner) return null;
    const now = new Date();
    const settled = await settleClaimedOperation(tx, workspaceId, {
      id: operationId,
      claimedBy: operationOwner,
      expectedVersion: current.version,
      lifecycle: "cancelled",
      now,
    });
    if (!settled) return null;
    await releaseMarketComparisonCatalogRefresh(tx, workspaceId, {
      operationId,
      claimedBy: operationOwner,
      releasedAt: now,
    });
    return settled;
  });
}

export async function reconcileStaleMarketCatalogRefreshes(
  runtime: WorkerRuntime,
  workspaceId: string,
  now: Date,
) {
  const stale = await runtime.db
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.lifecycle, "running"),
        like(
          operation.commandType,
          `${MARKET_CATALOG_REFRESH_COMMAND_PREFIX}%`,
        ),
        lte(operation.leaseExpiresAt, now),
      ),
    )
    .limit(10);
  let settled = 0;
  const settledOperations: Array<{
    actorId: string;
    lifecycle: "failed";
    operationId: string;
    operationVersion: number;
  }> = [];
  for (const candidate of stale) {
    const changed = await runtime.db.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      const [current] = await tx
        .select()
        .from(operation)
        .where(
          and(
            eq(operation.workspaceId, workspaceId),
            eq(operation.id, candidate.id),
          ),
        )
        .for("update");
      if (
        !current ||
        current.version !== candidate.version ||
        current.lifecycle !== "running" ||
        !current.claimedBy ||
        !current.leaseExpiresAt ||
        current.leaseExpiresAt > now
      )
        return null;
      const [updated] = await tx
        .update(operation)
        .set({
          claimedAt: null,
          claimedBy: null,
          leaseExpiresAt: null,
          lifecycle: "failed",
          updatedAt: now,
          version: candidate.version + 1,
        })
        .where(
          and(
            eq(operation.workspaceId, workspaceId),
            eq(operation.id, candidate.id),
            eq(operation.version, candidate.version),
            eq(operation.lifecycle, "running"),
            eq(operation.claimedBy, current.claimedBy),
            lte(operation.leaseExpiresAt, now),
          ),
        )
        .returning();
      if (!updated) return null;
      await recordMarketComparisonCatalogFailure(tx, workspaceId, {
        operationId: candidate.id,
        claimedBy: current.claimedBy,
        failedAt: now,
        failureCode: "TRANSIENT_CONFLICT",
      });
      return updated;
    });
    if (changed) {
      settled += 1;
      settledOperations.push({
        actorId: changed.actor,
        lifecycle: "failed",
        operationId: changed.id,
        operationVersion: changed.version,
      });
    }
  }
  return { observed: stale.length, settled, settledOperations };
}
