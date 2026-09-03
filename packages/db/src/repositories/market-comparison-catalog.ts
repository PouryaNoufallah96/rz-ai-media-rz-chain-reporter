import { createHash, randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  type ErrorCode,
  MARKET_CATALOG_REFRESH_COMMAND_PREFIX,
  OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { and, asc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";

import {
  type Executor,
  type Transaction,
  withWorkspaceContext,
} from "../executor";
import { inWorkspace } from "../filters";
import { user } from "../schema/auth";
import {
  marketComparisonCatalog,
  marketComparisonCatalogState,
} from "../schema/market-analysis";
import { operation } from "../schema/operation";
import { createOperation } from "./operation";

export const MARKET_COMPARISON_CATALOG_FRESHNESS_MS = 6 * 60 * 60_000;
export const MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS = 15 * 60_000;

const SCHEDULED_REFRESH_COMMAND = `${MARKET_CATALOG_REFRESH_COMMAND_PREFIX}scheduled`;
const ACTIVE_REFRESH_LIFECYCLES = ["queued", "running", "settling"] as const;

type CatalogRow = Omit<
  typeof marketComparisonCatalog.$inferInsert,
  "workspaceId" | "batchId"
>;

export type EnsureMarketComparisonCatalogRefreshResult =
  | { status: "active"; operationId: string }
  | { status: "created"; operationId: string }
  | { status: "fresh"; nextEligibleAt: Date }
  | { status: "retry_bucket_complete"; nextEligibleAt: Date }
  | { status: "waiting_for_operator" };

export async function ensureMarketComparisonCatalogRefresh(
  executor: Executor,
  workspaceId: string,
  now: Date,
): Promise<EnsureMarketComparisonCatalogRefreshResult> {
  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('market-catalog-refresh-command'), hashtext(${workspaceId}))`,
    );
    await tx
      .insert(marketComparisonCatalogState)
      .values({ workspaceId })
      .onConflictDoNothing({
        target: marketComparisonCatalogState.workspaceId,
      });

    const [state] = await tx
      .select({
        lastFailureAt: marketComparisonCatalogState.lastFailureAt,
        lastSuccessAt: marketComparisonCatalogState.lastSuccessAt,
      })
      .from(marketComparisonCatalogState)
      .where(inWorkspace(marketComparisonCatalogState, workspaceId))
      .for("update");
    if (!state) throw new Error("market catalog state insert returned no row");

    if (state.lastSuccessAt) {
      const nextEligibleAt = new Date(
        state.lastSuccessAt.getTime() + MARKET_COMPARISON_CATALOG_FRESHNESS_MS,
      );
      if (nextEligibleAt.getTime() > now.getTime()) {
        return { status: "fresh", nextEligibleAt };
      }
    }

    const [active] = await tx
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(
          inWorkspace(operation, workspaceId),
          inArray(operation.lifecycle, ACTIVE_REFRESH_LIFECYCLES),
          sql`${operation.commandType} like ${`${MARKET_CATALOG_REFRESH_COMMAND_PREFIX}%`}`,
        ),
      )
      .orderBy(asc(operation.createdAt), asc(operation.id))
      .limit(1);
    if (active) return { status: "active", operationId: active.id };

    if (state.lastFailureAt) {
      const nextEligibleAt = new Date(
        state.lastFailureAt.getTime() +
          MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS,
      );
      if (nextEligibleAt.getTime() > now.getTime()) {
        return { status: "retry_bucket_complete", nextEligibleAt };
      }
    }

    const [actor] = await tx
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt), asc(user.id))
      .limit(1);
    if (!actor) return { status: "waiting_for_operator" };

    const retryBucket = Math.floor(
      now.getTime() / MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS,
    );
    const nextEligibleAt = new Date(
      (retryBucket + 1) * MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS,
    );
    const idempotencyKey = `scheduled:${retryBucket}`;
    const requestHash = createHash("sha256")
      .update(
        `${workspaceId}:${idempotencyKey}:${DURABLE_EVENT_SCHEMA_VERSION}`,
      )
      .digest("hex");
    const operationId = randomUUID();
    const created = await createOperation(tx, workspaceId, {
      actor: actor.id,
      commandType: SCHEDULED_REFRESH_COMMAND,
      event: {
        payload: {
          operationId,
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          workspaceId,
        },
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        type: OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
      },
      idempotencyKey,
      operationId,
      requestHash,
      requestId: null,
    });
    if (created.status === "mismatch") {
      throw new Error("market catalog refresh identity mismatch");
    }
    if (created.status === "replayed") {
      return created.operation.lifecycle === "queued" ||
        created.operation.lifecycle === "running" ||
        created.operation.lifecycle === "settling"
        ? { status: "active", operationId: created.operation.id }
        : { status: "retry_bucket_complete", nextEligibleAt };
    }
    return { status: "created", operationId: created.operation.id };
  });
}

export async function getCurrentMarketComparisonCatalog(
  executor: Executor,
  workspaceId: string,
) {
  const [state] = await executor
    .select()
    .from(marketComparisonCatalogState)
    .where(inWorkspace(marketComparisonCatalogState, workspaceId));
  if (!state?.currentBatchId) return { state: state ?? null, rows: [] };

  const rows = await executor
    .select()
    .from(marketComparisonCatalog)
    .where(
      and(
        inWorkspace(marketComparisonCatalog, workspaceId),
        eq(marketComparisonCatalog.batchId, state.currentBatchId),
      ),
    )
    .orderBy(asc(marketComparisonCatalog.symbol));
  return { state, rows };
}

export async function claimMarketComparisonCatalogRefresh(
  tx: Transaction,
  workspaceId: string,
  input: {
    operationId: string;
    claimedBy: string;
    claimedAt: Date;
    leaseExpiresAt: Date;
  },
) {
  await tx
    .insert(marketComparisonCatalogState)
    .values({ workspaceId })
    .onConflictDoNothing({ target: marketComparisonCatalogState.workspaceId });

  const [claimed] = await tx
    .update(marketComparisonCatalogState)
    .set({
      refreshOperationId: input.operationId,
      refreshClaimedBy: input.claimedBy,
      refreshClaimedAt: input.claimedAt,
      refreshLeaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.claimedAt,
    })
    .where(
      and(
        inWorkspace(marketComparisonCatalogState, workspaceId),
        or(
          isNull(marketComparisonCatalogState.refreshLeaseExpiresAt),
          lt(
            marketComparisonCatalogState.refreshLeaseExpiresAt,
            input.claimedAt,
          ),
          eq(
            marketComparisonCatalogState.refreshOperationId,
            input.operationId,
          ),
        ),
      ),
    )
    .returning();
  return claimed ?? null;
}

export async function publishMarketComparisonCatalogBatch(
  tx: Transaction,
  workspaceId: string,
  input: {
    operationId: string;
    batchId: string;
    rows: readonly CatalogRow[];
    publishedAt: Date;
    cleanupLimit: number;
  },
) {
  if (input.rows.length === 0) {
    throw new Error("market catalog refresh returned no rows");
  }
  await tx.insert(marketComparisonCatalog).values(
    input.rows.map((row) => ({
      ...row,
      workspaceId,
      batchId: input.batchId,
    })),
  );

  const [published] = await tx
    .update(marketComparisonCatalogState)
    .set({
      currentBatchId: input.batchId,
      refreshOperationId: null,
      refreshClaimedBy: null,
      refreshClaimedAt: null,
      refreshLeaseExpiresAt: null,
      lastSuccessAt: input.publishedAt,
      lastFailureAt: null,
      lastFailureCode: null,
      updatedAt: input.publishedAt,
      version: sql`${marketComparisonCatalogState.version} + 1`,
    })
    .where(
      and(
        inWorkspace(marketComparisonCatalogState, workspaceId),
        eq(marketComparisonCatalogState.refreshOperationId, input.operationId),
      ),
    )
    .returning();
  if (!published) throw new Error("market catalog refresh lost ownership");

  const stale = await tx
    .select({ id: marketComparisonCatalog.id })
    .from(marketComparisonCatalog)
    .where(
      and(
        inWorkspace(marketComparisonCatalog, workspaceId),
        ne(marketComparisonCatalog.batchId, input.batchId),
      ),
    )
    .orderBy(asc(marketComparisonCatalog.id))
    .limit(input.cleanupLimit);
  if (stale.length > 0) {
    await tx.delete(marketComparisonCatalog).where(
      and(
        inWorkspace(marketComparisonCatalog, workspaceId),
        inArray(
          marketComparisonCatalog.id,
          stale.map((row) => row.id),
        ),
      ),
    );
  }
  return published;
}

export async function recordMarketComparisonCatalogFailure(
  tx: Transaction,
  workspaceId: string,
  input: { operationId: string; failedAt: Date; failureCode: ErrorCode },
) {
  const [failed] = await tx
    .update(marketComparisonCatalogState)
    .set({
      refreshOperationId: null,
      refreshClaimedBy: null,
      refreshClaimedAt: null,
      refreshLeaseExpiresAt: null,
      lastFailureAt: input.failedAt,
      lastFailureCode: input.failureCode,
      updatedAt: input.failedAt,
    })
    .where(
      and(
        inWorkspace(marketComparisonCatalogState, workspaceId),
        eq(marketComparisonCatalogState.refreshOperationId, input.operationId),
      ),
    )
    .returning();
  return failed ?? null;
}
