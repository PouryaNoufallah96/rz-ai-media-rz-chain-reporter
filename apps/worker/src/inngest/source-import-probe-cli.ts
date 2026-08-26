import assert from "node:assert/strict";

import {
  decideBriefRecovery,
  embeddingFailureAttemptOutcome,
  enrichmentAttemptOutcome,
  nextBriefInvocationAfterRecordedFailure,
  rankKeywordFallback,
  sourceFetchConcurrencyKey,
  sourceImportAttemptId,
  sourceImportEnrichmentComplete,
} from "./source-import";

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

console.log("source-import AI resilience probe passed scenarios=21");
