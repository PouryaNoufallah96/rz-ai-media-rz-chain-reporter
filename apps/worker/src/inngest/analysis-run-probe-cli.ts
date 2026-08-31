import assert from "node:assert/strict";
import { z } from "zod";
import { resolveAnalysisTopicGroups } from "../editorial/pipeline";
import { SCORING_VERSION, scoreLexicalTopic } from "../editorial/scoring";
import { rankFromVectors, semanticTopicValues } from "../editorial/semantic";
import {
  decideNewsModelRecovery,
  decideRecordedNewsModelRecovery,
  importCovers,
  importIsAnalysisReady,
  nextNewsModelInvocation,
  nextRecordedPromoInvocation,
  reconcileRecordedUnitSlots,
  selectionOutputSchema,
  selectionPrompt,
  semanticAttemptFinalization,
  UNIT_PRIMARY_DEADLINE_MS,
  UNIT_REPAIR_DEADLINE_MS,
  UNIT_TOTAL_DEADLINE_MS,
  unitInvocationDeadlineMs,
} from "./analysis-run";

const selectionIds = Array.from(
  { length: 20 },
  (_, index) => `selection-${index + 1}`,
);
const selectionSchema = selectionOutputSchema({
  fallbackPlatform: "x",
  platforms: ["x", "telegram"],
  shortlist: selectionIds,
  target: selectionIds.length,
});
const validSelections = selectionIds.map((_, index) => ({
  candidateNumber: index + 1,
  confidenceScore: 80,
  impactScore: 81,
  reasoning: `Reason ${index + 1}`,
  suggestedPlatform: "telegram" as const,
  suitabilityScore: 82,
  viralityScore: 83,
}));
const validSelectionOutput = { selections: validSelections };
const parsedValidSelections = selectionSchema.parse(validSelectionOutput);
assert.deepEqual(
  parsedValidSelections.selections.map((selection) => selection.sourceItemId),
  selectionIds,
);
assert.deepEqual(parsedValidSelections.selections[0], {
  confidenceScore: 80,
  impactScore: 81,
  reasoning: "Reason 1",
  sourceItemId: "selection-1",
  suggestedPlatform: "telegram",
  suitabilityScore: 82,
  viralityScore: 83,
});

const malformedSelectionInput: unknown = {
  selections: validSelections.map((selection, index) => {
    if (index === 4) return { ...selection, confidenceScore: 101 };
    if (index === 9) return { ...selection, reasoning: "" };
    if (index === 14) {
      return { ...selection, suggestedPlatform: "unsupported" };
    }
    return selection;
  }),
};
const recoveredSelectionOutput = selectionSchema.parse(malformedSelectionInput);
assert.equal(recoveredSelectionOutput.selections.length, 20);
assert.deepEqual(
  recoveredSelectionOutput.selections.map(
    (selection) => selection.sourceItemId,
  ),
  selectionIds,
);
assert.equal(recoveredSelectionOutput.selections[4]?.confidenceScore, null);
assert.equal(recoveredSelectionOutput.selections[9]?.reasoning, null);
assert.equal(recoveredSelectionOutput.selections[14]?.suggestedPlatform, "x");
assert.deepEqual(
  recoveredSelectionOutput.selections[0],
  parsedValidSelections.selections[0],
);
assert.equal(
  recoveredSelectionOutput.selections[19]?.sourceItemId,
  "selection-20",
);

const normalizedSelections = selectionSchema.parse({
  selections: [
    { ...validSelections[2], reasoning: "Third first" },
    { ...validSelections[0], reasoning: "First second" },
    { ...validSelections[2], reasoning: "Duplicate third" },
    { ...validSelections[3], candidateNumber: 99 },
    { ...validSelections[4], candidateNumber: "invalid" },
    { unexpected: true },
  ],
}).selections;
assert.equal(normalizedSelections.length, 20);
assert.deepEqual(
  normalizedSelections.slice(0, 4).map((selection) => selection.sourceItemId),
  ["selection-3", "selection-1", "selection-2", "selection-4"],
);
assert.equal(normalizedSelections[0]?.reasoning, "Third first");
assert.equal(normalizedSelections[1]?.reasoning, "First second");
assert.deepEqual(normalizedSelections[2], {
  confidenceScore: null,
  impactScore: null,
  reasoning: null,
  sourceItemId: "selection-2",
  suggestedPlatform: "x",
  suitabilityScore: null,
  viralityScore: null,
});
assert.deepEqual(
  selectionSchema.parse({ selections: [] }).selections.map((selection) => ({
    reasoning: selection.reasoning,
    sourceItemId: selection.sourceItemId,
  })),
  selectionIds.map((sourceItemId) => ({ reasoning: null, sourceItemId })),
);
assert.equal(selectionSchema.safeParse({}).success, false);
assert.equal(selectionSchema.safeParse({ selections: null }).success, false);
const selectionJsonSchema = z.toJSONSchema(selectionSchema, {
  io: "input",
  reused: "inline",
  target: "draft-7",
});
const requiredSelectionFields = [
  "candidateNumber",
  "confidenceScore",
  "impactScore",
  "reasoning",
  "suggestedPlatform",
  "suitabilityScore",
  "viralityScore",
] as const;
const selectionItemJsonSchema = z
  .object({
    additionalProperties: z.literal(false),
    required: z.array(z.string()),
  })
  .parse(
    z
      .object({
        properties: z.object({
          selections: z.object({ items: z.unknown() }),
        }),
      })
      .parse(selectionJsonSchema).properties.selections.items,
  );
assert.deepEqual(selectionItemJsonSchema.required, requiredSelectionFields);
const selectionJsonSchemaText = JSON.stringify(selectionJsonSchema);
assert.equal(selectionJsonSchemaText.includes('"default"'), false);
assert.equal(selectionJsonSchemaText.includes("sourceItemId"), false);
assert.equal(selectionJsonSchemaText.includes("minItems"), false);
assert.equal(selectionJsonSchemaText.includes("maxItems"), false);
assert.ok(selectionJsonSchemaText.includes('"minimum":0'));
assert.ok(selectionJsonSchemaText.includes('"maximum":100'));
assert.ok(selectionJsonSchemaText.includes('"enum":["x","telegram"]'));
const selectionPromptText = selectionPrompt({
  brandName: "Coin Hall",
  items: ["First projection", "Second projection"],
  platforms: ["x", "telegram"],
  target: 2,
});
assert.ok(selectionPromptText.includes("[1]\nFirst projection"));
assert.ok(selectionPromptText.includes("[2]\nSecond projection"));
assert.equal(selectionPromptText.includes("selection-1"), false);

assert.deepEqual(
  decideNewsModelRecovery({
    ambiguous: false,
    code: "STRUCTURED_OUTPUT_INVALID",
  }),
  {
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.deepEqual(
  decideNewsModelRecovery({
    ambiguous: false,
    code: "STRUCTURED_OUTPUT_INVALID",
  }),
  {
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.deepEqual(
  decideNewsModelRecovery({
    ambiguous: true,
    code: "MODEL_INVOCATION_FAILED",
  }),
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
    primaryFailureRetryable: false,
    retry: null,
  }),
  { kind: "fallback" },
);
assert.deepEqual(
  decideRecordedNewsModelRecovery({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "STRUCTURED_OUTPUT_INVALID",
    primaryFailureRetryable: false,
    retry: null,
  }),
  {
    failureCode: "STRUCTURED_OUTPUT_INVALID",
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
    primaryFailureRetryable: false,
    retry: "failed",
  }),
  {
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.deepEqual(
  decideRecordedNewsModelRecovery({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "MODEL_INVOCATION_FAILED",
    primaryFailureRetryable: true,
    retry: null,
  }),
  { kind: "repair" },
);
assert.deepEqual(
  decideRecordedNewsModelRecovery({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "MODEL_INVOCATION_FAILED",
    primaryFailureRetryable: null,
    retry: null,
  }),
  {
    failureCode: "MODEL_INVOCATION_FAILED",
    kind: "deterministic",
    outcome: "failed_terminal",
  },
);
assert.equal(
  nextRecordedPromoInvocation({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "MODEL_INVOCATION_FAILED",
    primaryFailureRetryable: true,
    retry: null,
  }),
  "retry-1",
);
assert.equal(
  nextRecordedPromoInvocation({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "MODEL_INVOCATION_FAILED",
    primaryFailureRetryable: false,
    retry: null,
  }),
  "fallback",
);
assert.equal(
  nextRecordedPromoInvocation({
    fallback: null,
    hasFallback: true,
    primary: "failed",
    primaryFailureCode: "MODEL_INVOCATION_FAILED",
    primaryFailureRetryable: null,
    retry: null,
  }),
  null,
);
const refreshedPromoSlots = reconcileRecordedUnitSlots(
  {
    fallback: null,
    hasFallback: true,
    primary: null,
    primaryFailureCode: null,
    primaryFailureRetryable: null,
    retry: null,
  },
  [
    {
      failureRetryable: true,
      invocationKey: "primary",
      status: "failed",
    },
  ],
  "MODEL_INVOCATION_FAILED",
);
assert.equal(refreshedPromoSlots.primary, "failed");
assert.equal(refreshedPromoSlots.primaryFailureRetryable, true);
assert.equal(nextRecordedPromoInvocation(refreshedPromoSlots), "retry-1");
assert.equal(
  nextNewsModelInvocation(
    "primary",
    {
      ambiguous: false,
      code: "STRUCTURED_OUTPUT_INVALID",
      retryable: false,
    },
    true,
  ),
  null,
);
assert.equal(
  nextNewsModelInvocation(
    "primary",
    { ambiguous: false, code: "MODEL_INVOCATION_FAILED", retryable: true },
    true,
  ),
  "retry-1",
);
assert.equal(
  nextNewsModelInvocation(
    "primary",
    { ambiguous: false, code: "MODEL_INVOCATION_FAILED", retryable: false },
    true,
  ),
  "fallback",
);
assert.equal(
  nextNewsModelInvocation(
    "retry-1",
    { ambiguous: false, code: "MODEL_INVOCATION_FAILED", retryable: false },
    true,
  ),
  "fallback",
);
assert.equal(
  nextNewsModelInvocation(
    "primary",
    { ambiguous: true, code: "MODEL_INVOCATION_FAILED", retryable: true },
    true,
  ),
  null,
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
assert.equal(
  unitInvocationDeadlineMs(UNIT_TOTAL_DEADLINE_MS, "primary", 0),
  UNIT_PRIMARY_DEADLINE_MS,
);
assert.equal(
  unitInvocationDeadlineMs(UNIT_TOTAL_DEADLINE_MS, "retry-1", 0),
  UNIT_REPAIR_DEADLINE_MS,
);
assert.equal(
  unitInvocationDeadlineMs(UNIT_TOTAL_DEADLINE_MS, "fallback", 85_000),
  5_000,
);
assert.equal(
  unitInvocationDeadlineMs(
    UNIT_TOTAL_DEADLINE_MS,
    "primary",
    UNIT_TOTAL_DEADLINE_MS,
  ),
  null,
);
assert.equal(unitInvocationDeadlineMs(30_000, "primary", 0), 30_000);

const aliases = [{ canonical: "btc", surfaces: ["bitcoin"] }];
const translatedGroups = resolveAnalysisTopicGroups(
  ["alpha", "beta"],
  ["beta", "alpha"],
  {
    contentLocale: "fa",
    values: ["بتا", "آلفا"],
    usedOriginalFallback: false,
  },
);

assert.deepEqual(translatedGroups, [
  { original: "alpha", effective: "آلفا" },
  { original: "beta", effective: "بتا" },
]);
assert.deepEqual(
  scoreLexicalTopic("alpha headline", "alpha headline", translatedGroups, []),
  { score: 100, index: 0 },
);
assert.deepEqual(
  scoreLexicalTopic("آلفا headline", "آلفا headline", translatedGroups, []),
  { score: 100, index: 0 },
);
assert.deepEqual(
  scoreLexicalTopic(
    "alpha headline",
    "alpha headline آلفا body",
    translatedGroups,
    [],
  ),
  { score: 100, index: 0 },
);
assert.deepEqual(
  scoreLexicalTopic("unrelated", "unrelated alpha body", translatedGroups, []),
  { score: 40, index: 0 },
);
assert.deepEqual(
  scoreLexicalTopic(
    "آلفا headline",
    "آلفا headline alpha body",
    translatedGroups,
    [],
  ),
  { score: 100, index: 0 },
);
assert.deepEqual(
  scoreLexicalTopic(
    "alpha beta headline",
    "alpha beta headline",
    translatedGroups,
    [],
  ),
  { score: 100, index: 0 },
);

const duplicateCaseGroups = resolveAnalysisTopicGroups(
  ["BTC", "btc"],
  ["btc"],
  {
    contentLocale: "fa",
    values: ["بیت کوین"],
    usedOriginalFallback: false,
  },
);
assert.deepEqual(duplicateCaseGroups, [
  { original: "BTC", effective: "بیت کوین" },
  { original: "btc", effective: "بیت کوین" },
]);
assert.deepEqual(
  scoreLexicalTopic("btc", "btc", duplicateCaseGroups, aliases),
  { score: 100, index: 0 },
);
assert.deepEqual(
  scoreLexicalTopic(
    "bitcoin",
    "bitcoin",
    [{ original: "موضوع", effective: "btc" }],
    aliases,
  ),
  { score: 0, index: null },
);
assert.deepEqual(
  scoreLexicalTopic(
    "bitcoin",
    "bitcoin",
    [{ original: "btc", effective: "موضوع" }],
    aliases,
  ),
  { score: 100, index: 0 },
);
assert.deepEqual(resolveAnalysisTopicGroups(["BTC"], ["btc"], null), [
  { original: "BTC", effective: "BTC" },
]);
assert.deepEqual(
  resolveAnalysisTopicGroups(["BTC"], ["btc"], {
    contentLocale: "fa",
    values: ["بیت کوین"],
    usedOriginalFallback: true,
  }),
  [{ original: "BTC", effective: "BTC" }],
);

assert.deepEqual(semanticTopicValues(translatedGroups, 2, 100), [
  "آلفا",
  "بتا",
]);
assert.deepEqual(
  rankFromVectors(
    [
      [1, 0],
      [1, 0],
      [0, 1],
      [0, 1],
    ],
    {
      itemIds: ["item-1"],
      topicCount: 2,
      brands: [{ mediaBrandId: "brand-1", anchorCount: 1 }],
    },
  ),
  [
    {
      sourceItemId: "item-1",
      topicScore: 100,
      topicIndex: 0,
      brandScores: [{ mediaBrandId: "brand-1", score: 0 }],
    },
  ],
);
assert.equal(SCORING_VERSION, "5");
process.stdout.write(
  "analysis run probe passed: topic groups, lexical max scoring, semantic slicing, original indexes, model recovery, semantic attempts, partial import readiness and unit deadline\n",
);
