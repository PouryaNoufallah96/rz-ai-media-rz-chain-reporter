import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { sourceImportProgress } from "@rz-chain-reporter/db/repositories/source-import";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceImport } from "@rz-chain-reporter/db/schema/source-import";
import { sourceImportItem } from "@rz-chain-reporter/db/schema/source-import-item";
import { sourceImportSource } from "@rz-chain-reporter/db/schema/source-import-source";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemEnrichment } from "@rz-chain-reporter/db/schema/source-item-enrichment";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import {
  and,
  asc,
  desc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";

import {
  decodeKeysetCursor,
  encodeKeysetCursor,
} from "@/features/shared/lib/keyset-cursor";

import {
  RECENT_IMPORT_LIMIT,
  RECENT_TOPIC_LIMIT,
  SOURCE_ITEM_PAGE_SIZE,
} from "../constants";
import type { SourceCatalogEntry } from "../schemas/catalog";
import type {
  SourceImportCard,
  SourceImportSourceLine,
} from "../schemas/imports";
import {
  type SourceItemPage,
  type SourceItemRow,
  type StreamCursor,
  type StreamQuery,
  sourceItemBriefSchema,
  streamCursorSchema,
} from "../schemas/stream";

export async function readSourceCatalog(
  executor: Executor,
  workspaceId: string,
): Promise<{ entries: SourceCatalogEntry[]; lastImportAt: Date | null }> {
  const [sources, observations, lastImport] = await Promise.all([
    executor
      .select({
        id: source.id,
        key: source.key,
        name: source.name,
        origin: source.origin,
        endpoint: source.endpoint,
        contentLocale: source.contentLocale,
        enabled: source.enabled,
        deletedAt: source.deletedAt,
      })
      .from(source)
      .where(inWorkspace(source, workspaceId))
      .orderBy(asc(source.origin), asc(source.name)),
    executor
      .selectDistinctOn([sourceImportSource.sourceId], {
        sourceId: sourceImportSource.sourceId,
        outcome: sourceImportSource.outcome,
        reason: sourceImportSource.reason,
        fetchedCount: sourceImportSource.fetchedCount,
        admittedCount: sourceImportSource.admittedCount,
        observedAt: sourceImportSource.updatedAt,
        hasValidators: sql<boolean>`(${sourceImportSource.etag} is not null or ${sourceImportSource.lastModified} is not null)`,
        importRunning: sql<boolean>`${sourceImport.stage} <> 'settled'`,
      })
      .from(sourceImportSource)
      .innerJoin(
        sourceImport,
        eq(sourceImport.id, sourceImportSource.sourceImportId),
      )
      .where(
        and(
          inWorkspace(sourceImportSource, workspaceId),
          ne(sourceImportSource.outcome, "pending"),
        ),
      )
      .orderBy(
        asc(sourceImportSource.sourceId),
        sql`${sourceImportSource.startedAt} desc nulls last`,
        desc(sourceImportSource.updatedAt),
      ),
    executor
      .select({ createdAt: sourceImport.createdAt })
      .from(sourceImport)
      .where(inWorkspace(sourceImport, workspaceId))
      .orderBy(desc(sourceImport.createdAt))
      .limit(1),
  ]);

  const observationBySource = new Map(
    observations.map(({ sourceId, ...observation }) => [sourceId, observation]),
  );

  return {
    entries: sources.map(({ deletedAt, enabled, ...entry }) => ({
      ...entry,
      lifecycle: deletedAt ? "retired" : enabled ? "enabled" : "disabled",
      observation: observationBySource.get(entry.id) ?? null,
    })),
    lastImportAt: lastImport[0]?.createdAt ?? null,
  };
}

export async function selectImportableSourceIds(
  executor: Executor,
  workspaceId: string,
  sourceIds: readonly string[],
): Promise<string[]> {
  const rows = await executor
    .select({ id: source.id })
    .from(source)
    .where(
      and(
        inWorkspace(source, workspaceId),
        inArray(source.id, [...sourceIds]),
        eq(source.enabled, true),
        isNull(source.deletedAt),
      ),
    );

  return rows.map((row) => row.id);
}

export async function readRecentSourceImports(
  executor: Executor,
  workspaceId: string,
): Promise<{ cards: SourceImportCard[]; recentTopics: string[] }> {
  const [imports, recentTopics] = await Promise.all([
    executor
      .select({
        id: sourceImport.id,
        operationId: sourceImport.operationId,
        createdAt: sourceImport.createdAt,
        failureCode: sourceImport.failureCode,
        windowHours: sourceImport.windowHours,
        orderingMode: sourceImport.orderingMode,
        topN: sourceImport.topN,
        topics: sourceImport.topics,
        enrichmentEnabled: sourceImport.enrichmentEnabled,
        templateFingerprint: sourceImport.templateFingerprint,
        embeddingAttemptId: sourceImport.embeddingAttemptId,
        embeddingDimension: sourceImport.embeddingDimension,
        lifecycle: operation.lifecycle,
      })
      .from(sourceImport)
      .innerJoin(operation, eq(operation.id, sourceImport.operationId))
      .where(inWorkspace(sourceImport, workspaceId))
      .orderBy(desc(sourceImport.createdAt), desc(sourceImport.id))
      .limit(RECENT_IMPORT_LIMIT),
    readRecentTopics(executor, workspaceId),
  ]);

  if (imports.length === 0) {
    return { cards: [], recentTopics };
  }

  const importIds = imports.map((row) => row.id);
  const operationIds = imports.map((row) => row.operationId);
  const attemptIds = imports
    .map((row) => row.embeddingAttemptId)
    .filter((id) => id !== null);

  const [lines, progress, dispatches, embeddings] = await Promise.all([
    executor
      .select({
        sourceImportId: sourceImportSource.sourceImportId,
        sourceId: sourceImportSource.sourceId,
        name: source.name,
        outcome: sourceImportSource.outcome,
        reason: sourceImportSource.reason,
        fetchedCount: sourceImportSource.fetchedCount,
        admittedCount: sourceImportSource.admittedCount,
        settledAt: sourceImportSource.updatedAt,
      })
      .from(sourceImportSource)
      .innerJoin(source, eq(source.id, sourceImportSource.sourceId))
      .where(
        and(
          inWorkspace(sourceImportSource, workspaceId),
          inArray(sourceImportSource.sourceImportId, importIds),
        ),
      )
      .orderBy(asc(source.name)),
    sourceImportProgress(executor, workspaceId, importIds),
    executor
      .selectDistinctOn([outboxEvent.operationId], {
        operationId: outboxEvent.operationId,
        dispatchAttemptCount: outboxEvent.dispatchAttemptCount,
        dispatchedAt: outboxEvent.dispatchedAt,
        exhaustedAt: outboxEvent.exhaustedAt,
        nextAttemptAt: outboxEvent.nextAttemptAt,
      })
      .from(outboxEvent)
      .where(
        and(
          inWorkspace(outboxEvent, workspaceId),
          inArray(outboxEvent.operationId, operationIds),
        ),
      )
      .orderBy(asc(outboxEvent.operationId), asc(outboxEvent.createdAt)),
    executor
      .select({
        operationAttemptId: aiUsageEvent.operationAttemptId,
        model: sql<string>`coalesce(${aiUsageEvent.resolvedModel}, ${aiUsageEvent.requestedModel})`,
      })
      .from(aiUsageEvent)
      .where(
        and(
          inWorkspace(aiUsageEvent, workspaceId),
          inArray(aiUsageEvent.operationAttemptId, attemptIds),
        ),
      ),
  ]);

  const dispatchByOperation = new Map(
    dispatches.map((row) => [row.operationId, row]),
  );
  const linesByImport = new Map<string, SourceImportSourceLine[]>();

  for (const { sourceImportId, ...line } of lines) {
    const bucket = linesByImport.get(sourceImportId) ?? [];
    bucket.push({
      ...line,
      settledAt: line.outcome === "pending" ? null : line.settledAt,
      enrichment: null,
    });
    linesByImport.set(sourceImportId, bucket);
  }
  const modelByAttempt = new Map(
    embeddings.map((row) => [row.operationAttemptId, row.model]),
  );

  return {
    cards: imports.map((row) => {
      const measured = progress[row.id];
      const dispatch = dispatchByOperation.get(row.operationId);
      const enrichmentBySource = measured?.enrichmentBySource ?? {};

      return {
        ...row,
        stage: measured?.stage ?? "acquiring",
        partial: measured?.partial ?? false,
        counts: measured?.counts ?? {
          acquired: 0,
          ordered: 0,
          enriched: 0,
          skipped: 0,
          failed: 0,
        },
        unitsPlanned: measured?.unitsPlanned ?? 0,
        embeddingModel:
          (row.embeddingAttemptId &&
            modelByAttempt.get(row.embeddingAttemptId)) ||
          null,
        dispatch: dispatch
          ? {
              nextAttemptAt: dispatch.nextAttemptAt,
              state: dispatchStateOf(dispatch),
            }
          : null,
        sources: (linesByImport.get(row.id) ?? []).map((line) => ({
          ...line,
          enrichment: enrichmentBySource[line.sourceId] ?? null,
        })),
      };
    }),
    recentTopics,
  };
}

// Newest authored spelling wins; chips stay newest-first.
async function readRecentTopics(executor: Executor, workspaceId: string) {
  const result = await executor.execute<{ topic: string }>(sql`
    select folded.topic
    from (
      select distinct on (fold_unique_name_v1(topic)) topic, imports.created_at
      from ${sourceImport} as imports, unnest(imports.topics) as topic
      where imports.workspace_id = ${workspaceId}
      order by fold_unique_name_v1(topic), imports.created_at desc
    ) as folded
    order by folded.created_at desc
    limit ${RECENT_TOPIC_LIMIT}
  `);

  return result.rows.map((row) => row.topic);
}

function dispatchStateOf(outbox: {
  dispatchAttemptCount: number;
  dispatchedAt: Date | null;
  exhaustedAt: Date | null;
}) {
  if (outbox.exhaustedAt) return "exhausted" as const;
  if (outbox.dispatchedAt) return "dispatched" as const;
  return outbox.dispatchAttemptCount > 0
    ? ("delayed" as const)
    : ("undispatched" as const);
}

export async function readSourceItemFilters(
  executor: Executor,
  workspaceId: string,
) {
  const [sourceOptions, importOptions, itemCount] = await Promise.all([
    executor
      .select({ id: source.id, name: source.name })
      .from(source)
      .where(and(inWorkspace(source, workspaceId), isNull(source.deletedAt)))
      .orderBy(asc(source.name)),
    executor
      .select({ id: sourceImport.id, createdAt: sourceImport.createdAt })
      .from(sourceImport)
      .where(inWorkspace(sourceImport, workspaceId))
      .orderBy(desc(sourceImport.createdAt))
      .limit(RECENT_IMPORT_LIMIT),
    executor.$count(
      sourceItem,
      and(
        inWorkspace(sourceItem, workspaceId),
        hasRevision(executor, workspaceId),
      ),
    ),
  ]);

  return { sourceOptions, importOptions, hasAnyItem: itemCount > 0 };
}

export async function readSourceItemPage(
  executor: Executor,
  workspaceId: string,
  query: StreamQuery,
): Promise<SourceItemPage> {
  const cursor = decodeKeysetCursor(streamCursorSchema, query.cursor);
  const direction = cursor?.direction ?? "older";
  const cursorCondition = cursor
    ? direction === "older"
      ? or(
          sql`${sourceItem.createdAt} < ${cursor.createdAt}::timestamptz`,
          and(
            sql`${sourceItem.createdAt} = ${cursor.createdAt}::timestamptz`,
            lt(sourceItem.id, cursor.id),
          ),
        )
      : or(
          sql`${sourceItem.createdAt} > ${cursor.createdAt}::timestamptz`,
          and(
            sql`${sourceItem.createdAt} = ${cursor.createdAt}::timestamptz`,
            gt(sourceItem.id, cursor.id),
          ),
        )
    : undefined;

  const rawRows = await executor
    .select({
      id: sourceItem.id,
      createdAt: sourceItem.createdAt,
      cursorCreatedAt: sql<string>`to_char(${sourceItem.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      sourceId: sourceItem.sourceId,
      sourceName: source.name,
    })
    .from(sourceItem)
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(...streamConditions(executor, workspaceId, query), cursorCondition),
    )
    .orderBy(
      direction === "older"
        ? desc(sourceItem.createdAt)
        : asc(sourceItem.createdAt),
      direction === "older" ? desc(sourceItem.id) : asc(sourceItem.id),
    )
    .limit(SOURCE_ITEM_PAGE_SIZE + 1);

  const hasExtra = rawRows.length > SOURCE_ITEM_PAGE_SIZE;
  const bounded = rawRows.slice(0, SOURCE_ITEM_PAGE_SIZE);
  const ordered = direction === "newer" ? bounded.toReversed() : bounded;
  const first = ordered[0];
  const last = ordered.at(-1);
  const offLatest = cursor !== null;

  return {
    rows: await hydrateRows(executor, workspaceId, query, ordered),
    olderCursor:
      last && (direction === "newer" || hasExtra)
        ? encodeKeysetCursor({
            direction: "older",
            createdAt: last.cursorCreatedAt,
            id: last.id,
          } satisfies StreamCursor)
        : null,
    newerCursor:
      first && offLatest && (direction === "older" || hasExtra)
        ? encodeKeysetCursor({
            direction: "newer",
            createdAt: first.cursorCreatedAt,
            id: first.id,
          } satisfies StreamCursor)
        : null,
    offLatest,
  };
}

function streamConditions(
  executor: Executor,
  workspaceId: string,
  query: StreamQuery,
): SQL[] {
  const conditions: SQL[] = [
    inWorkspace(sourceItem, workspaceId),
    hasRevision(executor, workspaceId),
  ];

  if (query.source) conditions.push(eq(sourceItem.sourceId, query.source));

  if (query.import || query.admission) {
    conditions.push(
      exists(
        executor
          .select({ matched: sql`1` })
          .from(sourceImportItem)
          .where(
            and(
              inWorkspace(sourceImportItem, workspaceId),
              eq(sourceImportItem.sourceItemId, sourceItem.id),
              query.import
                ? eq(sourceImportItem.sourceImportId, query.import)
                : undefined,
              query.admission
                ? eq(sourceImportItem.admission, query.admission)
                : undefined,
            ),
          ),
      ),
    );
  }

  return conditions;
}

// Display reads the content revision, never source_item's frozen first-seen snapshot.
function hasRevision(executor: Executor, workspaceId: string) {
  return exists(
    executor
      .select({ matched: sql`1` })
      .from(sourceItemRevision)
      .where(
        and(
          inWorkspace(sourceItemRevision, workspaceId),
          eq(sourceItemRevision.sourceItemId, sourceItem.id),
        ),
      ),
  );
}

type StreamBaseRow = {
  id: string;
  createdAt: Date;
  sourceId: string;
  sourceName: string;
};

async function hydrateRows(
  executor: Executor,
  workspaceId: string,
  query: StreamQuery,
  rows: StreamBaseRow[],
): Promise<SourceItemRow[]> {
  if (rows.length === 0) return [];

  const itemIds = rows.map((row) => row.id);
  const [revisions, occurrences] = await Promise.all([
    executor
      .select({
        sourceItemId: sourceItemRevision.sourceItemId,
        revisionNumber: sourceItemRevision.revisionNumber,
        title: sourceItemRevision.title,
        canonicalUrl: sourceItemRevision.canonicalUrl,
        contentLocale: sourceItemRevision.contentLocale,
        contentHash: sourceItemRevision.contentHash,
      })
      .from(sourceItemRevision)
      .where(
        and(
          inWorkspace(sourceItemRevision, workspaceId),
          inArray(sourceItemRevision.sourceItemId, itemIds),
        ),
      ),
    executor
      .selectDistinctOn([sourceImportItem.sourceItemId], {
        sourceItemId: sourceImportItem.sourceItemId,
        admission: sourceImportItem.admission,
        rank: sourceImportItem.rank,
        keywordScore: sourceImportItem.keywordScore,
        enrichment: sourceImportItem.enrichmentOutcome,
        enrichmentReason: sourceImportItem.enrichmentReason,
        adapter: sourceItemEnrichment.adapter,
        fallbackReason: sourceItemEnrichment.fallbackReason,
        brief: sourceItemEnrichment.brief,
      })
      .from(sourceImportItem)
      .leftJoin(
        sourceItemEnrichment,
        eq(sourceItemEnrichment.id, sourceImportItem.enrichmentId),
      )
      .where(
        and(
          inWorkspace(sourceImportItem, workspaceId),
          inArray(sourceImportItem.sourceItemId, itemIds),
          query.import
            ? eq(sourceImportItem.sourceImportId, query.import)
            : undefined,
        ),
      )
      .orderBy(
        asc(sourceImportItem.sourceItemId),
        desc(sourceImportItem.createdAt),
      ),
  ]);

  const occurrenceByItem = new Map(
    occurrences.map(({ sourceItemId, ...occurrence }) => [
      sourceItemId,
      occurrence,
    ]),
  );

  return rows.map((row) => {
    const history = revisions.filter(
      (revision) => revision.sourceItemId === row.id,
    );
    const current = history.reduce<(typeof history)[number] | undefined>(
      (newest, revision) =>
        newest && newest.revisionNumber >= revision.revisionNumber
          ? newest
          : revision,
      undefined,
    );

    if (!current) {
      throw new Error("source item resolved no revision");
    }

    const occurrence = occurrenceByItem.get(row.id);

    return {
      id: row.id,
      createdAt: row.createdAt,
      sourceId: row.sourceId,
      sourceName: row.sourceName,
      title: current.title,
      canonicalUrl: current.canonicalUrl,
      contentLocale: current.contentLocale,
      contentHash: current.contentHash,
      revisionCount: history.length,
      admission: occurrence?.admission ?? null,
      rank: occurrence?.rank ?? null,
      keywordScore: occurrence?.keywordScore ?? null,
      enrichment: occurrence?.enrichment ?? null,
      enrichmentReason: occurrence?.enrichmentReason ?? null,
      adapter: occurrence?.adapter ?? null,
      fallbackReason: occurrence?.fallbackReason ?? null,
      brief: briefParagraphs(occurrence?.brief),
    };
  });
}

function briefParagraphs(brief: unknown) {
  const parsed = sourceItemBriefSchema.safeParse(brief);

  return parsed.success ? [parsed.data.summary] : null;
}
