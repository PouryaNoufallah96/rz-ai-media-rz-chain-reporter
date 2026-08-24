import type { ValueSignalKind } from "@rz-chain-reporter/customer-template/schema";
import { VALUE_SIGNAL_KINDS } from "@rz-chain-reporter/customer-template/schema";

import { matchTerms } from "./text";

export const SCORING_VERSION = "1";

type WeightedTerms = readonly { term: string; weight: number }[];
type Aliases = readonly { canonical: string; surfaces: readonly string[] }[];

type ViralityPolicy = {
  powerTerms: WeightedTerms;
  entityTerms: WeightedTerms;
  titleMultiplier: number;
  bodyMultiplier: number;
  numericSignalWeights: {
    number: number;
    percentage: number;
    currencyAmount: number;
    magnitudeAmount: number;
  };
};

type PolicyWeights = {
  withTopics: {
    mediaFit: number;
    lexicalTopic: number;
    virality: number;
    freshness: number;
    authority: number;
    sourcePreference: number;
    diversity: number;
  };
  withoutTopics: {
    mediaFit: number;
    virality: number;
    freshness: number;
    authority: number;
    sourcePreference: number;
    diversity: number;
  };
};

type PolicyInput = {
  normalizedTitle: string;
  normalizedText: string;
  topics: readonly string[];
  aliases: Aliases;
  sourceKey: string;
  preferredSourceKeys: readonly string[];
  mediaFitScore: number;
  policyViralityScore: number;
  freshnessScore: number;
  sourceAuthorityScore: number;
  diversityScore: number;
  weights: PolicyWeights;
  threshold: number;
};

const NO_ALIASES: Aliases = [];
const DIVERSITY_LADDER = [100, 70, 40, 20];
const TITLE_TOPIC_SCORE = 100;
const BODY_TOPIC_SCORE = 50;

const VALUE_SIGNAL_DETECTORS: Record<ValueSignalKind, RegExp> = {
  number: /(?<![\p{L}\p{N}])\d{4,}(?![\p{L}\p{N}])/u,
  percentage: /\d(?:[.,]\d+)?\s*%/u,
  currency_amount: /[$€£¥]\s*\d/u,
  magnitude_amount:
    /\d[\d.,]*\s*(?:bn|mn|tn|billions?|millions?|trillions?)(?![\p{L}\p{N}])/u,
};

const VALUE_SIGNAL_WEIGHT_KEYS = {
  number: "number",
  percentage: "percentage",
  currency_amount: "currencyAmount",
  magnitude_amount: "magnitudeAmount",
} as const satisfies Record<
  ValueSignalKind,
  keyof ViralityPolicy["numericSignalWeights"]
>;

export function detectValueSignals(normalizedText: string): ValueSignalKind[] {
  const detected: ValueSignalKind[] = [];

  for (const kind of VALUE_SIGNAL_KINDS) {
    if (VALUE_SIGNAL_DETECTORS[kind].test(normalizedText)) {
      detected.push(kind);
    }
  }

  return detected;
}

export function evaluateValueGate(
  normalizedText: string,
  signals: readonly ValueSignalKind[],
  gate:
    | {
        signalKinds: readonly ValueSignalKind[];
        forecastTerms: readonly string[];
      }
    | undefined,
): { passed: boolean; count: number | null } {
  if (gate === undefined) {
    return { passed: true, count: null };
  }

  let count = 0;
  for (const kind of gate.signalKinds) {
    if (signals.includes(kind)) {
      count += 1;
    }
  }

  count += matchTerms(
    normalizedText,
    gate.forecastTerms.map((term) => ({ term, weight: 1 })),
    NO_ALIASES,
  ).hits;

  return { passed: count > 0, count };
}

export function scoreMediaFit(
  normalizedTitle: string,
  normalizedBody: string,
  brand: {
    strongTerms: WeightedTerms;
    weakTerms: WeightedTerms;
    phrases: readonly { phrase: string; weight: number }[];
    aliases: Aliases;
  },
): number {
  const phraseTerms = brand.phrases.map((entry) => ({
    term: entry.phrase,
    weight: entry.weight,
  }));

  return clampScore(
    2 * matchTerms(normalizedTitle, brand.strongTerms, brand.aliases).weight +
      matchTerms(normalizedBody, brand.strongTerms, brand.aliases).weight +
      matchTerms(normalizedTitle, brand.weakTerms, brand.aliases).weight +
      matchTerms(normalizedBody, brand.weakTerms, brand.aliases).weight +
      2 * matchTerms(normalizedTitle, phraseTerms, brand.aliases).weight +
      matchTerms(normalizedBody, phraseTerms, brand.aliases).weight,
  );
}

export function scorePolicyVirality(
  normalizedTitle: string,
  normalizedText: string,
  signals: readonly ValueSignalKind[],
  virality: ViralityPolicy,
): number {
  const powerTitle = matchTerms(
    normalizedTitle,
    virality.powerTerms,
    NO_ALIASES,
  ).weight;
  const powerText = matchTerms(
    normalizedText,
    virality.powerTerms,
    NO_ALIASES,
  ).weight;
  const entityTitle = matchTerms(
    normalizedTitle,
    virality.entityTerms,
    NO_ALIASES,
  ).weight;

  let numeric = 0;
  for (const kind of VALUE_SIGNAL_KINDS) {
    if (signals.includes(kind)) {
      numeric += virality.numericSignalWeights[VALUE_SIGNAL_WEIGHT_KEYS[kind]];
    }
  }

  return clampScore(
    powerTitle * virality.titleMultiplier +
      (powerText - powerTitle) * virality.bodyMultiplier +
      entityTitle +
      numeric,
  );
}

export function scoreDiversity(
  ordered: readonly { sourceItemId: string; sourceKey: string }[],
): Map<string, number> {
  const seen = new Map<string, number>();
  const scores = new Map<string, number>();

  for (const entry of ordered) {
    const prior = seen.get(entry.sourceKey) ?? 0;
    scores.set(
      entry.sourceItemId,
      DIVERSITY_LADDER[Math.min(prior, DIVERSITY_LADDER.length - 1)] ?? 0,
    );
    seen.set(entry.sourceKey, prior + 1);
  }

  return scores;
}

export function scorePolicy(input: PolicyInput): {
  policyScore: number;
  passed: boolean;
  sourcePreferenceScore: number;
  lexicalTopicScore: number | null;
  lexicalTopicIndex: number | null;
} {
  const sourcePreferenceScore = input.preferredSourceKeys.includes(
    input.sourceKey,
  )
    ? 100
    : 0;
  const topic = scoreLexicalTopic(
    input.normalizedTitle,
    input.normalizedText,
    input.topics,
    input.aliases,
  );

  const hasTopics = input.topics.length > 0;
  const weights = hasTopics
    ? input.weights.withTopics
    : input.weights.withoutTopics;
  const lexicalTopicContribution = hasTopics
    ? (topic.score ?? 0) * input.weights.withTopics.lexicalTopic
    : 0;

  const policyScore = clampScore(
    input.mediaFitScore * weights.mediaFit +
      lexicalTopicContribution +
      input.policyViralityScore * weights.virality +
      input.freshnessScore * weights.freshness +
      input.sourceAuthorityScore * weights.authority +
      sourcePreferenceScore * weights.sourcePreference +
      input.diversityScore * weights.diversity,
  );

  return {
    policyScore,
    passed: policyScore >= input.threshold,
    sourcePreferenceScore,
    lexicalTopicScore: topic.score,
    lexicalTopicIndex: topic.index,
  };
}

export function scoreRank(input: {
  policyScore: number;
  semantic: { brandScore: number; topicScore: number | null } | null;
  brandWeight: number;
  topicWeight: number;
}): number {
  if (input.semantic === null) {
    return clampScore(input.policyScore);
  }

  const topicWeight =
    input.semantic.topicScore === null ? 0 : input.topicWeight;

  return clampScore(
    input.policyScore * (1 - input.brandWeight - topicWeight) +
      input.semantic.brandScore * input.brandWeight +
      (input.semantic.topicScore ?? 0) * topicWeight,
  );
}

function scoreLexicalTopic(
  normalizedTitle: string,
  normalizedText: string,
  topics: readonly string[],
  aliases: Aliases,
): { score: number | null; index: number | null } {
  if (topics.length === 0) {
    return { score: null, index: null };
  }

  let score = 0;
  let index: number | null = null;

  for (const [position, topic] of topics.entries()) {
    const terms = [{ term: topic, weight: 1 }];
    let hit = 0;
    if (matchTerms(normalizedTitle, terms, aliases).hits > 0) {
      hit = TITLE_TOPIC_SCORE;
    } else if (matchTerms(normalizedText, terms, aliases).hits > 0) {
      hit = BODY_TOPIC_SCORE;
    }

    if (hit > score) {
      score = hit;
      index = position;
    }
  }

  return { score, index };
}

function clampScore(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}
