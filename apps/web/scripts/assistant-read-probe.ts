import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import type { Locale } from "@rz-chain-reporter/i18n";
import { asSchema } from "ai";
import { z } from "zod";
import type { AccountSummary } from "../src/features/account/schemas/account";
import {
  chatInstructions,
  chatPrompt,
} from "../src/features/assistant/lib/chat-prompt";
import {
  clearHistory,
  expiresAt,
  latestPendingMarket,
  latestPendingRun,
  projectAssistantContext,
  readHistory,
  saveHistory,
} from "../src/features/assistant/lib/local-history";
import {
  initialMarketValues,
  nextMarketQuestion,
  resolveMarketToolInput,
  resolveMarketToolIntent,
} from "../src/features/assistant/lib/market-intent";
import { productHelp } from "../src/features/assistant/lib/product-help";
import {
  customerFactsOf,
  fact,
  item,
  projectAccountResult,
  projectMarketCatalogResult,
  projectMarketHistoryResult,
  projectMarketOptionsResult,
  projectPublishingResult,
  projectSavedResult,
  projectUsageResult,
  result,
} from "../src/features/assistant/lib/read-projections";
import {
  brandOptions,
  selectKnowledge,
} from "../src/features/assistant/lib/retrieval";
import {
  resolveRunIntent,
  resolveRunToolIntent,
  runAnswerPatch,
} from "../src/features/assistant/lib/run-intent";
import {
  assistantMarketToolInputSchema,
  assistantPendingMarketSchema,
  assistantRunFormLoadResponseSchema,
  assistantRunToolInputSchema,
} from "../src/features/assistant/schemas/approval";
import {
  assistantConversationContextSchema,
  assistantReadInputSchema,
  assistantReadResultSchema,
  assistantReadToolInputSchema,
  MAX_ASSISTANT_CONTEXT_BYTES,
  MAX_ASSISTANT_READ_ITEMS,
  MAX_ASSISTANT_READ_REFERENTS,
} from "../src/features/assistant/schemas/assistant-message";
import {
  type AssistantUIMessage,
  isAssistantNativeToolError,
} from "../src/features/assistant/schemas/ui-message";
import type { MarketAnalysisHistoryPage } from "../src/features/market-analysis/schemas/reads";
import type {
  PublishingHistoryRow,
  SavedHistoryRow,
} from "../src/features/publishing/schemas/history";
import {
  decodeKeysetCursor,
  keysetPageOf,
  occurredAtCursorSchema,
} from "../src/features/shared/lib/keyset-cursor";
import type {
  UsagePage,
  UsageQuery,
  UsageSummary,
} from "../src/features/usage/schemas/usage";

const repoRoot = resolve(process.cwd(), "../..");

const templateKeys = [
  "chainreporter",
  "rzwire",
  "slt-cargopay",
  "demo-sports",
] as const;
const templates = {
  chainreporter: loadCustomerTemplate(repoRoot, "chainreporter"),
  rzwire: loadCustomerTemplate(repoRoot, "rzwire"),
  "slt-cargopay": loadCustomerTemplate(repoRoot, "slt-cargopay"),
  "demo-sports": loadCustomerTemplate(repoRoot, "demo-sports"),
};

const expectedProfiles = {
  chainreporter: {
    brands: 4,
    destinations: 2,
    enabledSources: 45,
    marketAnalysis: false,
    platforms: ["telegram", "x", "instagram"],
    rss: 16,
    telegram: 29,
    totalSources: 45,
  },
  rzwire: {
    brands: 7,
    destinations: 2,
    enabledSources: 44,
    marketAnalysis: true,
    platforms: ["telegram", "x"],
    rss: 16,
    telegram: 28,
    totalSources: 45,
  },
  "slt-cargopay": {
    brands: 3,
    destinations: 2,
    enabledSources: 43,
    marketAnalysis: true,
    platforms: ["telegram", "x"],
    rss: 15,
    telegram: 28,
    totalSources: 45,
  },
  "demo-sports": {
    brands: 3,
    destinations: 2,
    enabledSources: 3,
    marketAnalysis: false,
    platforms: ["telegram", "x", "instagram"],
    rss: 2,
    telegram: 1,
    totalSources: 4,
  },
} as const;

for (const key of templateKeys) {
  const expected = expectedProfiles[key];
  const loaded = templates[key];
  assert.ok(loaded, `${key} template loaded`);
  const facts = customerFactsOf(loaded.template);
  assert.equal(facts.brands.length, expected.brands, `${key} brands`);
  assert.equal(
    facts.destinations.length,
    expected.destinations,
    `${key} destinations`,
  );
  assert.deepEqual(facts.platforms, expected.platforms, `${key} platforms`);
  assert.deepEqual(
    facts.sources,
    {
      enabled: expected.enabledSources,
      rss: expected.rss,
      telegram: expected.telegram,
      total: expected.totalSources,
    },
    `${key} sources`,
  );
  assert.equal(
    facts.marketAnalysis,
    expected.marketAnalysis,
    `${key} Market Analysis`,
  );
  assert.doesNotMatch(
    JSON.stringify(facts),
    /customer-templates|reviewed-knowledge|\.md|endpoint|secret|credential/iu,
    `${key} prompt facts contain no private path or credential shape`,
  );
}

const previousFingerprints = {
  chainreporter:
    "0f9b5f43e020f36587837bf43ae7f07dfd50a57428142f88765ee63e22ba4921",
  rzwire: "4fb6f5c05f5fffa0bcfb8be3bdf72f26ac02f5caf8b59869d2ec55f7ec09594c",
  "slt-cargopay":
    "4c0ed1122dd43b787369a7e2d348d37dcb474f4f68c292a8e8d5d52a1afd5a90",
  "demo-sports":
    "0e04fe03ad0e4e23f826e12be505cfd1bc4216d14f43e52ba3c218764aa1278c",
} as const;

for (const key of ["chainreporter", "rzwire", "slt-cargopay"] as const) {
  assert.notEqual(
    templates[key]?.fingerprint,
    previousFingerprints[key],
    `${key} reviewed correction changes its fingerprint`,
  );
}
assert.equal(
  templates["demo-sports"]?.fingerprint,
  previousFingerprints["demo-sports"],
  "reviewed-content-free Demo Sports fingerprint stays unchanged",
);

function selected(
  key: keyof typeof templates,
  locale: Locale,
  question: string,
  brandKeys: readonly string[] = [],
) {
  const loaded = templates[key];
  assert.ok(loaded, `${key} template selected`);
  return selectKnowledge({
    brands: loaded.template.mediaBrands.map((brand) => ({
      key: brand.key,
      name: brand.name,
    })),
    brandKeys,
    cardBrandKey: null,
    knowledge: loaded.reviewedKnowledge,
    locale,
    question,
  });
}

const rzwireFa = selected("rzwire", "fa", "Can RZWire publish right now?");
assert.ok(rzwireFa.faq.length > 0, "RZWire FA falls back to EN FAQ");
assert.equal(
  rzwireFa.faqSource?.locale,
  "en",
  "RZWire FA FAQ citation retains its EN source locale",
);
assert.ok(
  rzwireFa.overview.some((entry) => entry.locale === "en"),
  "RZWire FA falls back to EN workspace overview with source locale",
);
const rzwireBrandFa = selected("rzwire", "fa", "What is MGC Coin?", [
  "mgc-coin",
]);
assert.ok(
  rzwireBrandFa.matches.some((entry) => entry.locale === "en"),
  "RZWire FA falls back per named brand to available EN chat guidance",
);

const chainFa = selected(
  "chainreporter",
  "fa",
  "رسانه ChainReporter چه لحنی دارد؟",
  ["chain-reporter"],
);
assert.ok(chainFa.faq.length > 0, "ChainReporter keeps FA FAQ");
assert.equal(chainFa.faqSource?.locale, "fa", "ChainReporter cites its FA FAQ");
assert.ok(
  chainFa.overview.every((entry) => entry.locale === "fa"),
  "ChainReporter prefers FA overview",
);
assert.ok(
  chainFa.matches.some((entry) => entry.locale === "fa"),
  "ChainReporter prefers FA brand chat",
);

const demoFa = selected("demo-sports", "fa", "این محیط چه کاری انجام می‌دهد؟");
assert.deepEqual(
  {
    bibles: demoFa.bibles.length,
    faq: demoFa.faq.length,
    faqSource: demoFa.faqSource,
    matches: demoFa.matches.length,
    overview: demoFa.overview.length,
  },
  { bibles: 0, faq: 0, faqSource: null, matches: 0, overview: 0 },
  "Demo Sports does not invent reviewed knowledge",
);
assert.ok(productHelp("en").length > 0 && productHelp("fa").length > 0);
assert.match(productHelp("en").join(" "), /prepare one News or Promo run/u);
assert.match(productHelp("fa").join(" "), /یک اجرای خبر یا تبلیغاتی/u);
assert.match(productHelp("en").join(" "), /calendar-day.*not available/u);
assert.match(productHelp("fa").join(" "), /روز تقویمی.*در دسترس نیست/u);
for (const step of [
  "Editorial workflow",
  "automatic copy generation",
  "Refresh article and regenerate",
  "create a revision",
  "approve the changed revision",
  "required for Instagram",
  "Approve",
  "Market Analysis workflow",
  "Market",
  "Chart",
  "Story",
  "Design",
  "Generate",
  "Publish",
  "Generate 3 caption options",
  "Changing an upstream stage",
  "Saved \\(/saved\\) redirects to Account",
  "Usage supports rolling",
]) {
  assert.match(productHelp("en").join("\n"), new RegExp(step, "u"));
}
for (const step of [
  "روند میز تحریریه",
  "تولید خودکار متن",
  "تازه‌سازی مقاله و تولید دوباره",
  "بازبینی جدید را بسازید",
  "بازبینی تغییریافته",
  "برای اینستاگرام لازم است",
  "تأیید",
  "روند تحلیل بازار",
  "بازار",
  "نمودار",
  "روایت",
  "طراحی",
  "تولید",
  "انتشار",
  "ساخت ۳ گزینهٔ کپشن",
  "مرحلهٔ بالادستی",
  "ذخیره‌ها",
  "مصرف",
]) {
  assert.match(productHelp("fa").join("\n"), new RegExp(step, "u"));
}

const editorialHowTo = selected(
  "chainreporter",
  "fa",
  "از انتخاب یک خبر تا انتشار یا زمان‌بندی آن در تحریریه چه مراحلی را باید انجام دهم؟",
);
assert.equal(editorialHowTo.faq[0]?.key, "editorial_workflow");
assert.equal(editorialHowTo.faqSource?.locale, "fa");
const marketHowTo = selected(
  "rzwire",
  "en",
  "How do I set up a Market Analysis and move it through Market, Chart, Story, Design, Generate, and Publish?",
);
assert.equal(marketHowTo.faq[0]?.key, "market_analysis");
const usageHowTo = selected(
  "rzwire",
  "fa",
  "چطور هزینه و توکن‌های ۷ روز گذشته را در بخش مصرف بررسی کنم؟",
);
assert.equal(usageHowTo.faq[0]?.key, "usage");
assert.equal(usageHowTo.faqSource?.locale, "en");
for (const knowledge of [editorialHowTo, marketHowTo, usageHowTo]) {
  assert.ok(knowledge.overview.length > 0);
  assert.ok(
    knowledge.overview.reduce((sum, excerpt) => sum + excerpt.text.length, 0) <=
      4_000,
  );
}

const rzwireBrands = templates.rzwire?.template.mediaBrands ?? [];
assert.equal(
  brandOptions(
    rzwireBrands.map((brand) => ({ key: brand.key, name: brand.name })),
    [],
  ).length,
  4,
  "brand chooser remains bounded to four",
);

for (const period of ["24h", "7d", "30d", "all"] as const) {
  assert.equal(parseUsage({ target: "usage", period }).period, period);
}
for (const facet of ["summary", "details"] as const) {
  assert.equal(parseUsage({ target: "usage", facet }).facet, facet);
}
for (const provider of ["openrouter", "ollama", "unknown"] as const) {
  assert.equal(parseUsage({ target: "usage", provider }).provider, provider);
}
for (const rejected of [
  { target: "usage", period: "yesterday" },
  { target: "usage", start: "2026-09-06", end: "2026-09-07" },
  { target: "usage", brand: "chain-reporter" },
  { target: "usage", export: true },
  { target: "usage", budget: 100 },
  { target: "runs", scope: "recent", workspaceId: randomUUID() },
  { target: "account", userId: "another-operator" },
  { target: "card", draftId: "not-a-uuid" },
  { target: "query", sql: "select 1" },
]) {
  assert.equal(
    assistantReadInputSchema.safeParse(rejected).success,
    false,
    `read schema rejects ${JSON.stringify(rejected)}`,
  );
}
assert.equal(
  assistantReadInputSchema.safeParse({
    target: "card",
    draftId: randomUUID(),
  }).success,
  true,
);
const currentMarketAnalysisRequest = { target: "market_analysis" } as const;
const currentMarketReportRequest = { target: "market_report" } as const;
assert.deepEqual(
  assistantReadInputSchema.parse(currentMarketAnalysisRequest),
  currentMarketAnalysisRequest,
);
assert.deepEqual(
  assistantReadInputSchema.parse(currentMarketReportRequest),
  currentMarketReportRequest,
);
for (const target of ["market_analysis", "market_report"] as const) {
  const analysisId = randomUUID();
  assert.deepEqual(assistantReadInputSchema.parse({ target, analysisId }), {
    target,
    analysisId,
  });
}

const usageQuery: UsageQuery = {
  backend: null,
  cursor: null,
  model: null,
  period: "24h",
  provider: null,
  status: null,
  task: null,
};
const usageSummary: UsageSummary = {
  invocations: 20,
  models: Array.from({ length: 20 }, (_, index) => ({
    backend: index % 2 === 0 ? "remote" : "local",
    invocations: 1,
    model: `model-${index}`,
    recordedCost: "0.00000000",
    totalTokens: index,
  })),
  pendingCount: 0,
  recordedCost: "0.00000000",
  recordedInvocations: 20,
  totalTokens: 190,
  unknownCount: 0,
};
const usagePage: UsagePage = {
  newerCursor: "newer-cursor",
  offLatest: true,
  olderCursor: "older-cursor",
  rows: Array.from({ length: 20 }, (_, index) => ({
    backend: "remote" as const,
    completionTokens: index,
    cost: "0.00000000",
    costAuthority: "billed_openrouter" as const,
    id: randomUUID(),
    invocationKey: "primary" as const,
    occurredAt: new Date(1_700_000_000_000 + index),
    promptTokens: index,
    provider: "openrouter" as const,
    requestedModel: `requested-${index}`,
    resolvedModel: `resolved-${index}`,
    status: "succeeded" as const,
    taskKey: `task-${index}`,
    totalTokens: index * 2,
  })),
};
const usageTimeZone = templates.chainreporter.template.customer.timeZone;
const summaryResult = projectUsageResult(
  { facet: "summary", period: "24h", target: "usage" },
  { page: usagePage, query: usageQuery, summary: usageSummary },
  usageTimeZone,
);
assert.equal(summaryResult.items.length, 20);
assert.equal(summaryResult.cursors, null);
assert.ok(summaryResult.items.every((entry) => entry.id.startsWith("model:")));
const detailsResult = projectUsageResult(
  { facet: "details", period: "24h", target: "usage" },
  { page: usagePage, query: usageQuery, summary: usageSummary },
  usageTimeZone,
);
assert.equal(
  detailsResult.items.length,
  20,
  "complete Usage owner page retained",
);
assert.deepEqual(detailsResult.cursors, {
  newer: "newer-cursor",
  older: "older-cursor",
});
assert.deepEqual(
  detailsResult.items.map((entry) => entry.id),
  usagePage.rows.map((row) => row.id),
  "model breakdown never displaces paged Usage details",
);

const catalogResult = projectMarketCatalogResult({
  entries: Array.from({ length: 25 }, (_, index) => ({
    baseAsset: `BASE${index}`,
    canonicalIdentity: `catalog-${index}`,
    displayName: `Catalog ${index}`,
    quoteAsset: "USDT",
    symbol: `BASE${index}USDT`,
  })),
  lastSuccessAt: new Date(1_700_000_000_000),
});
assert.equal(catalogResult.items.length, 20, "Market catalog is bounded");
assert.equal(
  catalogResult.facts.find((fact) => fact.key === "comparisons")?.value,
  "25",
);
assert.equal(
  catalogResult.facts.find((fact) => fact.key === "returned")?.value,
  "20",
);

const accountSummary: AccountSummary = {
  brands: Array.from({ length: MAX_ASSISTANT_READ_ITEMS + 1 }, (_, index) => ({
    generatedDrafts: index,
    key: `brand-${index}`,
    name: `Brand ${index}`,
    saved: index,
    scheduled: index,
  })),
  generatedDrafts: 210,
  saved: 210,
  scheduled: 210,
};
const accountResult = projectAccountResult(
  {
    createdAt: new Date(1_700_000_000_000),
    email: "operator@example.test",
    name: "Operator",
  },
  accountSummary,
);
assert.equal(accountResult.items.length, MAX_ASSISTANT_READ_ITEMS);
assert.equal(
  accountResult.facts.find((fact) => fact.key === "brands")?.value,
  "21",
);
assert.equal(
  accountResult.facts.find((fact) => fact.key === "returned")?.value,
  "20",
);

const marketOptionsResult = projectMarketOptionsResult({
  enabledPeriods: ["24h"],
  enabledScales: ["absolute"],
  instruments: Array.from(
    { length: MAX_ASSISTANT_READ_ITEMS + 1 },
    (_, index) => ({
      icon: { height: 32, url: `/market-icon-${index}`, width: 32 },
      id: randomUUID(),
      key: `instrument-${index}`,
      name: `Instrument ${index}`,
      symbol: `TOKEN${index}`,
    }),
  ),
  outputFormat: "square",
});
assert.equal(marketOptionsResult.items.length, MAX_ASSISTANT_READ_ITEMS);
assert.equal(
  marketOptionsResult.facts.find((fact) => fact.key === "instruments")?.value,
  "21",
);
assert.equal(
  marketOptionsResult.facts.find((fact) => fact.key === "returned")?.value,
  "20",
);

const publishingRows: PublishingHistoryRow[] = Array.from(
  { length: 26 },
  (_, index) => ({
    activityStatus: "not_due",
    body: `Body ${index}`,
    brandKey: `brand-${index}`,
    brandName: `Brand ${index}`,
    contentLocale: "en",
    destinationAccountId: randomUUID(),
    destinationKey: `destination-${index}`,
    destinationLabel: `Destination ${index}`,
    eligibleDestinations: [],
    evidenceCheckpointId: null,
    evidenceCheckpointKind: null,
    hasImage: false,
    headline: `Headline ${index}`,
    id: randomUUID(),
    lifecycle: "scheduled",
    occurredAt: new Date(1_700_000_000_000 - index * 1_000),
    operationId: null,
    platform: "telegram",
    platformDraftId: randomUUID(),
    providerResultId: null,
    publicationId: randomUUID(),
    publicationVersion: 1,
    reconciledAt: null,
    reconciliationAuthority: null,
    reconciliationDecision: null,
    revisionNumber: 1,
    scheduleId: randomUUID(),
    timezone: "Asia/Tehran",
    unresolvedAttemptId: null,
    version: 1,
  }),
);
const publishingCursorOf = (
  row: PublishingHistoryRow,
  direction: "older" | "newer",
) => ({ direction, id: row.id, occurredAt: row.occurredAt.toISOString() });
const firstPublishingPage = keysetPageOf({
  raw: publishingRows,
  pageSize: MAX_ASSISTANT_READ_ITEMS,
  cursor: null,
  toCursor: publishingCursorOf,
});
const firstPublishingOlderCursor = decodeKeysetCursor(
  occurredAtCursorSchema,
  firstPublishingPage.olderCursor,
);
assert.equal(
  firstPublishingOlderCursor?.id,
  publishingRows[MAX_ASSISTANT_READ_ITEMS - 1]?.id,
  "assistant Publishing cursor anchors the twentieth row",
);
const secondPublishingPage = keysetPageOf({
  raw: publishingRows.filter(
    (row) =>
      firstPublishingOlderCursor !== null &&
      row.occurredAt.toISOString() < firstPublishingOlderCursor.occurredAt,
  ),
  pageSize: MAX_ASSISTANT_READ_ITEMS,
  cursor: firstPublishingOlderCursor,
  toCursor: publishingCursorOf,
});
assert.equal(
  secondPublishingPage.ordered[0]?.id,
  publishingRows[MAX_ASSISTANT_READ_ITEMS]?.id,
  "the next assistant Publishing page starts at row twenty-one",
);
assert.deepEqual(
  [...firstPublishingPage.ordered, ...secondPublishingPage.ordered].map(
    (row) => row.id,
  ),
  publishingRows.map((row) => row.id),
  "assistant Publishing keyset paging has no gap or duplicate",
);
const manualPublishingPage = keysetPageOf({
  raw: publishingRows,
  pageSize: 25,
  cursor: null,
  toCursor: publishingCursorOf,
});
const manualPublishingOlderCursor = decodeKeysetCursor(
  occurredAtCursorSchema,
  manualPublishingPage.olderCursor,
);
assert.equal(manualPublishingPage.ordered.length, 25);
assert.equal(
  manualPublishingOlderCursor?.id,
  publishingRows[24]?.id,
  "manual Publishing cursor remains anchored to row twenty-five",
);
const { ordered: firstPublishingRows, ...firstPublishingCursors } =
  firstPublishingPage;
const publishingResult = projectPublishingResult("scheduled", null, {
  installationTimeZone: "Asia/Tehran",
  page: { ...firstPublishingCursors, rows: firstPublishingRows },
});
assert.equal(publishingResult.items.length, MAX_ASSISTANT_READ_ITEMS);
assert.throws(
  () =>
    projectPublishingResult("scheduled", null, {
      installationTimeZone: "Asia/Tehran",
      page: {
        newerCursor: null,
        olderCursor: null,
        rows: publishingRows.slice(0, MAX_ASSISTANT_READ_ITEMS + 1),
      },
    }),
  "the production Publishing projection rejects twenty-one assistant items",
);

const savedRows: SavedHistoryRow[] = Array.from({ length: 26 }, (_, index) => ({
  approved: false,
  body: `Body ${index}`,
  brandKey: `brand-${index}`,
  brandName: `Brand ${index}`,
  contentLocale: "en",
  discardedAt: null,
  executionScope: { analysisRunId: randomUUID(), kind: "analysis_run" },
  hasImage: false,
  headline: `Headline ${index}`,
  id: randomUUID(),
  originTitle: `Origin ${index}`,
  platform: "telegram",
  platformDraftId: randomUUID(),
  revisionNumber: 1,
  savedAt: new Date(1_700_000_000_000 - index * 1_000),
  version: 1,
}));
const savedCursorOf = (row: SavedHistoryRow, direction: "older" | "newer") => ({
  direction,
  id: row.id,
  occurredAt: row.savedAt.toISOString(),
});
const firstSavedPage = keysetPageOf({
  raw: savedRows,
  pageSize: MAX_ASSISTANT_READ_ITEMS,
  cursor: null,
  toCursor: savedCursorOf,
});
const firstSavedOlderCursor = decodeKeysetCursor(
  occurredAtCursorSchema,
  firstSavedPage.olderCursor,
);
assert.equal(
  firstSavedOlderCursor?.id,
  savedRows[MAX_ASSISTANT_READ_ITEMS - 1]?.id,
  "assistant Saved cursor anchors the twentieth row",
);
const secondSavedPage = keysetPageOf({
  raw: savedRows.filter(
    (row) =>
      firstSavedOlderCursor !== null &&
      row.savedAt.toISOString() < firstSavedOlderCursor.occurredAt,
  ),
  pageSize: MAX_ASSISTANT_READ_ITEMS,
  cursor: firstSavedOlderCursor,
  toCursor: savedCursorOf,
});
assert.equal(
  secondSavedPage.ordered[0]?.id,
  savedRows[MAX_ASSISTANT_READ_ITEMS]?.id,
  "the next assistant Saved page starts at row twenty-one",
);
assert.deepEqual(
  [...firstSavedPage.ordered, ...secondSavedPage.ordered].map((row) => row.id),
  savedRows.map((row) => row.id),
  "assistant Saved keyset paging has no gap or duplicate",
);
const manualSavedPage = keysetPageOf({
  raw: savedRows,
  pageSize: 25,
  cursor: null,
  toCursor: savedCursorOf,
});
const manualSavedOlderCursor = decodeKeysetCursor(
  occurredAtCursorSchema,
  manualSavedPage.olderCursor,
);
assert.equal(manualSavedPage.ordered.length, 25);
assert.equal(
  manualSavedOlderCursor?.id,
  savedRows[24]?.id,
  "manual Saved cursor remains anchored to row twenty-five",
);
const { ordered: firstSavedRows, ...firstSavedCursors } = firstSavedPage;
const savedResult = projectSavedResult("active", null, {
  ...firstSavedCursors,
  rows: firstSavedRows,
});
assert.equal(savedResult.items.length, MAX_ASSISTANT_READ_ITEMS);
assert.throws(
  () =>
    projectSavedResult("active", null, {
      newerCursor: null,
      olderCursor: null,
      rows: savedRows.slice(0, MAX_ASSISTANT_READ_ITEMS + 1),
    }),
  "the production Saved projection rejects twenty-one assistant items",
);

const marketHistoryRows: MarketAnalysisHistoryPage["rows"] = Array.from(
  { length: MAX_ASSISTANT_READ_ITEMS + 1 },
  (_, index) => ({
    completedAt: new Date(1_700_000_000_000 - index * 1_000),
    contentLocale: index % 2 === 0 ? "en" : "fa",
    currentFinalMediaAssetId: null,
    currentOperationIds: [],
    id: randomUUID(),
    period: "24h",
    scale: "absolute",
    stage: "publish",
    status: "completed",
    symbols: `TOKEN${index}/USDT`,
    updatedAt: new Date(1_700_000_000_000 - index * 1_000),
    version: 1,
    visualOwnerName: `Token ${index}`,
  }),
);
const marketHistoryCursorSchema = z.strictObject({
  direction: z.enum(["older", "newer"]),
  id: z.uuid(),
  updatedAt: z.iso.datetime(),
});
const marketCursorOf = (
  row: MarketAnalysisHistoryPage["rows"][number],
  direction: "older" | "newer",
) => ({ direction, id: row.id, updatedAt: row.updatedAt.toISOString() });
const firstMarketPage = keysetPageOf({
  raw: marketHistoryRows,
  pageSize: MAX_ASSISTANT_READ_ITEMS,
  cursor: null,
  toCursor: marketCursorOf,
});
assert.equal(firstMarketPage.ordered.length, MAX_ASSISTANT_READ_ITEMS);
const firstMarketOlderCursor = decodeKeysetCursor(
  marketHistoryCursorSchema,
  firstMarketPage.olderCursor,
);
assert.equal(
  firstMarketOlderCursor?.id,
  marketHistoryRows[MAX_ASSISTANT_READ_ITEMS - 1]?.id,
  "assistant Market cursor anchors the twentieth row",
);
const secondMarketPage = keysetPageOf({
  raw: marketHistoryRows.filter(
    (row) =>
      firstMarketOlderCursor !== null &&
      row.updatedAt.toISOString() < firstMarketOlderCursor.updatedAt,
  ),
  pageSize: MAX_ASSISTANT_READ_ITEMS,
  cursor: firstMarketOlderCursor,
  toCursor: marketCursorOf,
});
assert.equal(
  secondMarketPage.ordered[0]?.id,
  marketHistoryRows[MAX_ASSISTANT_READ_ITEMS]?.id,
  "the next assistant Market page starts at row twenty-one",
);
assert.deepEqual(
  [...firstMarketPage.ordered, ...secondMarketPage.ordered].map(
    (row) => row.id,
  ),
  marketHistoryRows.map((row) => row.id),
  "assistant Market keyset paging has no gap or duplicate",
);
const { ordered: firstMarketHistoryRows, ...firstMarketHistoryCursors } =
  firstMarketPage;
const marketHistoryPage = {
  ...firstMarketHistoryCursors,
  rows: firstMarketHistoryRows,
};
const marketHistoryResult = projectMarketHistoryResult(marketHistoryPage, null);
assert.equal(marketHistoryResult.items.length, MAX_ASSISTANT_READ_ITEMS);
assert.equal(marketHistoryResult.href, "/market-analysis?view=history");
assert.throws(
  () =>
    projectMarketHistoryResult(
      {
        newerCursor: null,
        offLatest: false,
        olderCursor: null,
        rows: marketHistoryRows,
      },
      null,
    ),
  "the production Market projection rejects twenty-one assistant items",
);

const priorRunId = randomUUID();
const priorReadResult = result("runs", "/dashboard", {
  items: [
    item(priorRunId, priorRunId, {
      href: `/dashboard?run=${priorRunId}`,
      status: "completed",
    }),
  ],
});
const repeatedItemId = randomUUID();
const repeatedReadResult = result("runs", "/dashboard", {
  items: [
    item(repeatedItemId, "First model lane"),
    item(repeatedItemId, "Second model lane"),
  ],
});
assert.deepEqual(
  repeatedReadResult.items.map((entry) => entry.id),
  [repeatedItemId, repeatedItemId],
  "read snapshots preserve every row without replacing canonical item IDs",
);
assert.equal(
  new Set(
    repeatedReadResult.items.map(
      (entry, itemIndex) => `${entry.id}:${itemIndex}`,
    ),
  ).size,
  repeatedReadResult.items.length,
  "snapshot-local row keys disambiguate repeated canonical item IDs",
);
const currentRunId = randomUUID();
const currentRunHref = `/dashboard?run=${currentRunId}`;
const editorialSelectionId = randomUUID();
const promoIdeaId = randomUUID();
const telegramFilterResultId = randomUUID();
const linkedDraftId = randomUUID();
const currentRunResult = result("run", currentRunHref, {
  items: [
    item(editorialSelectionId, "First selection", {
      facts: [fact("kind", "selection")],
    }),
    item(promoIdeaId, "First promo", {
      facts: [fact("kind", "promo")],
    }),
    item(telegramFilterResultId, "First Telegram card", {
      facts: [fact("kind", "telegram")],
    }),
    item(randomUUID(), "Source row", { facts: [fact("kind", "source")] }),
    item(randomUUID(), "Lane row", { facts: [fact("kind", "lane")] }),
    item("not-a-uuid", "Invalid selector", {
      facts: [fact("kind", "selection")],
    }),
    item(linkedDraftId, "Existing draft", {
      href: `/drafts/${linkedDraftId}`,
    }),
  ],
});
const selectorContextMessages = [
  {
    id: "selector-user",
    role: "user",
    metadata: { createdAt: 1 },
    parts: [{ type: "text", text: "Show this run" }],
  },
  {
    id: "selector-assistant",
    role: "assistant",
    metadata: { createdAt: 2 },
    parts: [
      {
        type: "tool-read_workspace",
        toolCallId: "selector-read",
        state: "output-available",
        input: { request: { target: "run" } },
        output: currentRunResult,
      },
    ],
  },
  {
    id: "selector-current-user",
    role: "user",
    metadata: { createdAt: 3 },
    parts: [{ type: "text", text: "Route the first item" }],
  },
] satisfies AssistantUIMessage[];
const selectorContext = projectAssistantContext(selectorContextMessages);
assert.deepEqual(selectorContext.referents, [
  {
    kind: "run",
    id: linkedDraftId,
    title: "Existing draft",
    href: `/drafts/${linkedDraftId}`,
  },
  {
    kind: "run",
    id: currentRunId,
    title: currentRunId,
    href: currentRunHref,
  },
  {
    kind: "run",
    id: editorialSelectionId,
    title: "First selection",
    href: currentRunHref,
    origin: {
      kind: "editorial_selection",
      editorialSelectionId,
    },
  },
  {
    kind: "run",
    id: promoIdeaId,
    title: "First promo",
    href: currentRunHref,
    origin: { kind: "promo_idea", promoIdeaId },
  },
  {
    kind: "run",
    id: telegramFilterResultId,
    title: "First Telegram card",
    href: currentRunHref,
    origin: {
      kind: "telegram_filter_result",
      telegramFilterResultId,
    },
  },
]);
assert.equal(
  assistantConversationContextSchema.safeParse(selectorContext).success,
  true,
);
assert.doesNotMatch(
  JSON.stringify(selectorContext),
  /Source row|Lane row|Invalid selector/u,
);
const earliestSelectionIds = Array.from({ length: 8 }, () => randomUUID());
const boundedSelectorContext = projectAssistantContext([
  {
    id: "bounded-selector-assistant",
    role: "assistant",
    metadata: { createdAt: 1 },
    parts: [
      {
        type: "tool-read_workspace",
        toolCallId: "bounded-selector-read",
        state: "output-available",
        input: { request: { target: "run" } },
        output: result("run", currentRunHref, {
          items: earliestSelectionIds.map((id, index) =>
            item(id, `Selection ${index + 1}`, {
              facts: [fact("kind", "selection")],
            }),
          ),
        }),
      },
    ],
  },
]);
assert.equal(
  boundedSelectorContext.referents.length,
  MAX_ASSISTANT_READ_REFERENTS,
);
assert.deepEqual(
  boundedSelectorContext.referents.map((referent) => referent.id),
  [currentRunId, ...earliestSelectionIds.slice(0, 5)],
  "the root run and earliest output-ordered unrouted candidates survive the bound",
);
assert.ok(
  new TextEncoder().encode(JSON.stringify(boundedSelectorContext)).byteLength <=
    MAX_ASSISTANT_CONTEXT_BYTES,
);
const contextMessages = [
  {
    id: "prior-user",
    role: "user",
    metadata: { createdAt: 1 },
    parts: [{ type: "text", text: "Show my previous runs" }],
  },
  {
    id: "prior-assistant",
    role: "assistant",
    metadata: { createdAt: 2 },
    parts: [
      { type: "text", text: "The requested records are shown in the card." },
      {
        type: "tool-read_workspace",
        toolCallId: "read-call",
        state: "output-available",
        input: { request: { target: "runs", scope: "recent" } },
        output: priorReadResult,
      },
      {
        type: "tool-start_run",
        toolCallId: "start-call",
        state: "approval-requested",
        input: { kind: "promo", promoText: "private effect payload" },
        approval: { id: "approval-id", signature: "probe-signature" },
      },
      {
        type: "data-run-intent",
        data: {
          intent: { kind: "promo", promoText: "private pending intent" },
          question: null,
          toolCallId: "start-call",
        },
      },
      {
        type: "data-run-result",
        data: {
          status: "created",
          analysisRunId: randomUUID(),
          operationId: randomUUID(),
          href: `/dashboard?run=${randomUUID()}`,
          toolCallId: "start-call",
        },
      },
    ],
  },
  {
    id: "current-user",
    role: "user",
    metadata: { createdAt: 3 },
    parts: [{ type: "text", text: "Show its report" }],
  },
] satisfies AssistantUIMessage[];
const projectedContext = projectAssistantContext(contextMessages);
assert.deepEqual(projectedContext.turns, [
  { role: "user", text: "Show my previous runs" },
  {
    role: "assistant",
    text: "The requested records are shown in the card.",
  },
]);
assert.deepEqual(projectedContext.referents, [
  {
    kind: "runs",
    id: priorRunId,
    title: priorRunId,
    href: `/dashboard?run=${priorRunId}`,
  },
]);
assert.doesNotMatch(
  JSON.stringify(projectedContext),
  /start-call|approval-id|private effect payload|private pending intent/u,
);
assert.equal(
  assistantConversationContextSchema.safeParse(projectedContext).success,
  true,
);
const toolInputError = {
  type: "tool-input-error",
  toolCallId: "input-error",
  toolName: "read_workspace",
  input: { private: "native input" },
  errorText: "native input error",
} as const;
const toolOutputError = {
  type: "tool-output-error",
  toolCallId: "output-error",
  errorText: "native output error",
} as const;
assert.equal(isAssistantNativeToolError(toolInputError), true);
assert.equal(isAssistantNativeToolError(toolOutputError), true);
assert.equal(
  isAssistantNativeToolError({
    type: "tool-input-available",
    toolCallId: "available",
    toolName: "read_workspace",
    input: {},
  }),
  false,
);
assert.equal(
  isAssistantNativeToolError({ type: "error", errorText: "top-level" }),
  false,
);

verifyStoredHistory();

function verifyStoredHistory() {
  const storedValues = new Map<string, string>();
  const testStorage: Storage = {
    get length() {
      return storedValues.size;
    },
    clear: () => storedValues.clear(),
    getItem: (key) => storedValues.get(key) ?? null,
    key: (index) => [...storedValues.keys()][index] ?? null,
    removeItem: (key) => storedValues.delete(key),
    setItem: (key, value) => storedValues.set(key, value),
  };
  const localStorageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: testStorage,
  });
  try {
    verifyRunIntentHistory();
    verifyMarketIntentHistory();
    const selectorHistoryKey = "assistant-origin-referents";
    saveHistory(selectorHistoryKey, selectorContextMessages);
    assert.ok((expiresAt(selectorHistoryKey) ?? 0) > Date.now());
    assert.deepEqual(
      projectAssistantContext(readHistory(selectorHistoryKey)).referents,
      selectorContext.referents,
    );
    clearHistory(selectorHistoryKey);
    assert.deepEqual(readHistory(selectorHistoryKey), []);
    assert.equal(expiresAt(selectorHistoryKey), null);

    const historyKey = "assistant-safe-failure";
    saveHistory(historyKey, [
      {
        id: "failed-request",
        role: "user",
        metadata: { createdAt: 3 },
        parts: [{ type: "text", text: "Prepare the requested change" }],
      },
      {
        id: "failed-assistant",
        role: "assistant",
        metadata: { createdAt: 4 },
        parts: [
          { type: "text", text: "The change is prepared." },
          { type: "data-response-error", data: true },
          {
            type: "tool-read_workspace",
            toolCallId: "native-error",
            state: "output-error",
            input: undefined,
            rawInput: { private: "native input payload" },
            errorText: "native error payload",
          },
        ],
      },
    ]);
    const restoredFailure = readHistory(historyKey);
    assert.equal(restoredFailure.length, 2);
    assert.deepEqual(restoredFailure[0]?.parts, [
      { type: "text", text: "Prepare the requested change" },
    ]);
    assert.deepEqual(restoredFailure[1]?.parts, [
      { type: "data-response-error", data: true },
    ]);
    assert.doesNotMatch(
      storedValues.get(historyKey) ?? "",
      /The change is prepared|native input payload|native error payload/u,
    );
    assert.deepEqual(
      projectAssistantContext([
        ...restoredFailure,
        {
          id: "current-after-failure",
          role: "user",
          metadata: { createdAt: 5 },
          parts: [{ type: "text", text: "Try again" }],
        },
      ]),
      {
        turns: [{ role: "user", text: "Prepare the requested change" }],
        referents: [],
      },
    );
  } finally {
    if (localStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", localStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  }
}

function verifyMarketIntentHistory() {
  const firstId = randomUUID();
  const secondId = randomUUID();
  const instruments = [
    { id: firstId, key: "first", name: "First", symbol: "ONE" },
    { id: secondId, key: "second", name: "Second", symbol: "TWO" },
  ];
  const toolInput = assistantMarketToolInputSchema.parse({
    action: "create",
    primaryInstrumentRefs: ["ONE"],
    comparisonCatalogIdentities: ["binance:OLDUSDT"],
    period: "7d",
  });
  const originalInput = JSON.stringify(toolInput);
  const corrected = assistantPendingMarketSchema.parse({
    intent: toolInput,
    question: "contentLocale",
    values: {
      primaryInstrumentIds: [secondId],
      brandingInstrumentId: secondId,
      comparisonCatalogIdentities: [],
      period: "30d",
      scale: "relative",
      outputFormat: "square",
    },
  });
  saveHistory("assistant-market-correction", [
    {
      id: "market-correction",
      role: "assistant",
      parts: [
        {
          type: "tool-market_action",
          toolCallId: "corrected-market",
          state: "approval-requested",
          input: toolInput,
          approval: { id: "approval", signature: "signature" },
        },
        {
          type: "data-market-intent",
          data: { ...corrected, toolCallId: "corrected-market" },
        },
      ],
    },
  ]);
  const restored = readHistory("assistant-market-correction")[0];
  assert.ok(restored);
  const retained = restored.parts.find(
    (part) =>
      part.type === "data-market-intent" &&
      part.data.toolCallId === "corrected-market",
  );
  assert.ok(retained?.type === "data-market-intent");
  const resumedIntent = resolveMarketToolIntent({
    pendingMarket: null,
    retainedMarket: retained.data,
    toolInput,
  });
  const resolved = resolveMarketToolInput(resumedIntent, instruments);
  assert.ok(resolved.input);
  const resumedValues = initialMarketValues(
    resolved.input,
    retained.data.values,
  );
  assert.equal(
    resumedValues.period,
    "30d",
    "restored Market period stays corrected",
  );
  assert.deepEqual(resumedValues.primaryInstrumentIds, [secondId]);
  assert.deepEqual(resumedValues.comparisonCatalogIdentities, []);
  assert.equal(nextMarketQuestion(resumedValues), "contentLocale");
  const pending = { ...retained.data, values: resumedValues };
  const continued = resolveMarketToolIntent({
    pendingMarket: pending,
    retainedMarket: null,
    toolInput: { action: "create", contentLocale: "fa" },
  });
  assert.equal(
    continued.period,
    "30d",
    "new invocation preserves omitted corrections",
  );
  assert.equal(continued.contentLocale, "fa");
  const patched = resolveMarketToolIntent({
    pendingMarket: pending,
    retainedMarket: null,
    toolInput: {
      action: "create",
      period: "7d",
      primaryInstrumentRefs: ["ONE"],
    },
  });
  assert.equal(
    patched.period,
    "7d",
    "new invocation can replace corrected period",
  );
  assert.equal(patched.primaryInstrumentIds, undefined);
  assert.deepEqual(
    resolveMarketToolInput(patched, instruments).input?.primaryInstrumentIds,
    [firstId],
  );
  const older = resolveMarketToolIntent({
    pendingMarket: { ...pending, intent: patched, values: { period: "7d" } },
    retainedMarket: retained.data,
    toolInput,
  });
  assert.equal(older.period, "30d", "each Market tool owns its corrections");
  const stale = resolveMarketToolInput(resumedIntent, instruments.slice(0, 1));
  assert.equal(stale.input, null);
  assert.equal(stale.question, "primaryInstrumentIds");
  const refreshedValues = initialMarketValues(
    stale.input,
    { ...resumedValues, contentLocale: "fa" },
    stale.question,
  );
  assert.equal(refreshedValues.primaryInstrumentIds, undefined);
  assert.equal(refreshedValues.brandingInstrumentId, undefined);
  assert.equal(refreshedValues.period, "30d");
  assert.deepEqual(refreshedValues.comparisonCatalogIdentities, []);
  assert.equal(
    nextMarketQuestion(refreshedValues),
    "primaryInstrumentIds",
    "a removed primary is requested again instead of previewing stale values",
  );
  const reselection = initialMarketValues(
    { action: "create", primaryInstrumentIds: [firstId] },
    refreshedValues,
  );
  assert.equal(reselection.brandingInstrumentId, firstId);
  assert.equal(nextMarketQuestion(reselection), null);
  assert.equal(
    JSON.stringify(toolInput),
    originalInput,
    "signed Market input stays unchanged",
  );
  for (const reason of [undefined, "cancel", "edit"] as const) {
    saveHistory("assistant-market-correction", [
      {
        ...restored,
        parts: [
          ...restored.parts,
          {
            type: "data-market-superseded",
            data: { toolCallId: "corrected-market", reason },
          },
        ],
      },
    ]);
    const restoredEdit = readHistory("assistant-market-correction");
    assert.deepEqual(
      latestPendingMarket(restoredEdit),
      reason === "edit" ? corrected : null,
      "Market Edit survives reload; Cancel and legacy markers clear continuation",
    );
    assert.ok(
      restoredEdit[0]?.parts.some(
        (part) => part.type === "data-market-superseded",
      ),
    );
  }
  const marketEdit = readHistory("assistant-market-correction")[0];
  assert.ok(marketEdit);
  saveHistory("assistant-market-correction", [
    {
      ...marketEdit,
      parts: [
        ...marketEdit.parts,
        {
          type: "data-market-result",
          data: {
            action: "create",
            analysisId: randomUUID(),
            operationId: randomUUID(),
            status: "queued",
            href: "/market-analysis",
            toolCallId: "corrected-market",
            version: 1,
          },
        },
      ],
    },
  ]);
  assert.equal(
    latestPendingMarket(readHistory("assistant-market-correction")),
    null,
  );
  clearHistory("assistant-market-correction");
}

function verifyRunIntentHistory() {
  const form = assistantRunFormLoadResponseSchema.parse({
    status: "loaded",
    options: {
      models: [
        { key: "model", name: "Model", vendor: null },
        { key: "second-model", name: "Second Model", vendor: null },
      ],
      brands: [
        {
          key: "not-promo",
          name: "News only",
          logo: null,
          promoEnabled: false,
        },
        { key: "allowed", name: "Allowed", logo: null, promoEnabled: true },
        { key: "second", name: "Second", logo: null, promoEnabled: true },
      ],
      platforms: ["telegram"],
      defaults: {
        brands: ["allowed"],
        models: ["model"],
        platforms: ["telegram"],
        windowHours: 24,
        enrichment: false,
        sourceKeys: [],
        orderingMode: "keywords",
        topN: 5,
      },
      bounds: {
        brandKeys: ["allowed", "second"],
        modelKeys: ["model", "second-model"],
        platforms: ["telegram"],
        selectionCap: 5,
        shortlistCap: 5,
        promoPromptMaxChars: 4000,
        semanticMaxChars: 500,
        semanticMaxTopics: 20,
        fanOutMaxUnits: 20,
      },
      windowHours: [24, 48],
      recentTopics: [],
      previousRun: null,
    },
    sources: [
      {
        id: "00000000-0000-4000-8000-000000000001",
        key: "rss",
        name: "RSS",
        origin: "rss",
        lifecycle: "enabled",
      },
    ],
  });
  const toolInput = assistantRunToolInputSchema.parse({
    kind: "promo",
    brandKeys: ["not-promo"],
  });
  const originalInput = JSON.stringify(toolInput);
  const initial = resolveRunToolIntent({
    form,
    pendingRun: null,
    retainedRun: null,
    toolInput,
  });
  assert.equal(initial.question, "promoBrands");
  const corrected = resolveRunIntent(
    initial.pendingRun.intent,
    runAnswerPatch("promoBrands", "allowed", initial.pendingRun.intent, form),
    form,
  );
  assert.equal(corrected.question, "promoText");
  saveHistory("assistant-run-correction", [
    {
      id: "run-correction",
      role: "assistant",
      parts: [
        {
          type: "tool-start_run",
          toolCallId: "corrected-run",
          state: "approval-requested",
          input: toolInput,
          approval: { id: "approval", signature: "signature" },
        },
        {
          type: "data-run-intent",
          data: { ...corrected.pendingRun, toolCallId: "corrected-run" },
        },
      ],
    },
  ]);
  const restored = readHistory("assistant-run-correction")[0];
  assert.ok(restored);
  const retained = restored.parts.find(
    (part) =>
      part.type === "data-run-intent" &&
      part.data.toolCallId === "corrected-run",
  );
  assert.ok(retained?.type === "data-run-intent");
  const resumed = resolveRunToolIntent({
    form,
    pendingRun: null,
    retainedRun: retained.data,
    toolInput,
  });
  assert.equal(resumed.question, "promoText");
  assert.deepEqual(
    resumed.pendingRun.intent.brandKeys,
    ["allowed"],
    "restored tool keeps its corrected brand",
  );
  const completed = resolveRunIntent(
    resumed.pendingRun.intent,
    runAnswerPatch("promoText", "Launch", resumed.pendingRun.intent, form),
    form,
  );
  assert.equal(completed.configuration?.kind, "promo");
  assert.deepEqual(completed.pendingRun.intent.brandKeys, ["allowed"]);
  const followup = resolveRunToolIntent({
    form,
    pendingRun: completed.pendingRun,
    retainedRun: null,
    toolInput: {
      kind: "promo",
      brandKeys: ["second"],
      promoText: "Updated launch",
    },
  });
  assert.deepEqual(
    followup.pendingRun.intent.brandKeys,
    ["second"],
    "new tool input overrides the preceding tool's intent",
  );
  assert.equal(followup.pendingRun.intent.promoText, "Updated launch");
  const resetPromo = resolveRunToolIntent({
    form,
    pendingRun: followup.pendingRun,
    retainedRun: null,
    toolInput: { useDefaults: true },
  });
  assert.equal(resetPromo.pendingRun.intent.kind, "promo");
  assert.deepEqual(
    resetPromo.pendingRun.intent.brandKeys,
    form.options.defaults.brands,
  );
  assert.equal(resetPromo.pendingRun.intent.promoText, undefined);
  assert.equal(resetPromo.question, "promoText");
  const resetOverride = resolveRunToolIntent({
    form,
    pendingRun: followup.pendingRun,
    retainedRun: null,
    toolInput: {
      useDefaults: true,
      brandKeys: ["second"],
      promoText: "Explicit launch",
    },
  });
  assert.deepEqual(resetOverride.pendingRun.intent.brandKeys, ["second"]);
  assert.equal(resetOverride.pendingRun.intent.promoText, "Explicit launch");
  const olderTool = resolveRunToolIntent({
    form,
    pendingRun: followup.pendingRun,
    retainedRun: retained.data,
    toolInput,
  });
  assert.deepEqual(
    olderTool.pendingRun.intent.brandKeys,
    ["allowed"],
    "each tool retains its own correction",
  );
  assert.equal(
    JSON.stringify(toolInput),
    originalInput,
    "signed tool input is never rewritten",
  );

  const newsInput = assistantRunToolInputSchema.parse({
    kind: "news",
    sourceMode: "owner_defaults",
    orderingMode: "keywords",
  });
  const news = resolveRunToolIntent({
    form,
    pendingRun: null,
    retainedRun: null,
    toolInput: newsInput,
  });
  assert.equal(news.question, "sources");
  const selectedSources = resolveRunIntent(
    news.pendingRun.intent,
    runAnswerPatch("sources", "all_enabled", news.pendingRun.intent, form),
    form,
  );
  assert.equal(selectedSources.question, "topics");
  assert.deepEqual(
    runAnswerPatch("sources", "tampered", news.pendingRun.intent, form),
    {},
    "unknown source choices do not reach run intent",
  );
  const restoredSources = resolveRunToolIntent({
    form,
    pendingRun: null,
    retainedRun: selectedSources.pendingRun,
    toolInput: newsInput,
  });
  assert.equal(restoredSources.question, "topics");
  assert.deepEqual(
    restoredSources.pendingRun.intent.sourceIds,
    [form.sources[0]?.id],
    "restored tool keeps corrected sources instead of reapplying original defaults",
  );
  const resetNews = resolveRunToolIntent({
    form,
    pendingRun: {
      question: null,
      intent: {
        ...restoredSources.pendingRun.intent,
        brandKeys: ["second"],
        modelKeys: ["obsolete"],
        platforms: ["x"],
        topics: ["old topic"],
        topN: 1,
        enrichmentEnabled: true,
      },
    },
    retainedRun: null,
    toolInput: { useDefaults: true },
  });
  assert.equal(resetNews.pendingRun.intent.kind, "news");
  assert.deepEqual(
    resetNews.pendingRun.intent.brandKeys,
    form.options.defaults.brands,
  );
  assert.deepEqual(
    resetNews.pendingRun.intent.modelKeys,
    form.options.defaults.models,
  );
  assert.deepEqual(
    resetNews.pendingRun.intent.platforms,
    form.options.defaults.platforms,
  );
  assert.equal(resetNews.pendingRun.intent.sourceIds, undefined);
  assert.equal(resetNews.pendingRun.intent.topics, undefined);
  assert.equal(resetNews.question, "sources");
  const resetNewsOverride = resolveRunToolIntent({
    form,
    pendingRun: resetNews.pendingRun,
    retainedRun: null,
    toolInput: {
      useDefaults: true,
      sourceMode: "all_enabled",
      topics: ["new topic"],
      topN: 2,
    },
  });
  assert.equal(resetNewsOverride.configuration?.kind, "news");
  if (resetNewsOverride.configuration?.kind !== "news")
    throw new Error("expected News defaults");
  assert.equal(resetNewsOverride.configuration.topN, 2);
  assert.equal(
    resetNewsOverride.configuration.enrichmentEnabled,
    form.options.defaults.enrichment,
  );
  assert.equal(
    resetNewsOverride.configuration.windowHours,
    form.options.defaults.windowHours,
  );
  assert.deepEqual(resetNewsOverride.configuration.topics, ["new topic"]);
  const changedKindDefaults = resolveRunToolIntent({
    form,
    pendingRun: followup.pendingRun,
    retainedRun: null,
    toolInput: {
      useDefaults: true,
      kind: "news",
      brandKeys: ["second"],
      modelKeys: ["second-model"],
      sourceMode: "rss_enabled",
      windowHours: 48,
      topics: ["new topic"],
    },
  });
  assert.equal(changedKindDefaults.configuration?.kind, "news");
  if (changedKindDefaults.configuration?.kind !== "news")
    throw new Error("expected changed News kind");
  assert.deepEqual(changedKindDefaults.configuration.brands, ["second"]);
  assert.deepEqual(changedKindDefaults.configuration.models, ["second-model"]);
  assert.equal(changedKindDefaults.configuration.windowHours, 48);
  assert.deepEqual(changedKindDefaults.configuration.sourceIds, [
    form.sources[0]?.id,
  ]);
  assert.equal(changedKindDefaults.pendingRun.intent.promoPrompts, undefined);
  assert.equal(changedKindDefaults.pendingRun.intent.promoText, undefined);
  for (const reason of [undefined, "cancel", "edit"] as const) {
    saveHistory("assistant-run-correction", [
      {
        ...restored,
        parts: [
          ...restored.parts,
          {
            type: "data-run-superseded",
            data: { toolCallId: "corrected-run", reason },
          },
        ],
      },
    ]);
    const restoredEdit = readHistory("assistant-run-correction");
    assert.deepEqual(
      latestPendingRun(restoredEdit),
      reason === "edit" ? corrected.pendingRun : null,
      "Run Edit survives reload; Cancel and legacy markers clear continuation",
    );
    assert.ok(
      restoredEdit[0]?.parts.some(
        (part) => part.type === "data-run-superseded",
      ),
    );
  }
  const runEdit = readHistory("assistant-run-correction")[0];
  assert.ok(runEdit);
  saveHistory("assistant-run-correction", [
    {
      ...runEdit,
      parts: [
        ...runEdit.parts,
        {
          type: "data-run-result",
          data: {
            analysisRunId: randomUUID(),
            operationId: randomUUID(),
            status: "created",
            href: "/dashboard",
            toolCallId: "corrected-run",
          },
        },
      ],
    },
  ]);
  assert.equal(latestPendingRun(readHistory("assistant-run-correction")), null);
  clearHistory("assistant-run-correction");
}

assert.equal(
  assistantConversationContextSchema.safeParse({
    ...projectedContext,
    approval: { id: "forged" },
  }).success,
  false,
);
assert.equal(
  assistantConversationContextSchema.safeParse({
    ...selectorContext,
    referents: [
      {
        ...selectorContext.referents[2],
        origin: {
          kind: "market_analysis_handoff",
          marketAnalysisHandoffId: randomUUID(),
        },
      },
    ],
  }).success,
  false,
);
assert.equal(
  assistantConversationContextSchema.safeParse({
    ...selectorContext,
    referents: [
      {
        ...selectorContext.referents[2],
        editorialSelectionId,
      },
    ],
  }).success,
  false,
);
assert.equal(
  assistantConversationContextSchema.safeParse({
    ...projectedContext,
    turns: [{ role: "user", text: "hello", toolCallId: "forged" }],
  }).success,
  false,
);
assert.equal(
  assistantConversationContextSchema.safeParse({
    ...projectedContext,
    referents: [
      {
        ...projectedContext.referents[0],
        facts: [{ key: "status", value: "forged" }],
      },
    ],
  }).success,
  false,
);
assert.equal(
  assistantConversationContextSchema.safeParse({
    turns: Array.from({ length: 6 }, () => ({
      role: "user",
      text: "ژ".repeat(2_000),
    })),
    referents: [],
  }).success,
  false,
  "context enforces its UTF-8 byte ceiling",
);
const boundedProjection = projectAssistantContext(
  Array.from({ length: 8 }, (_, index) => ({
    id: `large-${index}`,
    role: "assistant" as const,
    metadata: { createdAt: index + 1 },
    parts: [{ type: "text" as const, text: "ژ".repeat(2_000) }],
  })),
);
assert.ok(boundedProjection.turns.length <= 6);
assert.ok(
  new TextEncoder().encode(JSON.stringify(boundedProjection)).byteLength <=
    MAX_ASSISTANT_CONTEXT_BYTES,
);
const contextPrompt = `${chatInstructions({
  brandChoice: false,
  clarifyTool: false,
  locale: "en",
  pendingRun: false,
})}\n${chatPrompt({
  brandChoices: [],
  card: null,
  context: projectedContext,
  knowledge: selected("rzwire", "en", "Show its report"),
  marketAnalysisId: null,
  modelChoices: [],
  pendingRun: null,
  platforms: [],
  promoBrandChoices: [],
  question: "Show its report",
  readContext: {
    customer: customerFactsOf(templates.rzwire.template),
    productHelp: productHelp("en"),
    templateFingerprint: templates.rzwire.fingerprint.slice(0, 16),
  },
  run: null,
})}`;
assert.match(contextPrompt, /<CONVERSATION>/u);
assert.match(contextPrompt, /<REFERENTS>/u);
assert.match(contextPrompt, new RegExp(priorRunId, "u"));
assert.match(contextPrompt, /selectors, not facts/u);
assert.match(
  contextPrompt,
  /Editorial work stays in Multi Media and the Card Sheet/u,
);
assert.match(
  contextPrompt,
  /Publishing and every schedule mutation stay in Saved or Schedule/u,
);
assert.doesNotMatch(contextPrompt, /editorial_action|publishing_action/u);
assert.match(contextPrompt, /RUN_REQUEST and MARKET_REQUEST take precedence/u);
assert.doesNotMatch(
  contextPrompt,
  /private effect payload|private pending intent/u,
);

const readToolsSource = source(
  "apps/web/src/features/assistant/lib/tools/read-tools.server.ts",
);
const boundedCardProjection = assistantReadResultSchema.parse({
  cursors: null,
  facts: [
    { key: "activeRevision", value: randomUUID() },
    { key: "image", value: `selected:${randomUUID()}` },
    { key: "approval", value: `approved:${randomUUID()}` },
    { key: "publication", value: "confirmed" },
    {
      key: "schedule",
      value: "scheduled:2026-09-09T08:00:00.000Z:Asia/Tehran",
    },
  ],
  href: `/dashboard?run=${randomUUID()}&draft=${randomUUID()}`,
  items: [
    {
      facts: [
        { key: "kind", value: "candidate" },
        { key: "contentLocale", value: "en" },
        { key: "requestedModel", value: "claude" },
        { key: "copyPreview", value: `${"a".repeat(219)}…` },
      ],
      href: null,
      id: randomUUID(),
      occurredAt: null,
      status: "succeeded",
      title: "Analysis",
    },
  ],
  kind: "card",
  notice: "none",
  observedAt: "2026-09-09T08:00:00.000Z",
});
assert.equal(boundedCardProjection.items.length, 1);
assert.equal(
  boundedCardProjection.items[0]?.facts.find(
    (entry) => entry.key === "copyPreview",
  )?.value.length,
  220,
);
const transcriptSource = source(
  "apps/web/src/features/assistant/components/assistant-transcript.tsx",
);
const readProjectionsSource = source(
  "apps/web/src/features/assistant/lib/read-projections.ts",
);
const editorialWorkspaceSource = source(
  "apps/web/src/features/editorial/api/server/get-editorial-workspace.ts",
);
const platformDraftSource = source(
  "apps/web/src/features/editorial/api/server/get-platform-draft.ts",
);
for (const owner of [
  "getInstallationOverview",
  "getRunOptions",
  "getEditorialWorkspace",
  "getRunReport",
  "getPlatformDraft",
  "getAccountSummary",
  "getActivityHistory",
  "getActivityLedger",
  "getRecentTopics",
  "getSavedHistory",
  "getPublishingHistory",
  "getUsageView",
  "getMarketAnalysisOptions",
  "getMarketAnalysisCatalog",
  "getMarketAnalysisHistory",
  "getMarketAnalysis",
  "getMarketAnalysisReport",
]) {
  assert.match(readToolsSource, new RegExp(`\\b${owner}\\b`, "u"), owner);
}
assert.doesNotMatch(readToolsSource, /from ["'][^"']+\/db\//u);
assert.doesNotMatch(readToolsSource, /\brpcDb\b|\bsql`/u);
assert.match(
  readToolsSource,
  /readAnalysis\([\s\S]*input\.analysisId \?\? scope\.currentMarketAnalysisId,[\s\S]*scope\.locale/u,
  "current Market Analysis reads resolve through the validated page scope",
);
assert.match(
  readToolsSource,
  /readMarketReport\(\s*input\.analysisId \?\? scope\.currentMarketAnalysisId,?\s*\)/u,
  "current Market reports resolve through the validated page scope",
);
assert.match(
  readToolsSource,
  /run: draft\.executionScope\.analysisRunId,[\s\S]*draft: card\.id/u,
  "analysis-run card links must retain both owner run and draft identities",
);
assert.match(readToolsSource, /const MAX_CARD_CANDIDATES = 8/u);
assert.match(readToolsSource, /const MAX_CARD_REVISIONS = 8/u);
assert.match(readToolsSource, /const MAX_CARD_COPY_PREVIEW_CHARS = 220/u);
assert.match(
  readToolsSource,
  /getTranslations\(\{[\s\S]*locale: presentationLocale/u,
);
assert.match(
  readToolsSource,
  /candidate\.id,[\s\S]*t\("cardSheet\.variantLabel", \{ key: candidate\.variantKey \}\)/u,
);
assert.match(
  readToolsSource,
  /card\.generation\?\.operationId === candidate\.operationId[\s\S]*unit\.variantKey === candidate\.variantKey/u,
);
assert.match(
  readToolsSource,
  /fact\("copyPreview", copyPreview\(candidate\.body\)\)/u,
);
assert.match(
  readToolsSource,
  /compact\.slice\(0, MAX_CARD_COPY_PREVIEW_CHARS - 1\)\.trimEnd\(\)/u,
);
assert.match(
  readToolsSource,
  /fact\("activeRevision", card\.activeRevisionId/u,
);
assert.match(readToolsSource, /activeRevision\.selectedFinalMediaAssetId/u);
assert.match(
  readToolsSource,
  /imageGeneration &&[\s\S]*activeRevision &&[\s\S]*imageGeneration\.draftRevisionId === activeRevision\.id/u,
);
assert.match(readToolsSource, /card\.publishing\.approval/u);
assert.match(
  readToolsSource,
  /card\.publishing\.latestPublication\?\.lifecycle/u,
);
assert.match(readToolsSource, /card\.publishing\.latestSchedule/u);
assert.match(
  readToolsSource,
  /market-analysis\/\$\{draft\.executionScope\.marketAnalysisId\}[\s\S]*draft: card\.id/u,
  "Market card links must retain both owner analysis and draft identities",
);
assert.match(
  transcriptSource,
  /part\.type === "text" && \(fromOperator \|\| !responseFailed\)/u,
  "failed assistant prose must not render while operator text remains visible",
);
assert.match(
  transcriptSource,
  /result\.notice === "none"/u,
  "missing-context read cards must not render a bare owner link",
);
const readCardSourceStart = transcriptSource.indexOf(
  "function AssistantReadCard",
);
const readCardSourceEnd = transcriptSource.indexOf(
  "\nfunction readFactValue",
  readCardSourceStart,
);
assert.ok(
  readCardSourceStart >= 0 && readCardSourceEnd > readCardSourceStart,
  "read card source is present",
);
const readCardSource = transcriptSource.slice(
  readCardSourceStart,
  readCardSourceEnd,
);
assert.match(
  transcriptSource,
  /<AssistantReadCard key=\{part\.toolCallId\} result=\{part\.output\} \/>/u,
  "read cards render the immutable tool-output snapshot",
);
assert.doesNotMatch(
  readCardSource,
  /\buseState\b|\buseOptimistic\b|\.sort\(|\.reverse\(|\.splice\(/u,
  "read cards remain stateless and do not reorder their result snapshot",
);
assert.match(
  readCardSource,
  /result\.items\.map\(\(item, itemIndex\) => \([\s\S]*key=\{`\$\{item\.id\}:\$\{itemIndex\}`\}/u,
  "read rows use snapshot-local positions without changing canonical item IDs",
);
assert.match(
  readCardSource,
  /item\.href\?\.startsWith\("\/api\/media\/"\)[\s\S]*<Image[\s\S]*src=\{item\.href\}[\s\S]*unoptimized/u,
  "authenticated media rows render an inline image preview",
);
assert.match(
  readCardSource,
  /render=\{<Link href=\{result\.href\} \/>\}/u,
  "media previews retain the exact owner Open control",
);
const assistantReadToolJsonSchema = z
  .looseObject({
    type: z.literal("object"),
    required: z.array(z.string()),
  })
  .parse(asSchema(assistantReadToolInputSchema).jsonSchema);
assert.equal(assistantReadToolJsonSchema.type, "object");
assert.deepEqual(assistantReadToolJsonSchema.required, ["request"]);
for (const keyword of ["oneOf", "anyOf", "allOf", "enum", "const", "not"]) {
  assert.equal(keyword in assistantReadToolJsonSchema, false, keyword);
}
assert.deepEqual(
  assistantReadToolInputSchema.parse({
    request: { target: "runs", scope: "recent" },
  }),
  { request: { target: "runs", scope: "recent" } },
);
assert.deepEqual(
  assistantReadToolInputSchema.parse({ request: { target: "run" } }),
  { request: { target: "run" } },
);
assert.equal(
  assistantReadToolInputSchema.safeParse({
    request: { target: "run", scope: "current" },
  }).success,
  false,
);
assert.equal(
  assistantReadToolInputSchema.safeParse({ request: { target: "runs" } })
    .success,
  false,
);
assert.equal(
  assistantReadToolInputSchema.safeParse({
    request: { target: "runs", scope: "recent", runId: randomUUID() },
  }).success,
  false,
);
assert.equal(
  assistantReadToolInputSchema.safeParse({
    request: { target: "unknown" },
  }).success,
  false,
);
assert.match(
  readProjectionsSource,
  /entries[\s\S]*\.slice\(0, MAX_ASSISTANT_READ_ITEMS\)/u,
);
assert.match(readProjectionsSource, /input\.facet === "details"/u);
assert.doesNotMatch(readToolsSource, /yesterday/u);
const marketHistoryGetterSource = source(
  "apps/web/src/features/market-analysis/api/server/get-history.ts",
);
const marketHistoryQueriesSource = source(
  "apps/web/src/features/market-analysis/db/queries.ts",
);
assert.match(
  marketHistoryGetterSource,
  /pageSize = MARKET_ANALYSIS_HISTORY_PAGE_SIZE/u,
);
assert.match(
  marketHistoryGetterSource,
  /readCachedMarketAnalysisHistory\([\s\S]*workspaceId,[\s\S]*session\.user\.id,[\s\S]*query,[\s\S]*pageSize/u,
);
assert.match(
  marketHistoryGetterSource,
  /readMarketAnalysisHistoryBase\([\s\S]*workspaceId,[\s\S]*userId,[\s\S]*query,[\s\S]*pageSize/u,
);
assert.match(marketHistoryQueriesSource, /limit \$\{pageSize \+ 1\}/u);
assert.match(
  marketHistoryQueriesSource,
  /keysetPageOf\(\{[\s\S]*pageSize,[\s\S]*cursor/u,
);
const publishingGetterSource = source(
  "apps/web/src/features/publishing/api/server/get-publishing-history.ts",
);
const savedGetterSource = source(
  "apps/web/src/features/publishing/api/server/get-saved-history.ts",
);
const publishingQueriesSource = source(
  "apps/web/src/features/publishing/db/queries.ts",
);
assert.match(publishingGetterSource, /pageSize = PUBLISHING_PAGE_SIZE/u);
assert.match(savedGetterSource, /pageSize = PUBLISHING_PAGE_SIZE/u);
assert.match(
  publishingGetterSource,
  /readCachedPublishingHistory\([\s\S]*workspaceId,[\s\S]*session\.user\.id,[\s\S]*query,[\s\S]*pageSize/u,
);
assert.match(
  savedGetterSource,
  /readCachedSavedHistory\([\s\S]*workspaceId,[\s\S]*session\.user\.id,[\s\S]*query,[\s\S]*pageSize/u,
);
assert.equal(
  [...publishingQueriesSource.matchAll(/limit \$\{pageSize \+ 1\}/gu)].length,
  2,
);
assert.equal(
  [
    ...publishingQueriesSource.matchAll(
      /keysetPageOf\(\{[\s\S]*?pageSize,[\s\S]*?cursor/gu,
    ),
  ].length,
  2,
);

const runContextSource = source(
  "apps/web/src/features/assistant/lib/run-context.ts",
);
assert.match(runContextSource, /if \(!claimedRunId\) return null;/u);
assert.match(
  runContextSource,
  /getEditorialWorkspace\([\s\S]*claimedRunId[\s\S]*presentationLocale/u,
);
assert.doesNotMatch(
  runContextSource,
  /newest|readLatest|rpcDb|from ["'][^"']+\/db\//iu,
);

const promptSource = source(
  "apps/web/src/features/assistant/lib/chat-prompt.ts",
);
const chatRequestSource = source(
  "apps/web/src/features/assistant/schemas/chat-request.ts",
);
assert.match(chatRequestSource, /context: assistantConversationContextSchema/u);
assert.match(promptSource, /Authority order is strict/u);
assert.match(
  promptSource,
  /Previous or recent run lists are workspace history/u,
);
assert.match(
  promptSource,
  /current pinned run detail, use request target "run" without scope or runId/u,
);
assert.match(
  promptSource,
  /exact historical run from an owner-scoped referent, use target "run" with its runId/u,
);
assert.doesNotMatch(promptSource, /current run uses scope "current"/u);
assert.match(promptSource, /Use these exact read targets/u);
assert.match(promptSource, /recent Market analyses "market_history"/u);
assert.match(
  promptSource,
  /CURRENT_MARKET_ANALYSIS[\s\S]*omit analysisId so the application resolves the scoped page/u,
);
assert.doesNotMatch(
  promptSource,
  /For the actual current Market stage[^"\n]*exact analysisId/u,
);
assert.match(promptSource, /call read_workspace before considering/u);
assert.match(promptSource, /returned card is read-only/u);
assert.match(promptSource, /calendar yesterday, do not call read_workspace/u);
assert.match(promptSource, /RUN_REQUEST is active/u);
assert.match(promptSource, /facet summary/u);
assert.match(
  promptSource,
  /For a how-to request, give the shortest complete ordered sequence/u,
);
assert.match(
  promptSource,
  /A pure how-to answer describes the native desk without calling a tool/u,
);
assert.match(
  promptSource,
  /Editing, routing, approvals, images, publishing, and scheduling stay in their owning desks/u,
);
assert.match(
  promptSource,
  /never offer or claim an assistant Editorial effect/u,
);
assert.match(
  promptSource,
  /never offer or claim an assistant save, approval, publish, schedule, cancel, reschedule, recovery, retry, reconciliation, attestation, pause, or resume effect/u,
);
const respondSource = source("apps/web/src/app/api/chat/respond.ts");
assert.match(respondSource, /pendingRun: request\.pendingRun/u);
assert.match(
  respondSource,
  /currentMarketAnalysisId: request\.marketAnalysisId/u,
);
assert.match(
  respondSource,
  /readRunContext\(request\.runId, request\.locale\)/u,
);
assert.match(respondSource, /locale: context\.locale/u);
assert.match(respondSource, /stopWhen: isStepCount\(3\)/u);
assert.doesNotMatch(respondSource, /hasToolCall/u);
assert.match(
  respondSource,
  /prepareStep: \(\{ stepNumber \}\) => \(\{[\s\S]*stepNumber === 0 \? activeTools : \[\]/u,
);
assert.match(
  promptSource,
  /After it returns, answer every requested part[\s\S]*including a requested next step/u,
);
assert.match(respondSource, /chunk\.value\.type === "error"/u);
assert.match(respondSource, /succeeded = !streamFailed/u);
assert.match(readToolsSource, /locale: ContentLocale/u);
assert.match(
  readToolsSource,
  /readRun\(input\.runId \?\? scope\.currentRunId, scope\.locale\)/u,
);
assert.match(
  readToolsSource,
  /readCard\(input\.draftId \?\? scope\.currentDraftId, scope\.locale\)/u,
);
assert.match(
  readToolsSource,
  /getPlatformDraft\(draftId, presentationLocale\)/u,
);
assert.match(
  editorialWorkspaceSource,
  /presentationLocale \?\? currentLocale\(\)/u,
);
assert.match(
  editorialWorkspaceSource,
  /query\.run,[\s\S]*resolvedPresentationLocale/u,
);
assert.match(platformDraftSource, /presentationLocale \?\? currentLocale\(\)/u);
assert.match(
  platformDraftSource,
  /platformDraftId,[\s\S]*resolvedPresentationLocale/u,
);

const historySource = source(
  "apps/web/src/features/assistant/lib/local-history.ts",
);
assert.match(historySource, /const MAX_PARTS = 24;/u);
assert.match(historySource, /const MAX_MESSAGES = 40;/u);
assert.match(historySource, /HISTORY_TTL_MS/u);
const controllerSource = source(
  "apps/web/src/features/assistant/components/assistant-controller.tsx",
);
assert.match(
  controllerSource,
  /marketAnalysisId:[\s\S]*pinnedMarketAnalysisId\(\) \?\? latestMarketAnalysisId\(messages\)/u,
);
const editMarketHandler = controllerSource.match(
  /onEditMarket=\{\(messageId, toolCallId\) => \{([\s\S]*?)\n\s*\}\}/u,
)?.[1];
assert.ok(editMarketHandler);
assert.match(
  editMarketHandler,
  /supersedeMarketTool\(current, messageId, toolCallId, "edit"\)/u,
);
assert.doesNotMatch(
  editMarketHandler,
  /setPendingMarket\(null\)/u,
  "Market Edit preserves pending setup for the next invocation",
);
assert.match(
  source("apps/web/src/features/assistant/components/assistant-transcript.tsx"),
  /onEdit=\{\(\) => onEditMarket\(message.id, part.toolCallId\)\}/u,
);
assert.match(
  controllerSource,
  /onMarketSuperseded=\{\(messageId, toolCallId\) => \{\s*setPendingMarket\(null\);/u,
  "Market Cancel still clears pending setup",
);
assert.match(
  controllerSource,
  /const sweep = useEffectEvent\(\(\) => \{[\s\S]*?clearHistory\(storageKey\);\s*setPendingMarket\(null\);\s*setPendingRun\(null\);\s*setMessages\(\[\]\);/u,
  "history expiry clears retained workflow state as well as the transcript",
);
assert.match(
  source("apps/web/src/features/assistant/components/run-tool-renderer.tsx"),
  /const formQuery = useQuery\(\{\s*enabled: active && enabled,/u,
  "inactive Run tools do not load form data",
);
assert.match(
  source("apps/web/src/features/assistant/components/market-tool-renderer.tsx"),
  /const marketQuery = useQuery\(\{\s*enabled: active && enabled && intent !== null,/u,
  "inactive Market tools do not load form data",
);
assert.match(
  source("apps/web/src/features/assistant/constants.ts"),
  /HISTORY_TTL_MS = 60 \* 60 \* 1_000/u,
);

const expectedT010Rows = new Set([
  "ED-RUN-05",
  "ED-RUN-06",
  "ED-RUN-08",
  "ED-RUN-09",
  "ED-RUN-10",
  "ED-RUN-11",
  "ED-CARD-01",
  "PB-13",
  "MA-READ-01",
  "MA-READ-02",
  "MA-READ-04",
  "MA-READ-05",
  "MA-READ-06",
  "MA-PUB-08",
  "MA-GAP-03",
  "KN-CORPUS-01",
  "KN-CORPUS-02",
  "KN-CORPUS-03",
  "KN-CORPUS-04",
  "KN-CORPUS-05",
  "KN-CORPUS-06",
  "KN-CORPUS-07",
  "KN-CORPUS-08",
  "KN-CORPUS-09",
  "KN-TEMPLATE-01",
  "KN-TEMPLATE-02",
  "KN-TEMPLATE-03",
  "KN-TEMPLATE-04",
  "KN-LOCALE-01",
  "KN-LOCALE-02",
  "KN-LOCALE-03",
  "KN-LOCALE-04",
  "KN-DRIFT-01",
  "KN-DRIFT-02",
  "KN-DRIFT-03",
  "KN-DRIFT-04",
  "KN-DRIFT-05",
  "AC-01",
  "AC-02",
  "AC-03",
  "AC-04",
  "AC-05",
  "AC-06",
  "AC-07",
  "US-01",
  "US-02",
  "US-03",
  "US-04",
  "US-05",
  "US-06",
  "MD-05",
  "KN-IMP-01",
  "KN-IMP-02",
  "KN-IMP-03",
  "KN-IMP-04",
  "KN-IMP-05",
  "KN-IMP-06",
  "KN-IMP-07",
  "PS-04",
]);
const actualT010Rows = new Set(
  source("docs/plans/assistant-operations/CAPABILITY-MATRIX.md")
    .split("\n")
    .flatMap((line) => {
      const columns = line.split("|");
      const owner = columns.length === 6 ? columns[3] : columns[4];
      return owner?.trim() === "`T010`" && columns[1]
        ? [columns[1].trim().replaceAll("`", "")]
        : [];
    }),
);
assert.deepEqual(
  [...actualT010Rows].sort(),
  [...expectedT010Rows].sort(),
  "every current T010 matrix row remains mapped by the read probe",
);

const correctedKnowledge = JSON.stringify({
  productHelp: { en: productHelp("en"), fa: productHelp("fa") },
  reviewedKnowledge: templateKeys.map(
    (key) => templates[key]?.reviewedKnowledge,
  ),
});
for (const stale of [
  "In the sidebar",
  "Instagram remains an editorial target",
  "15 verified RSS feeds and 29 public Telegram channels",
  "۱۵ فید RSS تأییدشده و ۲۹ کانال عمومی تلگرام",
  "Approved revisions publish directly or on a schedule through an asynchronous media-container workflow",
  "The assistant explains documented features and current card context. It cannot",
  "The assistant can explain this workspace, its brands, and the run or card currently open. It cannot",
  "دستیار فقط این قابلیت‌ها را توضیح می‌دهد",
  "It cannot perform publishing, scheduling, editing, approval",
  "cannot edit content, approve artifacts, schedule, publish",
  "دستیار نمی‌تواند انتشار، زمان‌بندی، ویرایش، تأیید",
  "دستیار نمی‌تواند محتوا را ویرایش یا تأیید کند، آن را زمان‌بندی یا منتشر کند",
]) {
  assert.doesNotMatch(correctedKnowledge, new RegExp(escapeRegex(stale), "u"));
}

console.log(
  `PASS: assistant read probe; 4 template profiles, EN/FA fallback, 59 T010 rows, strict read scope, cursor-correct 20-item Market/Publishing/Saved pages, bounded 21-brand Account and 21-instrument Market options, bounded 25-item catalog, and separate 20-model/20-detail Usage facets. Fingerprints ${templateKeys
    .map((key) => `${key}:${templates[key]?.fingerprint.slice(0, 12)}`)
    .join(" ")}`,
);

function source(path: string) {
  return readFileSync(resolve(repoRoot, path), "utf8");
}

function parseUsage(input: unknown) {
  const parsed = assistantReadInputSchema.parse(input);
  assert.equal(parsed.target, "usage");
  if (parsed.target !== "usage") throw new Error("expected Usage read input");
  return parsed;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}
