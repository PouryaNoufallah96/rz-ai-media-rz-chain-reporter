import assert from "node:assert/strict";

import {
  decideNewsModelRecovery,
  decideRecordedNewsModelRecovery,
  importCovers,
  importIsAnalysisReady,
  semanticAttemptFinalization,
  unitInvocationDeadlineMs,
} from "./analysis-run";

assert.deepEqual(
  decideNewsModelRecovery(
    { ambiguous: false, code: "STRUCTURED_OUTPUT_INVALID" },
    false,
  ),
  { kind: "repair" },
);
assert.deepEqual(
  decideNewsModelRecovery(
    { ambiguous: false, code: "STRUCTURED_OUTPUT_INVALID" },
    true,
  ),
  {
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.deepEqual(
  decideNewsModelRecovery(
    { ambiguous: true, code: "MODEL_INVOCATION_FAILED" },
    false,
  ),
  {
    failureCode: "MODEL_INVOCATION_FAILED",
    kind: "deterministic",
    outcome: "ambiguous",
  },
);
assert.deepEqual(
  decideRecordedNewsModelRecovery({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: null,
    retry: null,
  }),
  {
    failureCode: "MODEL_INVOCATION_FAILED",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.deepEqual(
  decideRecordedNewsModelRecovery({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "STRUCTURED_OUTPUT_INVALID",
    retry: null,
  }),
  { kind: "repair" },
);
assert.deepEqual(
  decideRecordedNewsModelRecovery({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "STRUCTURED_OUTPUT_INVALID",
    retry: "failed",
  }),
  {
    failureCode: "MODEL_INVOCATION_FAILED",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.deepEqual(semanticAttemptFinalization(null), {
  failureCode: null,
  outcome: "succeeded",
});
assert.deepEqual(semanticAttemptFinalization("ambiguous_outcome"), {
  failureCode: "MODEL_INVOCATION_FAILED",
  outcome: "ambiguous",
});
assert.deepEqual(semanticAttemptFinalization("dimension_mismatch"), {
  failureCode: "VALIDATION_FAILED",
  outcome: "failed_terminal",
});

const candidate = {
  id: "import-1",
  enrichmentEnabled: true,
  failureCode: null,
  lifecycle: "succeeded" as const,
  operationId: "operation-1",
  orderingMode: "latest",
  stage: "settled" as const,
  settled: true,
  settledAt: new Date(0),
  sourceIds: ["rss-1", "telegram-1", "telegram-2"],
  succeeded: true,
  telegramSourceIds: ["telegram-1", "telegram-2"],
  templateFingerprint: "template-1",
  topN: 15,
  topics: ["BTC"],
  usableSourceIds: ["rss-1", "telegram-1", "telegram-2"],
  windowHours: 48,
};
const request = {
  enrichmentEnabled: true,
  includesTelegram: true,
  orderingMode: "latest",
  sourceIds: ["rss-1", "telegram-1"],
  telegramSourceIds: ["telegram-1"],
  templateFingerprint: "template-1",
  topN: 15,
  topics: ["btc"],
  windowHours: 24,
};

assert.equal(importCovers(candidate, request, true), false);
assert.equal(
  importCovers(
    { ...candidate, orderingMode: "latest_per_source" },
    { ...request, orderingMode: "latest_per_source" },
    true,
  ),
  true,
);
assert.equal(
  importCovers(
    { ...candidate, usableSourceIds: ["rss-1", "telegram-2"] },
    request,
    true,
  ),
  false,
);
assert.equal(
  importIsAnalysisReady(
    {
      ...candidate,
      lifecycle: "running",
      stage: "enriching",
      settled: false,
    },
    { ...request, telegramSourceIds: ["telegram-1", "telegram-2"] },
  ),
  true,
);
assert.equal(
  importIsAnalysisReady(
    {
      ...candidate,
      lifecycle: "running",
      stage: "acquiring",
      settled: false,
    },
    { ...request, telegramSourceIds: ["telegram-1", "telegram-2"] },
  ),
  false,
);
assert.equal(
  importIsAnalysisReady(
    {
      ...candidate,
      lifecycle: "failed",
      stage: "enriching",
      settled: false,
    },
    { ...request, telegramSourceIds: ["telegram-1", "telegram-2"] },
  ),
  false,
);
assert.equal(
  importIsAnalysisReady(
    {
      ...candidate,
      lifecycle: "running",
      stage: "enriching",
      settled: false,
      usableSourceIds: ["rss-1", "telegram-2"],
    },
    { ...request, telegramSourceIds: ["telegram-1", "telegram-2"] },
  ),
  true,
);
assert.equal(
  importIsAnalysisReady(
    {
      ...candidate,
      usableSourceIds: ["telegram-2"],
    },
    request,
  ),
  false,
);
assert.equal(unitInvocationDeadlineMs(30_000, "primary", 0), 20_000);
assert.equal(unitInvocationDeadlineMs(30_000, "retry-1", 0), 10_000);
assert.equal(unitInvocationDeadlineMs(30_000, "fallback", 25_000), 5_000);
assert.equal(unitInvocationDeadlineMs(30_000, "primary", 30_000), null);

process.stdout.write(
  "analysis run probe passed: model recovery, semantic attempts, partial import readiness and unit deadline\n",
);
