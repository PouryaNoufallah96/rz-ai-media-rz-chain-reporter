import { randomUUID } from "node:crypto";
import { MARKET_CATALOG_REFRESH_COMMAND_PREFIX } from "@rz-chain-reporter/contracts";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import {
  claimMarketComparisonCatalogRefresh,
  ensureMarketComparisonCatalogRefresh,
  publishMarketComparisonCatalogBatch,
  recordMarketComparisonCatalogFailure,
} from "@rz-chain-reporter/db/repositories/market-comparison-catalog";
import {
  claimOperationExecution,
  settleClaimedOperation,
} from "@rz-chain-reporter/db/repositories/operation";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { and, eq, like, lte } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { resolveMarketProviderBindings } from "../market/bindings";
import { createMarketAdapters } from "../market/fetcher";
import { workerEnv } from "../runtime/env";
import { notifyMarketCatalogChanged } from "../web-cache/market-analysis";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const FUNCTION_ID = "market-catalog-refresh";
const CLAIM_LEASE_MS = 5 * 60_000;
const owner = (operationId: string) =>
  `${MARKET_CATALOG_REFRESH_COMMAND_PREFIX}${operationId}`;

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
        await step.run("settle-failed-market-catalog", () =>
          failOwnedCatalog(
            runtime,
            payload.workspaceId,
            payload.operationId,
            "TRANSIENT_CONFLICT",
          ),
        );
        await notifyMarketCatalogChanged(step, payload.workspaceId, "failure");
      },
    },
    async ({ event, step }) => {
      const operationOwner = owner(event.data.operationId);
      const claimed = await step.run(
        "claim-market-catalog-operation",
        async () => {
          await assertWorkspace(runtime, event.data.workspaceId);
          const result = await claimOperationExecution(
            runtime.db,
            event.data.workspaceId,
            {
              id: event.data.operationId,
              claimedBy: operationOwner,
              now: new Date(),
              leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
            },
          );
          if (result.status !== "claimed") return result;
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
                claimedAt: new Date(),
                leaseExpiresAt: new Date(Date.now() + CLAIM_LEASE_MS),
              },
            );
          });
          if (!catalogClaim) {
            throw new Error("market catalog refresh is busy");
          }
          return result;
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
      const rows = await step.run("fetch-binance-market-catalog", () => {
        const market = runtime.template.marketAnalysis;
        if (!market.enabled) {
          throw new NonRetriableError("market analysis is disabled");
        }
        return createMarketAdapters(
          resolveMarketProviderBindings(runtime.template, workerEnv),
        ).catalogs[market.comparisonProvider].fetchCatalog();
      });
      if (rows.length === 0) {
        await step.run("settle-empty-market-catalog", () =>
          failOwnedCatalog(
            runtime,
            event.data.workspaceId,
            event.data.operationId,
            "MARKET_SERIES_UNAVAILABLE",
          ),
        );
        await notifyMarketCatalogChanged(step, event.data.workspaceId, "empty");
        return { rowCount: 0, status: "failed" };
      }
      const published = await step.run(
        "publish-market-catalog-and-settle",
        () =>
          runtime.db.transaction(async (tx) => {
            await withWorkspaceContext(tx, event.data.workspaceId);
            const state = await publishMarketComparisonCatalogBatch(
              tx,
              event.data.workspaceId,
              {
                operationId: event.data.operationId,
                batchId: randomUUID(),
                rows,
                publishedAt: new Date(),
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
                updatedAt: new Date(),
                version: claimed.operation.version + 1,
              })
              .where(
                and(
                  eq(operation.workspaceId, event.data.workspaceId),
                  eq(operation.id, event.data.operationId),
                  eq(operation.claimedBy, operationOwner),
                  eq(operation.version, claimed.operation.version),
                ),
              )
              .returning();
            if (!settled)
              throw new Error("market catalog lost operation ownership");
            return { batchId: state.currentBatchId, rowCount: rows.length };
          }),
      );
      await notifyMarketCatalogChanged(step, event.data.workspaceId, "settled");
      return { ...published, status: "succeeded" };
    },
  );
  const cancelled = client.createFunction(
    {
      id: `${FUNCTION_ID}-cancelled`,
      retries: 3,
      triggers: [
        {
          event: "inngest/function.cancelled",
          expression: `event.data.function_id == '${FUNCTION_ID}'`,
        },
      ],
    },
    async ({ event, step }) => {
      const envelope = event.data.event as
        | { data?: { operationId?: string; workspaceId?: string } }
        | undefined;
      const payload = envelope?.data;
      if (!payload?.operationId || !payload.workspaceId)
        return { status: "ignored" };
      const { operationId, workspaceId } = payload;
      await step.run("settle-cancelled-market-catalog", () =>
        settleCatalogCancellation(runtime, workspaceId, operationId),
      );
      await notifyMarketCatalogChanged(step, workspaceId, "cancelled");
      return { status: "cancelled" };
    },
  );
  const schedule = client.createFunction(
    {
      id: `${FUNCTION_ID}-schedule`,
      retries: 3,
      triggers: [{ cron: "0 */6 * * *" }],
    },
    async ({ step }) => {
      return step.run("ensure-scheduled-market-catalog-command", async () => {
        const installation = await assertWorkspace(runtime);
        if (!runtime.template.marketAnalysis.enabled) {
          return { status: "disabled" as const };
        }
        return ensureMarketComparisonCatalogRefresh(
          runtime.db,
          installation.workspaceId,
          new Date(),
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
) {
  const operationOwner = owner(operationId);
  return runtime.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await recordMarketComparisonCatalogFailure(tx, workspaceId, {
      operationId,
      failedAt: new Date(),
      failureCode,
    });
    const [current] = await tx
      .select()
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, workspaceId),
          eq(operation.id, operationId),
        ),
      );
    if (!current || current.claimedBy !== operationOwner) return null;
    return settleClaimedOperation(tx, workspaceId, {
      id: operationId,
      claimedBy: operationOwner,
      expectedVersion: current.version,
      lifecycle: "failed",
    });
  });
}

async function settleCatalogCancellation(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
) {
  const operationOwner = owner(operationId);
  const [current] = await runtime.db
    .select()
    .from(operation)
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.id, operationId),
      ),
    );
  if (!current || current.claimedBy !== operationOwner) return null;
  return settleClaimedOperation(runtime.db, workspaceId, {
    id: operationId,
    claimedBy: operationOwner,
    expectedVersion: current.version,
    lifecycle: "cancelled",
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
  for (const candidate of stale) {
    const changed = await runtime.db.transaction(async (tx) => {
      await withWorkspaceContext(tx, workspaceId);
      await recordMarketComparisonCatalogFailure(tx, workspaceId, {
        operationId: candidate.id,
        failedAt: now,
        failureCode: "TRANSIENT_CONFLICT",
      });
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
          ),
        )
        .returning();
      return updated ?? null;
    });
    if (changed) settled += 1;
  }
  return { observed: stale.length, settled };
}
