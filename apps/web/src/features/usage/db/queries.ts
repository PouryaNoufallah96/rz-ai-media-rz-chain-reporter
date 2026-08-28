import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  lt,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
} from "@/features/shared/lib/keyset-cursor";

import { USAGE_PAGE_SIZE, type USAGE_PROVIDERS } from "../constants";
import {
  type UsageCursor,
  type UsagePage,
  type UsageQuery,
  type UsageRow,
  type UsageSummary,
  usageCursorSchema,
} from "../schemas/usage";

type UsageProvider = (typeof USAGE_PROVIDERS)[number];

const providerExpression = sql<UsageProvider>`case
  when ${aiUsageEvent.backend} = 'local' then 'ollama'
  when ${aiUsageEvent.generationId} is null
    and ${aiUsageEvent.providerRequestId} is null
    and ${aiUsageEvent.resolvedModel} is null
    and ${aiUsageEvent.totalTokens} is null
    and ${aiUsageEvent.openrouterCost} is null then 'unknown'
  else ${aiUsageEvent.providerGateway}::text
end`;

export async function readUsageSummary(
  executor: Executor,
  workspaceId: string,
  userId: string,
  query: UsageQuery,
): Promise<UsageSummary> {
  const where = and(...usageConditions(workspaceId, userId, query));
  const [aggregateRows, modelRows, recordedRows] = await Promise.all([
    executor
      .select({
        invocations: count(),
        totalTokens: sql<number>`coalesce(sum(${aiUsageEvent.totalTokens}), 0)::double precision`,
        recordedCost: sql<string>`coalesce(sum(${aiUsageEvent.openrouterCost}), 0)::text`,
        pendingCount: sql<number>`count(*) filter (where ${aiUsageEvent.status} = 'pending')::integer`,
        unknownCount: sql<number>`count(*) filter (where ${aiUsageEvent.status} <> 'pending' and ${aiUsageEvent.costAuthority} = 'unknown' and ${aiUsageEvent.openrouterCost} is null)::integer`,
      })
      .from(aiUsageEvent)
      .innerJoin(operation, usageOperationJoin(workspaceId, userId))
      .where(where),
    executor
      .select({
        model: sql<string>`coalesce(${aiUsageEvent.resolvedModel}, ${aiUsageEvent.requestedModel})`,
        backend: aiUsageEvent.backend,
        invocations: count(),
        totalTokens: sql<number>`coalesce(sum(${aiUsageEvent.totalTokens}), 0)::double precision`,
        recordedCost: sql<string>`coalesce(sum(${aiUsageEvent.openrouterCost}), 0)::text`,
      })
      .from(aiUsageEvent)
      .innerJoin(operation, usageOperationJoin(workspaceId, userId))
      .where(where)
      .groupBy(
        sql`coalesce(${aiUsageEvent.resolvedModel}, ${aiUsageEvent.requestedModel})`,
        aiUsageEvent.backend,
      )
      .orderBy(desc(count())),
    executor
      .select({ invocations: count() })
      .from(aiUsageEvent)
      .innerJoin(operation, usageOperationJoin(workspaceId, userId))
      .where(and(...usageConditions(workspaceId, userId))),
  ]);

  const aggregate = aggregateRows[0];
  if (!aggregate) throw new Error("usage summary returned no aggregate row");

  return {
    ...aggregate,
    recordedInvocations: recordedRows[0]?.invocations ?? 0,
    totalTokens: Math.trunc(aggregate.totalTokens),
    models: modelRows.map((row) => ({
      ...row,
      totalTokens: Math.trunc(row.totalTokens),
    })),
  };
}

export async function readUsagePage(
  executor: Executor,
  workspaceId: string,
  userId: string,
  query: UsageQuery,
): Promise<UsagePage> {
  const cursor = decodeKeysetCursor(usageCursorSchema, query.cursor);
  const direction = cursor?.direction ?? "older";
  const cursorCondition = cursor
    ? direction === "older"
      ? or(
          sql`${aiUsageEvent.occurredAt} < ${cursor.occurredAt}::timestamptz`,
          and(
            sql`${aiUsageEvent.occurredAt} = ${cursor.occurredAt}::timestamptz`,
            lt(aiUsageEvent.id, cursor.id),
          ),
        )
      : or(
          sql`${aiUsageEvent.occurredAt} > ${cursor.occurredAt}::timestamptz`,
          and(
            sql`${aiUsageEvent.occurredAt} = ${cursor.occurredAt}::timestamptz`,
            gt(aiUsageEvent.id, cursor.id),
          ),
        )
    : undefined;

  const rawRows = await executor
    .select({
      id: aiUsageEvent.id,
      occurredAt: aiUsageEvent.occurredAt,
      cursorOccurredAt: sql<string>`to_char(${aiUsageEvent.occurredAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      taskKey: aiUsageEvent.taskKey,
      invocationKey: aiUsageEvent.invocationKey,
      backend: aiUsageEvent.backend,
      provider: providerExpression,
      requestedModel: aiUsageEvent.requestedModel,
      resolvedModel: aiUsageEvent.resolvedModel,
      promptTokens: aiUsageEvent.promptTokens,
      completionTokens: aiUsageEvent.completionTokens,
      totalTokens: aiUsageEvent.totalTokens,
      cost: aiUsageEvent.openrouterCost,
      costAuthority: aiUsageEvent.costAuthority,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .innerJoin(operation, usageOperationJoin(workspaceId, userId))
    .where(and(...usageConditions(workspaceId, userId, query), cursorCondition))
    .orderBy(
      direction === "older"
        ? desc(aiUsageEvent.occurredAt)
        : asc(aiUsageEvent.occurredAt),
      direction === "older" ? desc(aiUsageEvent.id) : asc(aiUsageEvent.id),
    )
    .limit(USAGE_PAGE_SIZE + 1);

  const hasExtra = rawRows.length > USAGE_PAGE_SIZE;
  const bounded = rawRows.slice(0, USAGE_PAGE_SIZE);
  const rowsWithCursor = direction === "newer" ? bounded.toReversed() : bounded;
  const rows: UsageRow[] = rowsWithCursor.map(
    ({ cursorOccurredAt: _cursorOccurredAt, ...row }) => row,
  );
  const first = rowsWithCursor[0];
  const last = rowsWithCursor.at(-1);
  const offLatest = cursor !== null;

  return {
    rows,
    olderCursor:
      last && (direction === "newer" || hasExtra)
        ? encodeKeysetCursor({
            direction: "older",
            occurredAt: last.cursorOccurredAt,
            id: last.id,
          } satisfies UsageCursor)
        : null,
    newerCursor:
      first && offLatest && (direction === "older" || hasExtra)
        ? encodeKeysetCursor({
            direction: "newer",
            occurredAt: first.cursorOccurredAt,
            id: first.id,
          } satisfies UsageCursor)
        : null,
    offLatest,
  };
}

function usageOperationJoin(workspaceId: string, userId: string) {
  return and(
    inWorkspace(operation, workspaceId),
    eq(operation.id, aiUsageEvent.operationId),
    eq(operation.actor, userId),
  );
}

function usageConditions(
  workspaceId: string,
  userId: string,
  query?: UsageQuery,
): SQL[] {
  const conditions: SQL[] = [
    inWorkspace(aiUsageEvent, workspaceId),
    eq(operation.actor, userId),
  ];
  if (!query) return conditions;
  const since = periodStart(query.period);

  if (since) conditions.push(gte(aiUsageEvent.occurredAt, since));
  if (query.model) {
    const modelCondition = or(
      eq(aiUsageEvent.requestedModel, query.model),
      eq(aiUsageEvent.resolvedModel, query.model),
    );
    if (modelCondition) conditions.push(modelCondition);
  }
  if (query.backend) conditions.push(eq(aiUsageEvent.backend, query.backend));
  if (query.provider) {
    conditions.push(sql`${providerExpression} = ${query.provider}`);
  }
  if (query.task) conditions.push(eq(aiUsageEvent.taskKey, query.task));
  if (query.status) conditions.push(eq(aiUsageEvent.status, query.status));

  return conditions;
}

function periodStart(period: UsageQuery["period"]) {
  const durations: Partial<Record<UsageQuery["period"], number>> = {
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  const duration = durations[period];
  return duration === undefined ? null : new Date(Date.now() - duration);
}
