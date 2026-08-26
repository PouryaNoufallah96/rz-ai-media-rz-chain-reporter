import {
  type AdmissionOutcome,
  type ArticleAdapter,
  type ContentLocale,
  DURABLE_EVENT_SCHEMA_VERSION,
  type EnrichmentOutcome,
  type EnrichmentReason,
  type ErrorCode,
  type InvocationKey,
  OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
  SOURCE_IMPORT_COMMAND_PREFIX,
  type SourceFetchOutcome,
  type SourceFetchReason,
  type SourceImportStage,
  type SourceOrigin,
  type TelegramOrderingMode,
  type UsageStatus,
} from "@rz-chain-reporter/contracts";
import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  like,
  max,
  ne,
  or,
  sql,
} from "drizzle-orm";

import type { Executor } from "../executor";
import { withWorkspaceContext } from "../executor";
import { inWorkspace } from "../filters";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { operationAttempt } from "../schema/operation-attempt";
import { source } from "../schema/source";
import { sourceImport } from "../schema/source-import";
import { sourceImportItem } from "../schema/source-import-item";
import { sourceImportSource } from "../schema/source-import-source";
import { sourceItem } from "../schema/source-item";
import { sourceItemEnrichment } from "../schema/source-item-enrichment";
import { sourceItemRevision } from "../schema/source-item-revision";
import { matchesAppliedCustomerTemplate } from "./customer-template-identity";
import { createOperation } from "./operation";

export const SOURCE_IMPORT_COMMAND_TYPE = `${SOURCE_IMPORT_COMMAND_PREFIX}start`;

export type StartSourceImportInput = {
  operationId: string;
  actor: string;
  idempotencyKey: string;
  requestHash: string;
  requestId: string | null;
  sourceIds: readonly string[];
  windowHours: number;
  orderingMode: TelegramOrderingMode;
  topN: number;
  topics: readonly string[];
  enrichmentEnabled: boolean;
  templateFingerprint: string;
};

export type StartSourceImportResult =
  | { status: "created"; operationId: string; sourceImportId: string }
  | { status: "replayed"; operationId: string }
  | { status: "mismatch" }
  | { status: "template_drift" }
  | { status: "empty_selection" };

// 23505 on uq_source_import_workspace_id_unsettled maps to SOURCE_IMPORT_IN_PROGRESS.
export async function startSourceImport(
  executor: Executor,
  workspaceId: string,
  input: StartSourceImportInput,
): Promise<StartSourceImportResult> {
  if (input.sourceIds.length === 0) {
    return { status: "empty_selection" };
  }

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);

    if (
      !(await matchesAppliedCustomerTemplate(
        tx,
        workspaceId,
        input.templateFingerprint,
      ))
    ) {
      return { status: "template_drift" };
    }

    const operation = await createOperation(tx, workspaceId, {
      operationId: input.operationId,
      actor: input.actor,
      commandType: SOURCE_IMPORT_COMMAND_TYPE,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      requestId: input.requestId,
      event: {
        type: OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
        schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
        payload: {
          schemaVersion: DURABLE_EVENT_SCHEMA_VERSION,
          workspaceId,
          operationId: input.operationId,
        },
      },
    });

    if (operation.status === "mismatch") {
      return { status: "mismatch" };
    }

    if (operation.status === "replayed") {
      return { status: "replayed", operationId: operation.operation.id };
    }

    const [created] = await tx
      .insert(sourceImport)
      .values({
        workspaceId,
        operationId: operation.operation.id,
        stage: "acquiring",
        windowHours: input.windowHours,
        orderingMode: input.orderingMode,
        topN: input.topN,
        topics: normalizeTopics(input.topics),
        enrichmentEnabled: input.enrichmentEnabled,
        templateFingerprint: input.templateFingerprint,
      })
      .returning({ id: sourceImport.id });

    if (!created) {
      throw new Error("source import insert returned no row");
    }

    await tx.insert(sourceImportSource).values(
      input.sourceIds.map((sourceId) => ({
        workspaceId,
        sourceImportId: created.id,
        sourceId,
        outcome: "pending" as const,
      })),
    );

    return {
      status: "created",
      operationId: operation.operation.id,
      sourceImportId: created.id,
    };
  });
}

function normalizeTopics(topics: readonly string[]) {
  const normalized = new Map<string, string>();

  for (const topic of topics) {
    const trimmed = topic.trim();

    if (trimmed !== "" && !normalized.has(trimmed.toLowerCase())) {
      normalized.set(trimmed.toLowerCase(), trimmed);
    }
  }

  return [...normalized.values()];
}

export async function findSourceImportByOperationId(
  executor: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [row] = await executor
    .select({
      id: sourceImport.id,
      stage: sourceImport.stage,
      windowHours: sourceImport.windowHours,
      orderingMode: sourceImport.orderingMode,
      topN: sourceImport.topN,
      topics: sourceImport.topics,
      enrichmentEnabled: sourceImport.enrichmentEnabled,
      templateFingerprint: sourceImport.templateFingerprint,
      embeddingAttemptId: sourceImport.embeddingAttemptId,
    })
    .from(sourceImport)
    .where(
      and(
        inWorkspace(sourceImport, workspaceId),
        eq(sourceImport.operationId, operationId),
      ),
    );

  return row;
}

export type RecordSourceImportEmbeddingInput = {
  sourceImportId: string;
  embeddingAttemptId?: string;
  embeddingDimension?: number;
};

export async function recordSourceImportEmbedding(
  executor: Executor,
  workspaceId: string,
  input: RecordSourceImportEmbeddingInput,
) {
  await executor
    .update(sourceImport)
    .set({
      embeddingAttemptId: input.embeddingAttemptId,
      embeddingDimension: input.embeddingDimension,
    })
    .where(
      and(
        inWorkspace(sourceImport, workspaceId),
        eq(sourceImport.id, input.sourceImportId),
      ),
    );
}

export async function listSourceImportSources(
  executor: Executor,
  workspaceId: string,
  sourceImportId: string,
) {
  return executor
    .select({
      sourceId: sourceImportSource.sourceId,
      key: source.key,
      origin: source.origin,
      endpoint: source.endpoint,
    })
    .from(sourceImportSource)
    .innerJoin(source, eq(source.id, sourceImportSource.sourceId))
    .where(
      and(
        inWorkspace(sourceImportSource, workspaceId),
        eq(sourceImportSource.sourceImportId, sourceImportId),
        eq(sourceImportSource.outcome, "pending"),
      ),
    )
    .orderBy(asc(source.key));
}

export type SourceImportSourceUnitInput = {
  sourceImportId: string;
  sourceId: string;
};

// Newest prior row that actually carried etag/last-modified.
export async function findSourceImportSourceUnit(
  executor: Executor,
  workspaceId: string,
  input: SourceImportSourceUnitInput,
) {
  const [unit] = await executor
    .select({
      outcome: sourceImportSource.outcome,
      key: source.key,
      name: source.name,
      origin: source.origin,
      endpoint: source.endpoint,
      enabled: source.enabled,
      contentLocale: source.contentLocale,
      deletedAt: source.deletedAt,
      templateFingerprint: sourceImport.templateFingerprint,
    })
    .from(sourceImportSource)
    .innerJoin(source, eq(source.id, sourceImportSource.sourceId))
    .innerJoin(
      sourceImport,
      and(
        eq(sourceImport.id, sourceImportSource.sourceImportId),
        eq(sourceImport.workspaceId, sourceImportSource.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(sourceImportSource, workspaceId),
        eq(sourceImportSource.sourceImportId, input.sourceImportId),
        eq(sourceImportSource.sourceId, input.sourceId),
      ),
    );

  if (!unit) {
    return undefined;
  }

  const [validators] = await executor
    .select({
      etag: sourceImportSource.etag,
      lastModified: sourceImportSource.lastModified,
      sourceImportId: sourceImportSource.sourceImportId,
    })
    .from(sourceImportSource)
    .innerJoin(
      sourceImport,
      and(
        eq(sourceImport.id, sourceImportSource.sourceImportId),
        eq(sourceImport.workspaceId, sourceImportSource.workspaceId),
      ),
    )
    .where(
      and(
        inWorkspace(sourceImportSource, workspaceId),
        eq(sourceImportSource.sourceId, input.sourceId),
        eq(sourceImportSource.outcome, "succeeded"),
        ne(sourceImportSource.sourceImportId, input.sourceImportId),
        eq(sourceImport.templateFingerprint, unit.templateFingerprint),
      ),
    )
    .orderBy(desc(sourceImportSource.startedAt))
    .limit(1);

  return {
    ...unit,
    etag: validators?.etag ?? null,
    lastModified: validators?.lastModified ?? null,
    priorSourceImportId: validators?.sourceImportId ?? null,
  };
}

export type SettleSourceImportSourceInput = {
  sourceImportId: string;
  sourceId: string;
  outcome: SourceFetchOutcome;
  reason?: SourceFetchReason | null;
  etag?: string | null;
  lastModified?: string | null;
  fetchedCount?: number;
  admittedCount?: number;
  startedAt?: Date | null;
};

export async function settleSourceImportSource(
  executor: Executor,
  workspaceId: string,
  input: SettleSourceImportSourceInput,
) {
  const [settled] = await executor
    .update(sourceImportSource)
    .set({
      outcome: input.outcome,
      reason: input.reason ?? null,
      etag: input.etag ?? null,
      lastModified: input.lastModified ?? null,
      fetchedCount: input.fetchedCount ?? 0,
      admittedCount: input.admittedCount ?? 0,
      startedAt: input.startedAt ?? null,
    })
    .where(
      and(
        inWorkspace(sourceImportSource, workspaceId),
        eq(sourceImportSource.sourceImportId, input.sourceImportId),
        eq(sourceImportSource.sourceId, input.sourceId),
        eq(sourceImportSource.outcome, "pending"),
      ),
    )
    .returning({ id: sourceImportSource.id });

  return settled !== undefined;
}

export type PersistSourceImportItemInput = {
  externalId: string;
  title: string;
  summary: string | null;
  canonicalUrl: string;
  attribution: string;
  contentLocale: ContentLocale;
  contentHash: string;
  publishedAt: Date | null;
  admission: AdmissionOutcome;
  views?: number | null;
};

export type PersistSourceImportItemsInput = {
  sourceImportId: string;
  sourceId: string;
  origin: SourceOrigin;
  items: readonly PersistSourceImportItemInput[];
};

export async function persistSourceImportItems(
  executor: Executor,
  workspaceId: string,
  input: PersistSourceImportItemsInput,
) {
  if (input.items.length === 0) {
    return { admittedCount: 0, associatedCount: 0 };
  }

  return executor.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('source-import-items'), hashtext(${`${workspaceId}:${input.sourceId}`}))`,
    );

    const identities = new Map<string, PersistSourceImportItemInput>();
    for (const item of input.items) {
      if (!identities.has(item.externalId)) {
        identities.set(item.externalId, item);
      }
    }

    await tx
      .insert(sourceItem)
      .values(
        [...identities.values()].map((item) => ({
          workspaceId,
          sourceId: input.sourceId,
          origin: input.origin,
          externalId: item.externalId,
          title: item.title,
          url: item.canonicalUrl,
          attribution: item.attribution,
          contentLocale: item.contentLocale,
          publishedAt: item.publishedAt,
        })),
      )
      .onConflictDoNothing({
        target: [
          sourceItem.workspaceId,
          sourceItem.sourceId,
          sourceItem.externalId,
        ],
      });

    const storedItems = await tx
      .select({ externalId: sourceItem.externalId, id: sourceItem.id })
      .from(sourceItem)
      .where(
        and(
          inWorkspace(sourceItem, workspaceId),
          eq(sourceItem.sourceId, input.sourceId),
          inArray(sourceItem.externalId, [...identities.keys()]),
        ),
      );

    if (storedItems.length !== identities.size) {
      throw new Error(
        "source item batch upsert resolved incomplete identities",
      );
    }

    const itemByExternalId = new Map(
      storedItems.map((item) => [item.externalId, item]),
    );
    const desiredRevisions = new Map<
      string,
      PersistSourceImportItemInput & { sourceItemId: string }
    >();
    for (const item of input.items) {
      const stored = itemByExternalId.get(item.externalId);
      if (!stored) {
        throw new Error("source item batch resolved no identity");
      }
      const key = `${stored.id}:${item.contentHash}`;
      if (!desiredRevisions.has(key)) {
        desiredRevisions.set(key, { ...item, sourceItemId: stored.id });
      }
    }

    const sourceItemIds = [...new Set(storedItems.map((item) => item.id))];
    const contentHashes = [
      ...new Set(input.items.map((item) => item.contentHash)),
    ];
    const knownRevisions = await tx
      .select({
        contentHash: sourceItemRevision.contentHash,
        id: sourceItemRevision.id,
        revisionNumber: sourceItemRevision.revisionNumber,
        sourceItemId: sourceItemRevision.sourceItemId,
      })
      .from(sourceItemRevision)
      .where(
        and(
          inWorkspace(sourceItemRevision, workspaceId),
          inArray(sourceItemRevision.sourceItemId, sourceItemIds),
          inArray(sourceItemRevision.contentHash, contentHashes),
        ),
      );

    const revisionByKey = new Map(
      knownRevisions.map((revision) => [
        `${revision.sourceItemId}:${revision.contentHash}`,
        revision,
      ]),
    );
    const missing = [...desiredRevisions].filter(
      ([key]) => !revisionByKey.has(key),
    );

    if (missing.length > 0) {
      const latestRevisions = await tx
        .select({
          revisionNumber: max(sourceItemRevision.revisionNumber),
          sourceItemId: sourceItemRevision.sourceItemId,
        })
        .from(sourceItemRevision)
        .where(
          and(
            inWorkspace(sourceItemRevision, workspaceId),
            inArray(sourceItemRevision.sourceItemId, [
              ...new Set(missing.map(([, item]) => item.sourceItemId)),
            ]),
          ),
        )
        .groupBy(sourceItemRevision.sourceItemId);
      const nextRevisionByItem = new Map(
        latestRevisions.map((revision) => [
          revision.sourceItemId,
          revision.revisionNumber ?? 0,
        ]),
      );
      const appended = await tx
        .insert(sourceItemRevision)
        .values(
          missing.map(([, item]) => {
            const revisionNumber =
              (nextRevisionByItem.get(item.sourceItemId) ?? 0) + 1;
            nextRevisionByItem.set(item.sourceItemId, revisionNumber);
            return {
              workspaceId,
              sourceItemId: item.sourceItemId,
              revisionNumber,
              title: item.title,
              summary: item.summary,
              canonicalUrl: item.canonicalUrl,
              contentLocale: item.contentLocale,
              contentHash: item.contentHash,
            };
          }),
        )
        .returning({
          contentHash: sourceItemRevision.contentHash,
          id: sourceItemRevision.id,
          revisionNumber: sourceItemRevision.revisionNumber,
          sourceItemId: sourceItemRevision.sourceItemId,
        });
      for (const revision of appended) {
        revisionByKey.set(
          `${revision.sourceItemId}:${revision.contentHash}`,
          revision,
        );
      }
    }

    const associations = new Map<
      string,
      {
        admission: AdmissionOutcome;
        sourceItemId: string;
        sourceItemRevisionId: string;
        views: number | null;
      }
    >();
    for (const item of input.items) {
      const stored = itemByExternalId.get(item.externalId);
      const revision = stored
        ? revisionByKey.get(`${stored.id}:${item.contentHash}`)
        : undefined;
      if (!stored || !revision) {
        throw new Error("source item batch resolved no revision");
      }
      if (!associations.has(stored.id)) {
        associations.set(stored.id, {
          admission: item.admission,
          sourceItemId: stored.id,
          sourceItemRevisionId: revision.id,
          views: item.views ?? null,
        });
      }
    }

    await tx
      .insert(sourceImportItem)
      .values(
        [...associations.values()].map((item) => ({
          workspaceId,
          sourceImportId: input.sourceImportId,
          ...item,
        })),
      )
      .onConflictDoNothing({
        target: [
          sourceImportItem.workspaceId,
          sourceImportItem.sourceImportId,
          sourceImportItem.sourceItemId,
        ],
      });

    const [current] = await tx
      .select({
        admitted: sql<number>`count(*) filter (where ${sourceImportItem.admission} = 'admitted')::int`,
        associated: sql<number>`count(*)::int`,
      })
      .from(sourceImportItem)
      .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
      .where(
        and(
          inWorkspace(sourceImportItem, workspaceId),
          eq(sourceImportItem.sourceImportId, input.sourceImportId),
          eq(sourceItem.sourceId, input.sourceId),
        ),
      );

    return {
      admittedCount: current?.admitted ?? 0,
      associatedCount: current?.associated ?? 0,
    };
  });
}

export type ReuseSourceImportItemsInput = {
  sourceId: string;
  sourceImportId: string;
  priorSourceImportId: string;
};

export async function reuseSourceImportItems(
  executor: Executor,
  workspaceId: string,
  input: ReuseSourceImportItemsInput,
) {
  const [reusable] = await executor
    .select({ items: sql<number>`count(*)::int` })
    .from(sourceImportItem)
    .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
    .where(
      and(
        inWorkspace(sourceImportItem, workspaceId),
        eq(sourceImportItem.sourceImportId, input.priorSourceImportId),
        eq(sourceItem.sourceId, input.sourceId),
      ),
    );
  const reusableCount = reusable?.items ?? 0;
  const inserted = await executor.execute<{ id: string }>(sql`
    insert into source_import_item (
      workspace_id,
      source_import_id,
      source_item_id,
      source_item_revision_id,
      admission,
      views
    )
    select
      ${workspaceId}::uuid,
      ${input.sourceImportId}::uuid,
      prior.source_item_id,
      prior.source_item_revision_id,
      case
        when prior.admission in ('out_of_window', 'over_cap')
          then 'admitted'::admission_outcome
        else prior.admission
      end,
      prior.views
    from source_import_item prior
    inner join source_item item
      on item.id = prior.source_item_id
      and item.workspace_id = prior.workspace_id
    where prior.workspace_id = ${workspaceId}::uuid
      and prior.source_import_id = ${input.priorSourceImportId}::uuid
      and item.source_id = ${input.sourceId}::uuid
    on conflict (workspace_id, source_import_id, source_item_id) do nothing
    returning id
  `);

  const [current] = await executor
    .select({
      admitted: sql<number>`count(*) filter (where ${sourceImportItem.admission} = 'admitted')::int`,
      associated: sql<number>`count(*)::int`,
    })
    .from(sourceImportItem)
    .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
    .where(
      and(
        inWorkspace(sourceImportItem, workspaceId),
        eq(sourceImportItem.sourceImportId, input.sourceImportId),
        eq(sourceItem.sourceId, input.sourceId),
      ),
    );
  const associatedCount = current?.associated ?? 0;
  if (associatedCount !== reusableCount) {
    throw new Error("not-modified source reuse count mismatch");
  }

  return {
    admittedCount: current?.admitted ?? 0,
    associatedCount,
    insertedCount: inserted.rows.length,
  };
}

export async function listSourceImportCandidates(
  executor: Executor,
  workspaceId: string,
  sourceImportId: string,
) {
  return executor
    .select({
      sourceItemId: sourceImportItem.sourceItemId,
      sourceItemRevisionId: sourceImportItem.sourceItemRevisionId,
      views: sourceImportItem.views,
      sourceId: sourceItem.sourceId,
      origin: sourceItem.origin,
      externalId: sourceItem.externalId,
      publishedAt: sourceItem.publishedAt,
      title: sourceItemRevision.title,
      summary: sourceItemRevision.summary,
    })
    .from(sourceImportItem)
    .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
    .innerJoin(
      sourceItemRevision,
      eq(sourceItemRevision.id, sourceImportItem.sourceItemRevisionId),
    )
    .where(
      and(
        inWorkspace(sourceImportItem, workspaceId),
        eq(sourceImportItem.sourceImportId, sourceImportId),
        eq(sourceImportItem.admission, "admitted"),
      ),
    );
}

export async function demoteSourceImportItems(
  executor: Executor,
  workspaceId: string,
  sourceImportId: string,
  admission: Extract<AdmissionOutcome, "out_of_window" | "over_cap">,
  sourceItemIds: readonly string[],
) {
  if (sourceItemIds.length === 0) {
    return;
  }

  await executor
    .update(sourceImportItem)
    .set({ admission })
    .where(
      and(
        inWorkspace(sourceImportItem, workspaceId),
        eq(sourceImportItem.sourceImportId, sourceImportId),
        eq(sourceImportItem.admission, "admitted"),
        inArray(sourceImportItem.sourceItemId, [...sourceItemIds]),
      ),
    );
}

export type SourceImportItemRankInput = {
  sourceItemId: string;
  rank: number;
  keywordScore: number | null;
  enrichmentOutcome: EnrichmentOutcome | null;
};

export async function recordSourceImportItemRanks(
  executor: Executor,
  workspaceId: string,
  sourceImportId: string,
  ranks: readonly SourceImportItemRankInput[],
) {
  if (ranks.length === 0) {
    return;
  }

  const updated = await executor.execute<{ id: string }>(sql`
    update source_import_item as item
    set
      rank = ranked.item_rank,
      keyword_score = ranked.keyword_score,
      enrichment_outcome = ranked.enrichment_outcome::enrichment_outcome,
      updated_at = now()
    from jsonb_to_recordset(
      ${JSON.stringify(
        ranks.map((entry) => ({
          enrichment_outcome: entry.enrichmentOutcome,
          item_rank: entry.rank,
          keyword_score: entry.keywordScore,
          source_item_id: entry.sourceItemId,
        })),
      )}::jsonb
    ) as ranked(
      source_item_id uuid,
      item_rank integer,
      keyword_score double precision,
      enrichment_outcome text
    )
    where item.workspace_id = ${workspaceId}::uuid
      and item.source_import_id = ${sourceImportId}::uuid
      and item.source_item_id = ranked.source_item_id
    returning item.id
  `);

  if (updated.rows.length !== ranks.length) {
    throw new Error("source import rank batch updated incomplete items");
  }
}

export type EnrichmentUnitInput = {
  sourceImportId: string;
  sourceItemRevisionId: string;
};

export async function findEnrichmentUnit(
  executor: Executor,
  workspaceId: string,
  input: EnrichmentUnitInput,
) {
  const [unit] = await executor
    .select({
      enrichmentOutcome: sourceImportItem.enrichmentOutcome,
      canonicalUrl: sourceItemRevision.canonicalUrl,
      summary: sourceItemRevision.summary,
      title: sourceItemRevision.title,
      endpoint: source.endpoint,
      articleFetchMode: source.articleFetchMode,
    })
    .from(sourceImportItem)
    .innerJoin(
      sourceItemRevision,
      eq(sourceItemRevision.id, sourceImportItem.sourceItemRevisionId),
    )
    .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
    .innerJoin(source, eq(source.id, sourceItem.sourceId))
    .where(
      and(
        inWorkspace(sourceImportItem, workspaceId),
        eq(sourceImportItem.sourceImportId, input.sourceImportId),
        eq(sourceImportItem.sourceItemRevisionId, input.sourceItemRevisionId),
      ),
    );

  return unit;
}

export type SettleSourceImportUnitInput = {
  sourceImportId: string;
  sourceItemRevisionId: string;
  outcome: EnrichmentOutcome;
  reason?: EnrichmentReason | null;
  enrichmentId?: string | null;
};

// Only overwrite pending so a rejected-invoke wrapper cannot clobber a recorded outcome.
export async function settleSourceImportUnit(
  executor: Executor,
  workspaceId: string,
  input: SettleSourceImportUnitInput,
) {
  const [settled] = await executor
    .update(sourceImportItem)
    .set({
      enrichmentOutcome: input.outcome,
      enrichmentReason: input.reason ?? null,
      enrichmentId: input.enrichmentId ?? null,
    })
    .where(
      and(
        inWorkspace(sourceImportItem, workspaceId),
        eq(sourceImportItem.sourceImportId, input.sourceImportId),
        eq(sourceImportItem.sourceItemRevisionId, input.sourceItemRevisionId),
        eq(sourceImportItem.enrichmentOutcome, "pending"),
      ),
    )
    .returning({ id: sourceImportItem.id });

  return settled !== undefined;
}

export type SourceItemEnrichmentInput = {
  sourceItemRevisionId: string;
  operationAttemptId: string;
  policyVersion: string;
  adapter: ArticleAdapter;
  fallbackReason: EnrichmentReason | null;
  pageContentHash: string;
  extract: string;
  brief: unknown | null;
  providerRequestId: string | null;
};

// On conflict, return the winner instead of treating the race as unknown.
export async function insertSourceItemEnrichment(
  executor: Executor,
  workspaceId: string,
  input: SourceItemEnrichmentInput,
): Promise<string> {
  const [inserted] = await executor
    .insert(sourceItemEnrichment)
    .values({ workspaceId, ...input })
    .onConflictDoNothing({
      target: [
        sourceItemEnrichment.workspaceId,
        sourceItemEnrichment.sourceItemRevisionId,
        sourceItemEnrichment.policyVersion,
        sourceItemEnrichment.pageContentHash,
      ],
    })
    .returning({ id: sourceItemEnrichment.id });

  if (inserted) {
    return inserted.id;
  }

  const existing = await findSourceItemEnrichment(executor, workspaceId, {
    sourceItemRevisionId: input.sourceItemRevisionId,
    policyVersion: input.policyVersion,
    pageContentHash: input.pageContentHash,
  });

  if (!existing) {
    throw new Error("enrichment conflict resolved no row");
  }

  return existing.id;
}

export type FindSourceItemEnrichmentInput = {
  sourceItemRevisionId: string;
  policyVersion: string;
  pageContentHash?: string;
};

export async function findSourceItemEnrichment(
  executor: Executor,
  workspaceId: string,
  input: FindSourceItemEnrichmentInput,
) {
  const [row] = await executor
    .select({
      id: sourceItemEnrichment.id,
      adapter: sourceItemEnrichment.adapter,
      pageContentHash: sourceItemEnrichment.pageContentHash,
      extract: sourceItemEnrichment.extract,
      brief: sourceItemEnrichment.brief,
      createdAt: sourceItemEnrichment.createdAt,
    })
    .from(sourceItemEnrichment)
    .where(
      and(
        inWorkspace(sourceItemEnrichment, workspaceId),
        eq(
          sourceItemEnrichment.sourceItemRevisionId,
          input.sourceItemRevisionId,
        ),
        eq(sourceItemEnrichment.policyVersion, input.policyVersion),
        ...(input.pageContentHash === undefined
          ? []
          : [eq(sourceItemEnrichment.pageContentHash, input.pageContentHash)]),
      ),
    )
    .orderBy(desc(sourceItemEnrichment.createdAt))
    .limit(1);

  return row;
}

export async function findSourceItemEnrichmentByAttempt(
  executor: Executor,
  workspaceId: string,
  operationAttemptId: string,
) {
  const [row] = await executor
    .select({ id: sourceItemEnrichment.id })
    .from(sourceItemEnrichment)
    .where(
      and(
        inWorkspace(sourceItemEnrichment, workspaceId),
        eq(sourceItemEnrichment.operationAttemptId, operationAttemptId),
      ),
    );

  return row;
}

export type RevisionEnrichmentInput = {
  sourceItemRevisionId: string;
  extractPolicy: string;
};

// Same extract policy reuses the row; a model-config-only change reuses the stored extract.
export async function findRevisionEnrichment(
  executor: Executor,
  workspaceId: string,
  input: RevisionEnrichmentInput,
) {
  const [row] = await executor
    .select({
      id: sourceItemEnrichment.id,
      policyVersion: sourceItemEnrichment.policyVersion,
      adapter: sourceItemEnrichment.adapter,
      fallbackReason: sourceItemEnrichment.fallbackReason,
      pageContentHash: sourceItemEnrichment.pageContentHash,
      extract: sourceItemEnrichment.extract,
      createdAt: sourceItemEnrichment.createdAt,
    })
    .from(sourceItemEnrichment)
    .where(
      and(
        inWorkspace(sourceItemEnrichment, workspaceId),
        eq(
          sourceItemEnrichment.sourceItemRevisionId,
          input.sourceItemRevisionId,
        ),
        like(sourceItemEnrichment.policyVersion, `${input.extractPolicy}:%`),
      ),
    )
    .orderBy(desc(sourceItemEnrichment.createdAt))
    .limit(1);

  return row;
}

export async function findRevisionPageEnrichment(
  executor: Executor,
  workspaceId: string,
  sourceItemRevisionId: string,
) {
  const [row] = await executor
    .select({
      id: sourceItemEnrichment.id,
      adapter: sourceItemEnrichment.adapter,
      pageContentHash: sourceItemEnrichment.pageContentHash,
      extract: sourceItemEnrichment.extract,
      createdAt: sourceItemEnrichment.createdAt,
    })
    .from(sourceItemEnrichment)
    .where(
      and(
        inWorkspace(sourceItemEnrichment, workspaceId),
        eq(sourceItemEnrichment.sourceItemRevisionId, sourceItemRevisionId),
        inArray(sourceItemEnrichment.adapter, ["direct", "firecrawl"]),
      ),
    )
    .orderBy(desc(sourceItemEnrichment.createdAt))
    .limit(1);

  return row;
}

export type AttemptUsageSlot = {
  invocationKey: InvocationKey;
  status: UsageStatus;
};

export async function findAttemptUsageSlots(
  executor: Executor,
  workspaceId: string,
  operationAttemptId: string,
): Promise<AttemptUsageSlot[]> {
  return executor
    .select({
      invocationKey: aiUsageEvent.invocationKey,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(
      and(
        inWorkspace(aiUsageEvent, workspaceId),
        eq(aiUsageEvent.operationAttemptId, operationAttemptId),
      ),
    );
}

export type SettleSourceImportInput = {
  sourceImportId: string;
  stage: SourceImportStage;
  failureCode?: ErrorCode | null;
};

// Never reopen a settled import; that unique index would block the next run.
export async function settleSourceImport(
  executor: Executor,
  workspaceId: string,
  input: SettleSourceImportInput,
) {
  await executor
    .update(sourceImport)
    .set({ stage: input.stage, failureCode: input.failureCode ?? null })
    .where(
      and(
        inWorkspace(sourceImport, workspaceId),
        eq(sourceImport.id, input.sourceImportId),
        ne(sourceImport.stage, "settled"),
      ),
    );
}

export async function sourceImportHasUsableSource(
  executor: Executor,
  workspaceId: string,
  sourceImportId: string,
) {
  const [row] = await executor
    .select({ id: sourceImportSource.id })
    .from(sourceImportSource)
    .leftJoin(
      sourceImportItem,
      and(
        eq(sourceImportItem.workspaceId, sourceImportSource.workspaceId),
        eq(sourceImportItem.sourceImportId, sourceImportSource.sourceImportId),
      ),
    )
    .leftJoin(
      sourceItem,
      and(
        eq(sourceItem.id, sourceImportItem.sourceItemId),
        eq(sourceItem.workspaceId, sourceImportSource.workspaceId),
        eq(sourceItem.sourceId, sourceImportSource.sourceId),
      ),
    )
    .where(
      and(
        inWorkspace(sourceImportSource, workspaceId),
        eq(sourceImportSource.sourceImportId, sourceImportId),
        or(
          inArray(sourceImportSource.outcome, ["succeeded", "not_modified"]),
          and(
            eq(sourceImportSource.outcome, "partial"),
            isNotNull(sourceItem.id),
          ),
        ),
      ),
    )
    .limit(1);

  return row !== undefined;
}

export type SourceImportCounts = {
  acquired: number;
  ordered: number;
  enriched: number;
  skipped: number;
  failed: number;
};

export type SourceImportEnrichmentCounts = {
  enriched: number;
  skipped: number;
  failed: number;
  unknown: number;
};

export type SourceImportProgress = {
  stage: SourceImportStage;
  counts: SourceImportCounts;
  unitsPlanned: number;
  enrichmentBySource: Record<string, SourceImportEnrichmentCounts>;
  admissionMix: Partial<Record<AdmissionOutcome, number>>;
  adapterMix: Partial<Record<ArticleAdapter, number>>;
  adapterMixBySource: Record<string, Partial<Record<ArticleAdapter, number>>>;
  reusedAdapterMix: Partial<Record<ArticleAdapter, number>>;
  reusedAdapterMixBySource: Record<
    string,
    Partial<Record<ArticleAdapter, number>>
  >;
  partial: boolean;
};

const PARTIAL_SOURCE_OUTCOMES: readonly SourceFetchOutcome[] = [
  "partial",
  "skipped",
  "blocked",
  "timed_out",
  "failed_retryable",
  "failed_terminal",
  "rejected",
];

const FAILED_SOURCE_OUTCOMES: readonly SourceFetchOutcome[] = [
  "partial",
  "blocked",
  "timed_out",
  "failed_retryable",
  "failed_terminal",
  "rejected",
];

export async function sourceImportProgress(
  executor: Executor,
  workspaceId: string,
  importIds: readonly string[],
): Promise<Record<string, SourceImportProgress>> {
  if (importIds.length === 0) {
    return {};
  }

  const ids = [...importIds];

  const [imports, sources, admissions, units, adapters] = await Promise.all([
    executor
      .select({ id: sourceImport.id, stage: sourceImport.stage })
      .from(sourceImport)
      .where(
        and(
          inWorkspace(sourceImport, workspaceId),
          inArray(sourceImport.id, ids),
        ),
      ),
    executor
      .select({
        sourceImportId: sourceImportSource.sourceImportId,
        outcome: sourceImportSource.outcome,
        sources: count(),
      })
      .from(sourceImportSource)
      .where(
        and(
          inWorkspace(sourceImportSource, workspaceId),
          inArray(sourceImportSource.sourceImportId, ids),
        ),
      )
      .groupBy(sourceImportSource.sourceImportId, sourceImportSource.outcome),
    executor
      .select({
        sourceImportId: sourceImportItem.sourceImportId,
        admission: sourceImportItem.admission,
        items: sql<number>`count(*)::int`,
      })
      .from(sourceImportItem)
      .where(
        and(
          inWorkspace(sourceImportItem, workspaceId),
          inArray(sourceImportItem.sourceImportId, ids),
        ),
      )
      .groupBy(sourceImportItem.sourceImportId, sourceImportItem.admission),
    executor
      .select({
        sourceImportId: sourceImportItem.sourceImportId,
        sourceId: sourceItem.sourceId,
        outcome: sourceImportItem.enrichmentOutcome,
        units: count(),
      })
      .from(sourceImportItem)
      .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
      .where(
        and(
          inWorkspace(sourceImportItem, workspaceId),
          inArray(sourceImportItem.sourceImportId, ids),
          isNotNull(sourceImportItem.enrichmentOutcome),
        ),
      )
      .groupBy(
        sourceImportItem.sourceImportId,
        sourceItem.sourceId,
        sourceImportItem.enrichmentOutcome,
      ),
    executor
      .select({
        sourceImportId: sourceImportItem.sourceImportId,
        sourceId: sourceItem.sourceId,
        adapter: sourceItemEnrichment.adapter,
        items: sql<number>`count(*)::int`,
        reused: sql<number>`count(*) filter (where ${operationAttempt.operationId} <> ${sourceImport.operationId})::int`,
      })
      .from(sourceImportItem)
      .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
      .innerJoin(
        sourceItemEnrichment,
        eq(sourceItemEnrichment.id, sourceImportItem.enrichmentId),
      )
      .innerJoin(
        sourceImport,
        eq(sourceImport.id, sourceImportItem.sourceImportId),
      )
      .innerJoin(
        operationAttempt,
        eq(operationAttempt.id, sourceItemEnrichment.operationAttemptId),
      )
      .where(
        and(
          inWorkspace(sourceImportItem, workspaceId),
          inArray(sourceImportItem.sourceImportId, ids),
        ),
      )
      .groupBy(
        sourceImportItem.sourceImportId,
        sourceItem.sourceId,
        sourceItemEnrichment.adapter,
      ),
  ]);

  const progress: Record<string, SourceImportProgress> = {};

  for (const row of imports) {
    progress[row.id] = {
      stage: row.stage,
      counts: { acquired: 0, ordered: 0, enriched: 0, skipped: 0, failed: 0 },
      unitsPlanned: 0,
      enrichmentBySource: {},
      admissionMix: {},
      adapterMix: {},
      adapterMixBySource: {},
      reusedAdapterMix: {},
      reusedAdapterMixBySource: {},
      partial: false,
    };
  }

  for (const row of sources) {
    const entry = progress[row.sourceImportId];
    if (!entry) {
      continue;
    }

    if (row.outcome === "skipped") {
      entry.counts.skipped += row.sources;
    }

    if (FAILED_SOURCE_OUTCOMES.includes(row.outcome)) {
      entry.counts.failed += row.sources;
    }

    if (PARTIAL_SOURCE_OUTCOMES.includes(row.outcome)) {
      entry.partial = true;
    }
  }

  for (const row of admissions) {
    const entry = progress[row.sourceImportId];
    if (!entry) {
      continue;
    }

    entry.admissionMix[row.admission] = row.items;
    entry.counts.acquired += row.items;

    if (row.admission === "admitted") {
      entry.counts.ordered = row.items;
    }
  }

  for (const row of adapters) {
    const entry = progress[row.sourceImportId];
    if (!entry) {
      continue;
    }

    entry.adapterMix[row.adapter] =
      (entry.adapterMix[row.adapter] ?? 0) + row.items;
    entry.reusedAdapterMix[row.adapter] =
      (entry.reusedAdapterMix[row.adapter] ?? 0) + Number(row.reused);

    const bySource = entry.adapterMixBySource[row.sourceId] ?? {};
    bySource[row.adapter] = (bySource[row.adapter] ?? 0) + row.items;
    entry.adapterMixBySource[row.sourceId] = bySource;

    const reusedBySource = entry.reusedAdapterMixBySource[row.sourceId] ?? {};
    reusedBySource[row.adapter] =
      (reusedBySource[row.adapter] ?? 0) + Number(row.reused);
    entry.reusedAdapterMixBySource[row.sourceId] = reusedBySource;
  }

  for (const row of units) {
    const entry = progress[row.sourceImportId];
    if (!entry || row.outcome === null) {
      continue;
    }

    entry.unitsPlanned += row.units;

    const bySource = entry.enrichmentBySource[row.sourceId] ?? {
      enriched: 0,
      skipped: 0,
      failed: 0,
      unknown: 0,
    };
    entry.enrichmentBySource[row.sourceId] = bySource;

    if (row.outcome === "succeeded") {
      entry.counts.enriched += row.units;
      bySource.enriched += row.units;
      continue;
    }

    if (row.outcome === "pending") {
      continue;
    }

    entry.partial = true;

    if (row.outcome === "skipped") {
      entry.counts.skipped += row.units;
      bySource.skipped += row.units;
      continue;
    }

    entry.counts.failed += row.units;
    bySource[row.outcome] += row.units;
  }

  return progress;
}
