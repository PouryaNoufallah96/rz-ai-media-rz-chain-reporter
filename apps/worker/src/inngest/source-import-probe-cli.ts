import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDb } from "@rz-chain-reporter/db";
import { insertPendingUsage } from "@rz-chain-reporter/db/repositories/ai-usage-event";
import {
  allocateOperationAttemptWithId,
  settleOperationAttempt,
} from "@rz-chain-reporter/db/repositories/operation-attempt";
import {
  commitSourceImportOrdering,
  recordClaimedSourceImportEffectiveTopics,
  settleSourceImportUnit,
} from "@rz-chain-reporter/db/repositories/source-import";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceImport } from "@rz-chain-reporter/db/schema/source-import";
import { sourceImportItem } from "@rz-chain-reporter/db/schema/source-import-item";
import { sourceImportSource } from "@rz-chain-reporter/db/schema/source-import-source";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import { workspace } from "@rz-chain-reporter/db/schema/workspace";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

import {
  effectiveTopicValues,
  originalEffectiveTopics,
  sourceImportContentLocale,
  topicEmbeddingValues,
  topicTranslationOutputSchema,
  translatedEffectiveTopics,
} from "../sources/effective-topics";
import {
  decideBriefRecovery,
  embeddingFailureAttemptOutcome,
  enrichmentAttemptOutcome,
  nextBriefInvocationAfterRecordedFailure,
  rankKeywordFallback,
  reconcileStaleSourceImports,
  settleSourceImportOperation,
  sourceFetchConcurrencyKey,
  sourceImportAttemptId,
  sourceImportEnrichmentComplete,
  TOPIC_TRANSLATION_INVOCATION_KEY,
} from "./source-import";

dotenv.config({ path: "../../.env.migration" });

assert.equal(TOPIC_TRANSLATION_INVOCATION_KEY, "primary");

assert.equal(
  decideBriefRecovery(
    { ambiguous: false, code: "STRUCTURED_OUTPUT_INVALID", retryable: false },
    false,
  ),
  "repair",
);
assert.equal(
  decideBriefRecovery(
    { ambiguous: false, code: "STRUCTURED_OUTPUT_INVALID", retryable: false },
    true,
  ),
  "fallback",
);
assert.equal(
  decideBriefRecovery(
    { ambiguous: false, code: "MODEL_INVOCATION_FAILED", retryable: true },
    false,
  ),
  "transport_retry",
);
assert.equal(
  decideBriefRecovery(
    { ambiguous: false, code: "MODEL_INVOCATION_FAILED", retryable: false },
    false,
  ),
  "fallback",
);
assert.equal(
  decideBriefRecovery(
    { ambiguous: true, code: "MODEL_INVOCATION_FAILED", retryable: true },
    false,
  ),
  "unknown",
);
assert.equal(
  nextBriefInvocationAfterRecordedFailure({
    primary: "failed",
    retry: undefined,
  }),
  "retry-1",
);
assert.equal(
  nextBriefInvocationAfterRecordedFailure({
    primary: "failed",
    retry: "failed",
  }),
  "fallback",
);

const newest = new Date("2026-08-26T12:00:00.000Z");
const older = new Date("2026-08-26T11:00:00.000Z");
const fallback = rankKeywordFallback([
  {
    externalId: "low",
    publishedAt: newest,
    sourceItemId: "low",
    views: 5,
  },
  {
    externalId: "older-high",
    publishedAt: older,
    sourceItemId: "older-high",
    views: 10,
  },
  {
    externalId: "newer-high",
    publishedAt: newest,
    sourceItemId: "newer-high",
    views: 10,
  },
]);
assert.deepEqual(
  fallback.map((entry) => ({
    keywordScore: entry.keywordScore,
    rank: entry.rank,
    sourceItemId: entry.sourceItemId,
  })),
  [
    { keywordScore: null, rank: 1, sourceItemId: "newer-high" },
    { keywordScore: null, rank: 2, sourceItemId: "older-high" },
    { keywordScore: null, rank: 3, sourceItemId: "low" },
  ],
);

const rssHostKey = sourceFetchConcurrencyKey({
  host: "example.com",
  sourceId: "00000000-0000-4000-8000-000000000001",
});
assert.equal(
  rssHostKey,
  sourceFetchConcurrencyKey({
    host: "example.com",
    sourceId: "00000000-0000-4000-8000-000000000002",
  }),
);
assert.notEqual(
  sourceFetchConcurrencyKey({
    host: "t.me",
    sourceId: "00000000-0000-4000-8000-000000000001",
  }),
  sourceFetchConcurrencyKey({
    host: "t.me",
    sourceId: "00000000-0000-4000-8000-000000000002",
  }),
);

assert.equal(
  sourceImportEnrichmentComplete({ enrichmentBySource: {}, unitsPlanned: 0 }),
  true,
);
assert.equal(
  sourceImportEnrichmentComplete({
    enrichmentBySource: {
      rss: { enriched: 1, failed: 0, skipped: 0, unknown: 0 },
    },
    unitsPlanned: 2,
  }),
  false,
);
assert.equal(
  sourceImportEnrichmentComplete({
    enrichmentBySource: {
      rss: { enriched: 1, failed: 1, skipped: 0, unknown: 0 },
    },
    unitsPlanned: 2,
  }),
  true,
);

const operationId = "00000000-0000-4000-8000-000000000003";
const firstAttemptId = sourceImportAttemptId(operationId, "first");
assert.match(
  firstAttemptId,
  /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
);
assert.equal(firstAttemptId, sourceImportAttemptId(operationId, "first"));
assert.notEqual(firstAttemptId, sourceImportAttemptId(operationId, "second"));
assert.equal(enrichmentAttemptOutcome("skipped"), "succeeded");
assert.equal(enrichmentAttemptOutcome("failed"), "failed_terminal");
assert.equal(enrichmentAttemptOutcome("unknown"), "ambiguous");
assert.equal(embeddingFailureAttemptOutcome(false), "failed_terminal");
assert.equal(embeddingFailureAttemptOutcome(true), "ambiguous");

let syntheticGatewayCalls = 0;
function syntheticGatewayOutput(
  topics: readonly string[],
  contentLocale: "en" | "fa",
  output: unknown,
) {
  syntheticGatewayCalls += 1;
  return topicTranslationOutputSchema(topics, contentLocale).parse(output);
}

const englishTopics = ["Bitcoin", "artificial intelligence"];
const englishOutput = syntheticGatewayOutput(englishTopics, "en", {
  values: [
    { index: 0, value: "Bitcoin" },
    { index: 1, value: "artificial intelligence" },
  ],
});
assert.deepEqual(
  translatedEffectiveTopics(englishTopics, "en", englishOutput),
  {
    contentLocale: "en",
    usedOriginalFallback: false,
    values: englishTopics,
  },
);

const persianTopics = ["قیمت بیت کوین", "هوش مصنوعی"];
const persianOutput = syntheticGatewayOutput(persianTopics, "en", {
  values: [
    { index: 0, value: "Bitcoin price" },
    { index: 1, value: "artificial intelligence" },
  ],
});
assert.deepEqual(
  translatedEffectiveTopics(persianTopics, "en", persianOutput).values,
  ["Bitcoin price", "artificial intelligence"],
);
assert.equal(
  topicTranslationOutputSchema(persianTopics, "en").safeParse({
    values: persianTopics.map((value, index) => ({ index, value })),
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(["$BTC 2026"], "fa").safeParse({
    values: [{ index: 0, value: "$BTC 2026" }],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(["$BTC 2026"], "fa").safeParse({
    values: [{ index: 0, value: "$BTC ۲۰۲۶" }],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(["$BTC 2026"], "fa").safeParse({
    values: [{ index: 0, value: "$BTC ۲۰۲۶ متن اضافه" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(["$BTC 2026"], "fa").safeParse({
    values: [{ index: 0, value: "$ETH 9999" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(
    ["Bitcoin ETFs end 9-day inflow streak"],
    "fa",
  ).safeParse({
    values: [
      {
        index: 0,
        value: "روند 9 روزه ورود سرمایه به صندوق‌های بیت کوین پایان یافت",
      },
    ],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(
    ["Bitcoin ETFs end 9-day inflow streak"],
    "fa",
  ).safeParse({
    values: [
      {
        index: 0,
        value: "روند ۹ روزه ورود سرمایه به صندوق‌های بیت کوین پایان یافت",
      },
    ],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(
    ["Bitcoin ETFs end 9-day inflow streak"],
    "fa",
  ).safeParse({
    values: [
      {
        index: 0,
        value: "روند ۸ روزه ورود سرمایه به صندوق‌های بیت کوین پایان یافت",
      },
    ],
  }).success,
  false,
);
const protectedMixedTopic =
  "Bitcoin and $BTC in 2026: https://example.com/market";
assert.equal(
  topicTranslationOutputSchema([protectedMixedTopic], "fa").safeParse({
    values: [
      {
        index: 0,
        value: "بیت کوین و $BTC در 2026: https://example.com/market",
      },
    ],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema([protectedMixedTopic], "fa").safeParse({
    values: [
      {
        index: 0,
        value: "بیت کوین و $ETH در ۲۰۲۶: https://example.com/other",
      },
    ],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(["قیمت $BTC در سال 2026"], "en").safeParse({
    values: [{ index: 0, value: "قیمت $BTC در سال 2026" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(["Bitcoin rally"], "fa").safeParse({
    values: [{ index: 0, value: "Bitcoin rally ب" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(["رالی بیت کوین"], "en").safeParse({
    values: [{ index: 0, value: "رالی بیت کوین Bitcoin" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(
    ["Read https://example.com, now"],
    "fa",
  ).safeParse({
    values: [{ index: 0, value: "اکنون https://example.com را بخوانید" }],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(["BREAKING NEWS"], "fa").safeParse({
    values: [{ index: 0, value: "خبر فوری" }],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(["BREAKING NEWS"], "fa").safeParse({
    values: [{ index: 0, value: "BREAKING NEWS" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(["THE MARKET"], "fa").safeParse({
    values: [{ index: 0, value: "بازار" }],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(["BTC"], "fa").safeParse({
    values: [{ index: 0, value: "بیت کوین" }],
  }).success,
  true,
);
assert.equal(
  topicTranslationOutputSchema(["BTC"], "fa").safeParse({
    values: [{ index: 0, value: "BTC" }],
  }).success,
  false,
);

const mixedTopics = [
  "OpenAI و $BTC در 2026",
  "AIهوش https://example.com/topic",
];
const mixedOutput = syntheticGatewayOutput(mixedTopics, "en", {
  values: [
    { index: 0, value: "OpenAI and $BTC in 2026" },
    {
      index: 1,
      value: "AI intelligence https://example.com/topic",
    },
  ],
});
assert.deepEqual(
  translatedEffectiveTopics(mixedTopics, "en", mixedOutput).values,
  ["OpenAI and $BTC in 2026", "AI intelligence https://example.com/topic"],
);

await proveReconciliationLifecycle();

assert.equal(
  topicTranslationOutputSchema(englishTopics, "en").safeParse({
    values: [{ index: 0, value: "Bitcoin" }],
  }).success,
  false,
);
assert.equal(
  topicTranslationOutputSchema(englishTopics, "en").safeParse({
    values: [
      { index: 1, value: "Bitcoin" },
      { index: 0, value: "artificial intelligence" },
    ],
  }).success,
  false,
);
const fallbackTopics = originalEffectiveTopics(persianTopics, "en", true);
assert.deepEqual(fallbackTopics.values, persianTopics);
assert.equal(fallbackTopics.usedOriginalFallback, true);
assert.deepEqual(
  effectiveTopicValues(persianTopics, fallbackTopics),
  persianTopics,
);

const emptyTopics = originalEffectiveTopics([], "en", false);
assert.deepEqual(emptyTopics.values, []);
assert.equal(emptyTopics.usedOriginalFallback, false);

const persisted = translatedEffectiveTopics(englishTopics, "en", englishOutput);
assert.deepEqual(
  effectiveTopicValues(["changed raw", "topics"], persisted),
  englishTopics,
);
assert.equal(syntheticGatewayCalls, 3);
assert.equal(sourceImportContentLocale(["en", "en"]), "en");
assert.equal(sourceImportContentLocale(["fa"]), "fa");
assert.throws(() => sourceImportContentLocale(["en", "fa"]));
assert.deepEqual(
  topicEmbeddingValues(
    mixedOutput.values.map((entry) => entry.value),
    500,
  ),
  ["OpenAI and $BTC in 2026", "AI intelligence https://example.com/topic"],
);

console.log(
  "source-import AI resilience probe passed scenarios=43 syntheticGatewayCalls=3 topicFallbackContinues=true oneVectorPerLogicalTopic=true replayReusesPersisted=true reconciliationClaimWinners=1 claimedOrderingAtomic=true claimedOrderingIdempotent=true acquiringRecovery=true pendingAcquisitionUnitsClosed=true staleOrderingRejected=true staleAttemptAllocationRejected=true lateProviderSlotRejected=true lateCancellationSettled=false lateParentSettled=false",
);

async function proveReconciliationLifecycle() {
  const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
  const database = createDb(MIGRATION_DATABASE_URL, { max: 4 });
  const ids = {
    acquiringOperation: randomUUID(),
    acquiringSourceImport: randomUUID(),
    actor: `source-import-worker-probe-${randomUUID()}`,
    operation: randomUUID(),
    orderingOperation: randomUUID(),
    orderingSourceImport: randomUUID(),
    revision: randomUUID(),
    source: randomUUID(),
    sourceImport: randomUUID(),
    sourceItem: randomUUID(),
    workspace: randomUUID(),
  };
  const attemptId = sourceImportAttemptId(ids.operation, ids.revision);
  const staleNow = new Date("2026-08-31T12:00:00.000Z");
  try {
    await database.db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: ids.actor,
        email: `${ids.actor}@example.test`,
        name: "Source Import Worker Probe",
      });
      await tx.insert(workspace).values({
        id: ids.workspace,
        name: `Source Import Worker Probe ${ids.workspace}`,
      });
      await tx.insert(source).values({
        id: ids.source,
        workspaceId: ids.workspace,
        articleFetchMode: "direct",
        contentLocale: "en",
        endpoint: "https://source-import-worker.example.test/rss",
        key: `source-import-worker-${ids.source}`,
        name: "Source Import Worker Probe",
        origin: "rss",
      });
      await tx.insert(sourceItem).values({
        id: ids.sourceItem,
        workspaceId: ids.workspace,
        attribution: "Source Import Worker Probe",
        contentLocale: "en",
        externalId: "worker-probe",
        origin: "rss",
        sourceId: ids.source,
        title: "Worker probe",
        url: "https://source-import-worker.example.test/item",
      });
      await tx.insert(sourceItemRevision).values({
        id: ids.revision,
        workspaceId: ids.workspace,
        canonicalUrl: "https://source-import-worker.example.test/item",
        contentHash: "source-import-worker-probe",
        contentLocale: "en",
        revisionNumber: 1,
        sourceItemId: ids.sourceItem,
        summary: "Worker probe summary",
        title: "Worker probe",
      });
      await tx.insert(operation).values({
        id: ids.operation,
        workspaceId: ids.workspace,
        actor: ids.actor,
        attemptSeq: 1,
        claimedBy: "source-import-parent:worker-probe",
        commandType: "source-import:worker-probe",
        idempotencyKey: "worker-probe",
        leaseExpiresAt: new Date(staleNow.getTime() - 1),
        lifecycle: "settling",
        requestHash: "worker-probe",
      });
      await tx.insert(operationAttempt).values({
        id: attemptId,
        workspaceId: ids.workspace,
        attemptNumber: 1,
        operationId: ids.operation,
      });
      await tx.insert(sourceImport).values({
        id: ids.sourceImport,
        workspaceId: ids.workspace,
        enrichmentEnabled: true,
        operationId: ids.operation,
        orderingMode: "latest",
        stage: "enriching",
        templateFingerprint: "source-import-worker-probe",
        topN: 1,
        topics: [],
        windowHours: 24,
      });
      await tx.insert(sourceImportSource).values({
        workspaceId: ids.workspace,
        admittedCount: 1,
        fetchedCount: 1,
        outcome: "succeeded",
        sourceId: ids.source,
        sourceImportId: ids.sourceImport,
      });
      await tx.insert(sourceImportItem).values({
        workspaceId: ids.workspace,
        admission: "admitted",
        enrichmentOutcome: "pending",
        sourceImportId: ids.sourceImport,
        sourceItemId: ids.sourceItem,
        sourceItemRevisionId: ids.revision,
      });
    });

    const reconciliations = await Promise.all([
      reconcileStaleSourceImports(database.db, ids.workspace, staleNow),
      reconcileStaleSourceImports(database.db, ids.workspace, staleNow),
    ]);
    assert.equal(
      reconciliations.reduce(
        (count, result) => count + result.staleSourceImportsSettled.length,
        0,
      ),
      1,
    );
    const [terminal] = await database.db
      .select({ lifecycle: operation.lifecycle, version: operation.version })
      .from(operation)
      .where(eq(operation.id, ids.operation));
    assert.deepEqual(terminal, { lifecycle: "succeeded", version: 3 });

    await assert.rejects(
      insertPendingUsage(database.db, ids.workspace, {
        apiKind: "chat",
        backend: "remote",
        claimFence: {
          claimedBy: "source-import:v1",
          expectedVersion: 1,
          now: staleNow,
        },
        invocationKey: "fallback",
        operationAttemptId: attemptId,
        operationId: ids.operation,
        providerGateway: "openrouter",
        requestedModel: "source-import-probe",
        taskKey: "enrichment-brief",
      }),
      /usage invocation claim fence lost/,
    );
    assert.equal(
      (
        await database.db
          .select({ id: aiUsageEvent.id })
          .from(aiUsageEvent)
          .where(eq(aiUsageEvent.operationId, ids.operation))
      ).length,
      0,
    );

    const lateCancellationUnitSettled = await settleSourceImportUnit(
      database.db,
      ids.workspace,
      {
        enrichmentId: null,
        outcome: "failed",
        reason: null,
        sourceImportId: ids.sourceImport,
        sourceItemRevisionId: ids.revision,
      },
    );
    assert.equal(lateCancellationUnitSettled, false);
    assert.equal(
      await settleOperationAttempt(database.db, ids.workspace, {
        failureCode: "INTERNAL_SERVER_ERROR",
        id: attemptId,
        outcome: "failed_terminal",
      }),
      null,
    );
    assert.equal(
      await settleSourceImportOperation(
        database.db,
        ids.workspace,
        ids.operation,
        null,
      ),
      null,
    );
    const [unchanged] = await database.db
      .select({ lifecycle: operation.lifecycle, version: operation.version })
      .from(operation)
      .where(eq(operation.id, ids.operation));
    assert.deepEqual(unchanged, terminal);

    const acquiringAttemptId = sourceImportAttemptId(
      ids.acquiringOperation,
      "topic-preparation",
    );
    const orderingAttemptId = sourceImportAttemptId(
      ids.orderingOperation,
      "embedding",
    );
    await database.db.transaction(async (tx) => {
      await tx.insert(operation).values({
        id: ids.orderingOperation,
        workspaceId: ids.workspace,
        actor: ids.actor,
        attemptSeq: 1,
        claimedBy: "source-import:v1",
        commandType: "source-import:worker-probe-ordering",
        idempotencyKey: "worker-probe-ordering",
        leaseExpiresAt: new Date(Date.now() + 60_000),
        lifecycle: "running",
        requestHash: "worker-probe-ordering",
      });
      await tx.insert(operationAttempt).values({
        id: orderingAttemptId,
        workspaceId: ids.workspace,
        attemptNumber: 1,
        operationId: ids.orderingOperation,
      });
      await tx.insert(sourceImport).values({
        id: ids.orderingSourceImport,
        workspaceId: ids.workspace,
        enrichmentEnabled: false,
        operationId: ids.orderingOperation,
        orderingMode: "keywords",
        stage: "acquiring",
        templateFingerprint: "source-import-worker-probe",
        topN: 1,
        topics: [],
        windowHours: 24,
      });
      await tx.insert(sourceImportSource).values({
        workspaceId: ids.workspace,
        outcome: "succeeded",
        sourceId: ids.source,
        sourceImportId: ids.orderingSourceImport,
      });
      await tx.insert(sourceImportItem).values({
        admission: "admitted",
        sourceImportId: ids.orderingSourceImport,
        sourceItemId: ids.sourceItem,
        sourceItemRevisionId: ids.revision,
        workspaceId: ids.workspace,
      });
    });
    assert.deepEqual(
      await recordClaimedSourceImportEffectiveTopics(
        database.db,
        ids.workspace,
        {
          claimedBy: "source-import:v1",
          effectiveTopics: originalEffectiveTopics([], "en", false),
          expectedVersion: 1,
          operationId: ids.orderingOperation,
          sourceImportId: ids.orderingSourceImport,
        },
      ),
      originalEffectiveTopics([], "en", false),
    );
    const orderingCommit = {
      claimedBy: "source-import:v1",
      embedding: {
        attemptId: orderingAttemptId,
        dimension: 3,
        failureCode: null,
        outcome: "succeeded" as const,
        overCapSourceItemIds: [],
      },
      expectedVersion: 1,
      operationId: ids.orderingOperation,
      outOfWindowSourceItemIds: [],
      ranks: [
        {
          enrichmentOutcome: null,
          keywordScore: 0.75,
          rank: 1,
          sourceItemId: ids.sourceItem,
        },
      ],
      sourceImportId: ids.orderingSourceImport,
    };
    assert.equal(
      await commitSourceImportOrdering(
        database.db,
        ids.workspace,
        orderingCommit,
      ),
      true,
    );
    assert.equal(
      await commitSourceImportOrdering(
        database.db,
        ids.workspace,
        orderingCommit,
      ),
      true,
    );
    const [committedOrdering] = await database.db
      .select({
        attemptOutcome: operationAttempt.outcome,
        dimension: sourceImport.embeddingDimension,
        stage: sourceImport.stage,
      })
      .from(sourceImport)
      .innerJoin(
        operationAttempt,
        eq(operationAttempt.id, sourceImport.embeddingAttemptId),
      )
      .where(eq(sourceImport.id, ids.orderingSourceImport));
    assert.deepEqual(committedOrdering, {
      attemptOutcome: "succeeded",
      dimension: 3,
      stage: "enriching",
    });
    const [committedOrderingItem] = await database.db
      .select({
        keywordScore: sourceImportItem.keywordScore,
        rank: sourceImportItem.rank,
      })
      .from(sourceImportItem)
      .where(eq(sourceImportItem.sourceImportId, ids.orderingSourceImport));
    assert.deepEqual(committedOrderingItem, { keywordScore: 0.75, rank: 1 });
    await database.db
      .update(sourceImport)
      .set({ stage: "settled" })
      .where(eq(sourceImport.id, ids.orderingSourceImport));

    await database.db.transaction(async (tx) => {
      await tx.insert(operation).values({
        id: ids.acquiringOperation,
        workspaceId: ids.workspace,
        actor: ids.actor,
        attemptSeq: 1,
        claimedBy: "source-import:v1",
        commandType: "source-import:worker-probe-acquiring",
        idempotencyKey: "worker-probe-acquiring",
        leaseExpiresAt: new Date(staleNow.getTime() - 1),
        lifecycle: "running",
        requestHash: "worker-probe-acquiring",
      });
      await tx.insert(operationAttempt).values({
        id: acquiringAttemptId,
        workspaceId: ids.workspace,
        attemptNumber: 1,
        operationId: ids.acquiringOperation,
      });
      await tx.insert(sourceImport).values({
        id: ids.acquiringSourceImport,
        workspaceId: ids.workspace,
        enrichmentEnabled: true,
        operationId: ids.acquiringOperation,
        orderingMode: "keywords",
        stage: "acquiring",
        templateFingerprint: "source-import-worker-probe",
        topN: 1,
        topics: ["probe"],
        windowHours: 24,
      });
      await tx.insert(sourceImportSource).values({
        workspaceId: ids.workspace,
        outcome: "pending",
        sourceId: ids.source,
        sourceImportId: ids.acquiringSourceImport,
      });
      await tx.insert(sourceImportItem).values({
        admission: "admitted",
        enrichmentOutcome: "pending",
        sourceImportId: ids.acquiringSourceImport,
        sourceItemId: ids.sourceItem,
        sourceItemRevisionId: ids.revision,
        workspaceId: ids.workspace,
      });
    });
    await insertPendingUsage(database.db, ids.workspace, {
      apiKind: "chat",
      backend: "remote",
      claimFence: {
        claimedBy: "source-import:v1",
        expectedVersion: 1,
        now: new Date(staleNow.getTime() - 2),
      },
      invocationKey: "primary",
      operationAttemptId: acquiringAttemptId,
      operationId: ids.acquiringOperation,
      providerGateway: "openrouter",
      requestedModel: "source-import-probe",
      taskKey: "text-translation",
    });

    const acquiringReconciliation = await reconcileStaleSourceImports(
      database.db,
      ids.workspace,
      staleNow,
    );
    assert.equal(acquiringReconciliation.staleSourceImportsSettled.length, 1);
    const [acquiringTerminal] = await database.db
      .select({ lifecycle: operation.lifecycle, version: operation.version })
      .from(operation)
      .where(eq(operation.id, ids.acquiringOperation));
    assert.deepEqual(acquiringTerminal, { lifecycle: "failed", version: 3 });
    const [acquiringImport] = await database.db
      .select({
        failureCode: sourceImport.failureCode,
        stage: sourceImport.stage,
      })
      .from(sourceImport)
      .where(eq(sourceImport.id, ids.acquiringSourceImport));
    assert.deepEqual(acquiringImport, {
      failureCode: "INTERNAL_SERVER_ERROR",
      stage: "settled",
    });
    const [acquiringSource] = await database.db
      .select({ outcome: sourceImportSource.outcome })
      .from(sourceImportSource)
      .where(eq(sourceImportSource.sourceImportId, ids.acquiringSourceImport));
    assert.equal(acquiringSource?.outcome, "failed_terminal");
    const [acquiringUnit] = await database.db
      .select({
        admission: sourceImportItem.admission,
        enrichmentOutcome: sourceImportItem.enrichmentOutcome,
        rank: sourceImportItem.rank,
      })
      .from(sourceImportItem)
      .where(eq(sourceImportItem.sourceImportId, ids.acquiringSourceImport));
    assert.deepEqual(acquiringUnit, {
      admission: "admitted",
      enrichmentOutcome: "failed",
      rank: null,
    });
    const [acquiringAttempt] = await database.db
      .select({ outcome: operationAttempt.outcome })
      .from(operationAttempt)
      .where(eq(operationAttempt.id, acquiringAttemptId));
    assert.equal(acquiringAttempt?.outcome, "ambiguous");
    const [acquiringUsage] = await database.db
      .select({ status: aiUsageEvent.status })
      .from(aiUsageEvent)
      .where(eq(aiUsageEvent.operationId, ids.acquiringOperation));
    assert.equal(acquiringUsage?.status, "unknown");
    await assert.rejects(
      insertPendingUsage(database.db, ids.workspace, {
        apiKind: "embedding",
        backend: "remote",
        claimFence: {
          claimedBy: "source-import:v1",
          expectedVersion: 1,
          now: staleNow,
        },
        invocationKey: "primary",
        operationAttemptId: sourceImportAttemptId(
          ids.acquiringOperation,
          "embedding",
        ),
        operationId: ids.acquiringOperation,
        providerGateway: "openrouter",
        requestedModel: "source-import-probe",
        taskKey: "keyword-embedding",
      }),
      /usage invocation claim fence lost/,
    );
    assert.equal(
      await commitSourceImportOrdering(database.db, ids.workspace, {
        claimedBy: "source-import:v1",
        embedding: null,
        expectedVersion: 1,
        operationId: ids.acquiringOperation,
        outOfWindowSourceItemIds: [ids.sourceItem],
        ranks: [
          {
            enrichmentOutcome: null,
            keywordScore: null,
            rank: 1,
            sourceItemId: ids.sourceItem,
          },
        ],
        sourceImportId: ids.acquiringSourceImport,
      }),
      false,
    );
    const [unchangedAcquiringUnit] = await database.db
      .select({
        admission: sourceImportItem.admission,
        enrichmentOutcome: sourceImportItem.enrichmentOutcome,
        rank: sourceImportItem.rank,
      })
      .from(sourceImportItem)
      .where(eq(sourceImportItem.sourceImportId, ids.acquiringSourceImport));
    assert.deepEqual(unchangedAcquiringUnit, acquiringUnit);
    assert.equal(
      await allocateOperationAttemptWithId(
        database.db,
        ids.workspace,
        ids.acquiringOperation,
        sourceImportAttemptId(ids.acquiringOperation, "late"),
        { claimedBy: "source-import:v1", expectedVersion: 1 },
      ),
      null,
    );
  } finally {
    await database.db.transaction(async (tx) => {
      await tx
        .delete(aiUsageEvent)
        .where(eq(aiUsageEvent.workspaceId, ids.workspace));
      await tx
        .delete(sourceImport)
        .where(eq(sourceImport.workspaceId, ids.workspace));
      await tx
        .delete(operation)
        .where(eq(operation.workspaceId, ids.workspace));
      await tx
        .delete(sourceItemRevision)
        .where(eq(sourceItemRevision.workspaceId, ids.workspace));
      await tx
        .delete(sourceItem)
        .where(eq(sourceItem.workspaceId, ids.workspace));
      await tx.delete(source).where(eq(source.workspaceId, ids.workspace));
      await tx.delete(workspace).where(eq(workspace.id, ids.workspace));
      await tx.delete(user).where(eq(user.id, ids.actor));
    });
    await database.close();
  }
}
