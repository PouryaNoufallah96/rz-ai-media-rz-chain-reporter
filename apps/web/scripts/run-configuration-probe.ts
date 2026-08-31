import {
  effectiveNewsSourceIds,
  type RunConfigurationBounds,
  runConfigurationSchema,
} from "@rz-chain-reporter/contracts";
import { resolveBoardPresentation } from "../src/features/editorial/lib/board-presentation";

const RSS_SOURCE_ID = "00000000-0000-4000-8000-000000000001";
const TELEGRAM_SOURCE_ID = "00000000-0000-4000-8000-000000000002";

const bounds = {
  brandKeys: ["brand", "other"],
  modelKeys: ["model", "other-model"],
  platforms: ["telegram", "x"],
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

const promoRun = schema.safeParse({
  kind: "promo",
  models: ["model"],
  platforms: ["telegram"],
  promo: {
    brands: ["brand"],
    prompts: { brand: "Launch campaign" },
  },
});
if (!promoRun.success) {
  throw new Error("promo configuration rejected a platform selection");
}
if (
  promoRun.data.platforms.length !== 1 ||
  promoRun.data.platforms[0] !== "telegram"
) {
  throw new Error(
    "promo configuration did not preserve its platform selection",
  );
}

const promoPresentation = resolveBoardPresentation(
  promoRun.data,
  true,
  {
    brandKeys: ["brand", "other"],
    kind: "promo",
    modelKeys: ["model", "other-model"],
    platforms: ["telegram", "x"],
    telegramOnly: false,
  },
  bounds.platforms,
);
if (
  promoPresentation.brandKeys.length !== 1 ||
  promoPresentation.brandKeys[0] !== "brand" ||
  promoPresentation.modelKeys.length !== 1 ||
  promoPresentation.modelKeys[0] !== "model" ||
  promoPresentation.platforms.length !== 1 ||
  promoPresentation.platforms[0] !== "telegram"
) {
  throw new Error("settled promo presentation expanded beyond its snapshot");
}

const legacyPromoRun = schema.parse({
  kind: "promo",
  models: ["model"],
  promo: {
    brands: ["brand"],
    prompts: { brand: "Launch campaign" },
  },
});
if (
  legacyPromoRun.platforms.length !== bounds.platforms.length ||
  legacyPromoRun.platforms[0] !== bounds.platforms[0]
) {
  throw new Error("legacy promo configuration did not restore all platforms");
}

process.stdout.write("PASS editorial run configuration\n");
