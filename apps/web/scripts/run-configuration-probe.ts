import {
  effectiveNewsSourceIds,
  type RunConfigurationBounds,
  runConfigurationSchema,
} from "@rz-chain-reporter/contracts";

const RSS_SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const TELEGRAM_SOURCE_ID = "00000000-0000-4000-8000-000000000002";

const bounds = {
  brandKeys: ["brand"],
  modelKeys: ["model"],
  platforms: ["telegram"],
  selectionCap: 20,
  shortlistCap: 20,
  promoPromptMaxChars: 500,
  semanticMaxChars: 100,
  semanticMaxTopics: 10,
  fanOutMaxUnits: 10,
} satisfies RunConfigurationBounds;

const schema = runConfigurationSchema(bounds, {
  telegramSourceIds: [TELEGRAM_SOURCE_ID],
});
const base = {
  kind: "news" as const,
  brands: ["brand"],
  models: ["model"],
  platforms: ["telegram" as const],
  windowHours: 24 as const,
  enrichmentEnabled: true,
  orderingMode: "latest" as const,
  topN: 15,
  topics: ["btc"],
};

const rssOnlyTelegramRun = schema.safeParse({
  ...base,
  sourceIds: [RSS_SOURCE_ID],
  telegramOnly: true,
});
if (
  rssOnlyTelegramRun.success ||
  !rssOnlyTelegramRun.error.issues.some(
    (issue) => issue.message === "TELEGRAM_SOURCE_REQUIRED",
  )
) {
  throw new Error("telegram-only accepted an RSS-only source selection");
}

const topiclessKeywordRun = schema.safeParse({
  ...base,
  orderingMode: "keywords",
  sourceIds: [RSS_SOURCE_ID, TELEGRAM_SOURCE_ID],
  telegramOnly: false,
  topics: [],
});
if (
  topiclessKeywordRun.success ||
  !topiclessKeywordRun.error.issues.some(
    (issue) => issue.message === "KEYWORD_TOPIC_REQUIRED",
  )
) {
  throw new Error("keyword ordering accepted an empty topic list");
}

const mixedTelegramRun = schema.parse({
  ...base,
  sourceIds: [RSS_SOURCE_ID, TELEGRAM_SOURCE_ID],
  telegramOnly: true,
});
if (mixedTelegramRun.kind !== "news") {
  throw new Error("news configuration parsed as promo");
}
const effectiveTelegramSources = effectiveNewsSourceIds(mixedTelegramRun, [
  TELEGRAM_SOURCE_ID,
]);
if (
  effectiveTelegramSources.length !== 1 ||
  effectiveTelegramSources[0] !== TELEGRAM_SOURCE_ID
) {
  throw new Error("telegram-only retained a non-Telegram source");
}

const mixedNewsRun = schema.parse({
  ...base,
  sourceIds: [RSS_SOURCE_ID, TELEGRAM_SOURCE_ID],
  telegramOnly: false,
});
if (mixedNewsRun.kind !== "news") {
  throw new Error("news configuration parsed as promo");
}
if (effectiveNewsSourceIds(mixedNewsRun, [TELEGRAM_SOURCE_ID]).length !== 2) {
  throw new Error("normal news run dropped a selected source");
}

process.stdout.write("PASS editorial run configuration\n");
