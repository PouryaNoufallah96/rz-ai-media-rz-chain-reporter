import type { SemanticDegradedReason } from "@rz-chain-reporter/contracts/editorial";
import { cosineSimilarity } from "ai";

import type { SimilarityPair } from "./dedup";
import type { Prepared } from "./pipeline";

export class SemanticVectorError extends Error {
  readonly reason: SemanticDegradedReason;

  constructor(reason: SemanticDegradedReason) {
    super(reason);
    this.name = "SemanticVectorError";
    this.reason = reason;
  }
}

type SemanticLayout = {
  itemIds: readonly string[];
  topicCount: number;
  brands: readonly { mediaBrandId: string; anchorCount: number }[];
};

type SemanticItemRanking = {
  sourceItemId: string;
  topicScore: number | null;
  topicIndex: number | null;
  brandScores: readonly { mediaBrandId: string; score: number }[];
};

export function planSemanticStage(
  prepared: Prepared,
  bounds: { maxValues: number },
): { values: string[]; layout: SemanticLayout } {
  const { semantic, brands } = prepared.configuration;
  const embedded = prepared.items.filter(
    (item) => item.semanticParticipation === "included",
  );
  const topics = prepared.topics
    .slice(0, semantic.maxTopics)
    .map((topic) => bound(topic, semantic.maxChars));

  const values = [
    ...embedded.map((item) => bound(item.projection, semantic.maxChars)),
    ...topics,
  ];
  const layoutBrands: { mediaBrandId: string; anchorCount: number }[] = [];

  for (const brand of brands) {
    const anchors = brand.editorial.semanticAnchors.slice(
      0,
      semantic.maxAnchorsPerBrand,
    );
    values.push(...anchors.map((anchor) => bound(anchor, semantic.maxChars)));
    layoutBrands.push({
      mediaBrandId: brand.mediaBrandId,
      anchorCount: anchors.length,
    });
  }

  if (values.length > bounds.maxValues) {
    throw new SemanticVectorError("bounds_exceeded");
  }

  return {
    values,
    layout: {
      itemIds: embedded.map((item) => item.sourceItemId),
      topicCount: topics.length,
      brands: layoutBrands,
    },
  };
}

export function rankFromVectors(
  vectors: readonly number[][],
  layout: SemanticLayout,
): SemanticItemRanking[] {
  const read = readVectors(vectors, layout);
  const rankings: SemanticItemRanking[] = [];

  for (const [index, sourceItemId] of layout.itemIds.entries()) {
    const item = read.items[index];
    if (item === undefined) {
      throw new SemanticVectorError("dimension_mismatch");
    }

    let topicScore: number | null = read.topics.length === 0 ? null : 0;
    let topicIndex: number | null = null;
    for (const [position, topic] of read.topics.entries()) {
      const score = similarityScore(item, topic);
      if (topicScore !== null && score > topicScore) {
        topicScore = score;
        topicIndex = position;
      }
    }

    const brandScores: { mediaBrandId: string; score: number }[] = [];
    for (const brand of read.brands) {
      let score = 0;
      for (const anchor of brand.anchors) {
        score = Math.max(score, similarityScore(item, anchor));
      }
      brandScores.push({ mediaBrandId: brand.mediaBrandId, score });
    }

    rankings.push({ sourceItemId, topicScore, topicIndex, brandScores });
  }

  return rankings;
}

export function clusterFromVectors(
  vectors: readonly number[][],
  layout: SemanticLayout,
  thresholdBp: number,
): SimilarityPair[] {
  const read = readVectors(vectors, layout);
  const pairs: SimilarityPair[] = [];

  for (let left = 0; left < layout.itemIds.length; left += 1) {
    for (let right = left + 1; right < layout.itemIds.length; right += 1) {
      const sourceItemId = layout.itemIds[left];
      const otherSourceItemId = layout.itemIds[right];
      const leftVector = read.items[left];
      const rightVector = read.items[right];
      if (
        sourceItemId === undefined ||
        otherSourceItemId === undefined ||
        leftVector === undefined ||
        rightVector === undefined
      ) {
        continue;
      }

      const similarityBp = Math.round(
        10_000 * cosineSimilarity(leftVector, rightVector),
      );
      if (similarityBp >= thresholdBp) {
        pairs.push({ sourceItemId, otherSourceItemId, similarityBp });
      }
    }
  }

  return pairs;
}

function readVectors(
  vectors: readonly number[][],
  layout: SemanticLayout,
): {
  items: number[][];
  topics: number[][];
  brands: { mediaBrandId: string; anchors: number[][] }[];
} {
  const expected =
    layout.itemIds.length +
    layout.topicCount +
    layout.brands.reduce((total, brand) => total + brand.anchorCount, 0);

  if (vectors.length !== expected) {
    throw new SemanticVectorError("dimension_mismatch");
  }

  const dimension = vectors[0]?.length ?? 0;
  for (const vector of vectors) {
    if (vector.length !== dimension || dimension === 0) {
      throw new SemanticVectorError("dimension_mismatch");
    }
    for (const value of vector) {
      if (!Number.isFinite(value)) {
        throw new SemanticVectorError("non_finite_value");
      }
    }
  }

  let cursor = layout.itemIds.length;
  const items = vectors.slice(0, cursor);
  const topics = vectors.slice(cursor, cursor + layout.topicCount);
  cursor += layout.topicCount;

  const brands = layout.brands.map((brand) => {
    const anchors = vectors.slice(cursor, cursor + brand.anchorCount);
    cursor += brand.anchorCount;
    return { mediaBrandId: brand.mediaBrandId, anchors };
  });

  return { items, topics, brands };
}

function similarityScore(left: number[], right: number[]): number {
  return Math.min(
    100,
    Math.max(0, Math.round(100 * cosineSimilarity(left, right))),
  );
}

// The gateway bounds UTF-16 length; iterate code points to avoid cutting a
// surrogate pair or exceeding the limit with an astral character.
function bound(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }

  let bounded = "";
  for (const character of value) {
    if (bounded.length + character.length > maxChars) {
      break;
    }
    bounded += character;
  }

  return bounded;
}
