import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  DURABLE_EVENT_SCHEMA_VERSION,
  OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { asc, eq, inArray } from "drizzle-orm";

import { createDb } from "../index";
import {
  claimMarketComparisonCatalogRefresh,
  ensureMarketComparisonCatalogRefresh,
  MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS,
  publishMarketComparisonCatalogBatch,
  recordMarketComparisonCatalogFailure,
} from "../repositories/market-comparison-catalog";
import { user } from "../schema/auth";
import {
  marketComparisonCatalog,
  marketComparisonCatalogState,
} from "../schema/market-analysis";
import { operation } from "../schema/operation";
import { outboxEvent } from "../schema/outbox-event";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 2 });
const rollback = new Error("EXPECTED_MARKET_CATALOG_BOOTSTRAP_ROLLBACK");
const workspaceId = randomUUID();
const now = new Date("2026-09-01T12:01:00.000Z");

try {
  const [operator] = await database.db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt), asc(user.id))
    .limit(1);
  if (!operator) throw new Error("MARKET_CATALOG_PROBE_OPERATOR_REQUIRED");

  await assert.rejects(
    database.db.transaction(async (tx) => {
      await tx.insert(workspace).values({
        id: workspaceId,
        name: `Market catalog probe ${workspaceId}`,
      });

      const created = await ensureMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        now,
      );
      assert.equal(created.status, "created");
      if (created.status !== "created") throw new Error("CREATE_EXPECTED");

      const active = await ensureMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        now,
      );
      assert.deepEqual(active, {
        operationId: created.operationId,
        status: "active",
      });

      const [createdOperation] = await tx
        .select()
        .from(operation)
        .where(eq(operation.id, created.operationId));
      const [createdOutbox] = await tx
        .select()
        .from(outboxEvent)
        .where(eq(outboxEvent.operationId, created.operationId));
      assert.equal(createdOperation?.actor, operator.id);
      assert.equal(
        createdOutbox?.eventType,
        OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
      );
      assert.equal(createdOutbox?.schemaVersion, DURABLE_EVENT_SCHEMA_VERSION);
      assert.deepEqual(createdOutbox?.payload, {
        operationId: created.operationId,
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        workspaceId,
      });

      const batchId = randomUUID();
      await tx.insert(marketComparisonCatalog).values({
        workspaceId,
        batchId,
        provider: "binance",
        canonicalIdentity: "binance:BTCUSDT",
        symbol: "BTCUSDT",
        displayName: "BTC/USDT",
        baseAsset: "BTC",
        quoteAsset: "USDT",
        tradingStatus: "TRADING",
      });
      await tx
        .update(operation)
        .set({ lifecycle: "succeeded" })
        .where(eq(operation.id, created.operationId));
      await tx
        .update(marketComparisonCatalogState)
        .set({ currentBatchId: batchId, lastSuccessAt: now })
        .where(eq(marketComparisonCatalogState.workspaceId, workspaceId));

      const fresh = await ensureMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        now,
      );
      assert.equal(fresh.status, "fresh");

      await tx
        .update(marketComparisonCatalogState)
        .set({ lastSuccessAt: new Date("2026-09-01T00:00:00.000Z") })
        .where(eq(marketComparisonCatalogState.workspaceId, workspaceId));
      const sameBucket = await ensureMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        now,
      );
      assert.equal(sameBucket.status, "retry_bucket_complete");

      const nextBucket = new Date(
        (Math.floor(now.getTime() / MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS) +
          1) *
          MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS,
      );
      const refreshed = await ensureMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        nextBucket,
      );
      assert.equal(refreshed.status, "created");
      if (refreshed.status !== "created") throw new Error("REFRESH_EXPECTED");

      const claimed = await claimMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        {
          operationId: refreshed.operationId,
          claimedBy: "probe",
          claimedAt: nextBucket,
          leaseExpiresAt: new Date(nextBucket.getTime() + 60_000),
        },
      );
      assert.ok(claimed);
      await assert.rejects(
        publishMarketComparisonCatalogBatch(tx, workspaceId, {
          operationId: refreshed.operationId,
          batchId: randomUUID(),
          rows: [],
          publishedAt: nextBucket,
          cleanupLimit: 10,
        }),
        /returned no rows/,
      );
      await recordMarketComparisonCatalogFailure(tx, workspaceId, {
        operationId: refreshed.operationId,
        failedAt: nextBucket,
        failureCode: "MARKET_SERIES_UNAVAILABLE",
      });
      await tx
        .update(operation)
        .set({ lifecycle: "failed" })
        .where(eq(operation.id, refreshed.operationId));

      const [state] = await tx
        .select()
        .from(marketComparisonCatalogState)
        .where(eq(marketComparisonCatalogState.workspaceId, workspaceId));
      assert.equal(state?.currentBatchId, batchId);
      assert.equal(state?.lastFailureCode, "MARKET_SERIES_UNAVAILABLE");
      const retryCooldown = await ensureMarketComparisonCatalogRefresh(
        tx,
        workspaceId,
        new Date(nextBucket.getTime() + 60_000),
      );
      assert.equal(retryCooldown.status, "retry_bucket_complete");
      if (retryCooldown.status !== "retry_bucket_complete") {
        throw new Error("RETRY_COOLDOWN_EXPECTED");
      }
      assert.equal(
        retryCooldown.nextEligibleAt.toISOString(),
        new Date(
          nextBucket.getTime() + MARKET_COMPARISON_CATALOG_RETRY_BUCKET_MS,
        ).toISOString(),
      );

      const operations = await tx
        .select({ id: operation.id })
        .from(operation)
        .where(eq(operation.workspaceId, workspaceId))
        .orderBy(asc(operation.createdAt));
      const outbox = await tx
        .select({ operationId: outboxEvent.operationId })
        .from(outboxEvent)
        .where(
          inArray(
            outboxEvent.operationId,
            operations.map((row) => row.id),
          ),
        );
      assert.equal(operations.length, 2);
      assert.equal(outbox.length, 2);

      throw rollback;
    }),
    rollback,
  );
  console.log(
    "market catalog bootstrap probe: atomic enqueue, single-flight, freshness, retry bucket, non-empty publication, stale-batch preservation",
  );
} finally {
  await database.close();
}
