import { scoreFreshness } from "./freshness";

const TRACKING_PARAMETER_PREFIX = "utm_";
const TRACKING_PARAMETERS = [
  "fbclid",
  "gclid",
  "igshid",
  "mc_cid",
  "mc_eid",
  "yclid",
  "_hsenc",
  "_hsmi",
];
const MINIMUM_SIGNIFICANT_TERM_LENGTH = 3;
const NON_WORD_RUN = /[^\p{L}\p{N}]+/u;

export type DedupCandidate = {
  sourceItemId: string;
  canonicalUrl: string;
  normalizedTitle: string;
  publishedAt: Date | null;
  sourceAuthorityScore: number;
  contentLength: number;
};

export type SimilarityPair = {
  sourceItemId: string;
  otherSourceItemId: string;
  similarityBp: number;
};

export function dedupByCanonicalUrl(
  items: readonly DedupCandidate[],
): (readonly string[])[] {
  const keyed = items
    .map((item) => ({
      sourceItemId: item.sourceItemId,
      key: canonicalizeUrl(item.canonicalUrl),
    }))
    .sort(
      (left, right) =>
        compare(left.key, right.key) ||
        compare(left.sourceItemId, right.sourceItemId),
    );

  const clusters: (readonly string[])[] = [];
  let current: string[] = [];

  for (const [index, entry] of keyed.entries()) {
    const previous = keyed[index - 1];
    if (previous !== undefined && previous.key === entry.key) {
      current.push(entry.sourceItemId);
      continue;
    }

    if (current.length > 1) {
      clusters.push(current);
    }
    current = [entry.sourceItemId];
  }

  if (current.length > 1) {
    clusters.push(current);
  }

  return clusters;
}

export function dedupByTitle(
  items: readonly DedupCandidate[],
  thresholdBp: number,
): SimilarityPair[] {
  const ordered = [...items].sort((left, right) =>
    compare(left.sourceItemId, right.sourceItemId),
  );
  const termSets = ordered.map((item) =>
    significantTerms(item.normalizedTitle),
  );
  const pairs: SimilarityPair[] = [];

  for (let left = 0; left < ordered.length; left += 1) {
    for (let right = left + 1; right < ordered.length; right += 1) {
      const leftTerms = termSets[left];
      const rightTerms = termSets[right];
      const leftItem = ordered[left];
      const rightItem = ordered[right];
      if (
        leftTerms === undefined ||
        rightTerms === undefined ||
        leftItem === undefined ||
        rightItem === undefined
      ) {
        continue;
      }

      const similarityBp = jaccardBp(leftTerms, rightTerms);
      if (similarityBp >= thresholdBp) {
        pairs.push({
          sourceItemId: leftItem.sourceItemId,
          otherSourceItemId: rightItem.sourceItemId,
          similarityBp,
        });
      }
    }
  }

  return pairs;
}

export function clusterBySimilarity(
  pairs: readonly SimilarityPair[],
  thresholdBp: number,
): (readonly string[])[] {
  const edges = new Map<string, string[]>();
  const nodes = new Set<string>();

  for (const pair of pairs) {
    if (pair.similarityBp < thresholdBp) {
      continue;
    }
    nodes.add(pair.sourceItemId);
    nodes.add(pair.otherSourceItemId);
    link(edges, pair.sourceItemId, pair.otherSourceItemId);
    link(edges, pair.otherSourceItemId, pair.sourceItemId);
  }

  const ordered = [...nodes].sort(compare);
  const visited = new Set<string>();
  const clusters: (readonly string[])[] = [];

  for (const node of ordered) {
    if (visited.has(node)) {
      continue;
    }

    const component: string[] = [];
    const queue = [node];
    visited.add(node);

    while (queue.length > 0) {
      const current = queue.shift();
      if (current === undefined) {
        break;
      }
      component.push(current);
      for (const neighbour of (edges.get(current) ?? []).toSorted(compare)) {
        if (!visited.has(neighbour)) {
          visited.add(neighbour);
          queue.push(neighbour);
        }
      }
    }

    clusters.push(component.toSorted(compare));
  }

  return clusters;
}

export function chooseSurvivor(
  items: readonly DedupCandidate[],
  freshness: {
    runStartedAt: Date;
    ladder: readonly { maxAgeHours: number; score: number }[];
    futureNeutralScore: number;
  },
): string {
  const ranked = items
    .map((item) => ({
      sourceItemId: item.sourceItemId,
      sourceAuthorityScore: item.sourceAuthorityScore,
      contentLength: item.contentLength,
      freshnessScore:
        scoreFreshness(
          item.publishedAt,
          freshness.runStartedAt,
          freshness.ladder,
          freshness.futureNeutralScore,
        ) ?? -1,
    }))
    .sort(
      (left, right) =>
        right.sourceAuthorityScore - left.sourceAuthorityScore ||
        right.freshnessScore - left.freshnessScore ||
        right.contentLength - left.contentLength ||
        compare(left.sourceItemId, right.sourceItemId),
    );

  const survivor = ranked[0];
  if (survivor === undefined) {
    throw new Error("EMPTY_DUPLICATE_CLUSTER");
  }

  return survivor.sourceItemId;
}

function link(edges: Map<string, string[]>, from: string, to: string) {
  const existing = edges.get(from);
  if (existing === undefined) {
    edges.set(from, [to]);
    return;
  }
  existing.push(to);
}

function significantTerms(normalizedTitle: string): Set<string> {
  return new Set(
    normalizedTitle
      .split(NON_WORD_RUN)
      .filter(
        (term) => Array.from(term).length >= MINIMUM_SIGNIFICANT_TERM_LENGTH,
      ),
  );
}

function jaccardBp(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }

  let shared = 0;
  for (const term of left) {
    if (right.has(term)) {
      shared += 1;
    }
  }

  return Math.round((10_000 * shared) / (left.size + right.size - shared));
}

function canonicalizeUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value.trim().toLowerCase();
  }

  url.hash = "";
  url.username = "";
  url.password = "";

  for (const key of [...url.searchParams.keys()]) {
    if (
      key.startsWith(TRACKING_PARAMETER_PREFIX) ||
      TRACKING_PARAMETERS.includes(key)
    ) {
      url.searchParams.delete(key);
    }
  }
  url.searchParams.sort();

  const path =
    url.pathname.length > 1 && url.pathname.endsWith("/")
      ? url.pathname.slice(0, -1)
      : url.pathname;
  const query = url.searchParams.toString();

  return `${url.protocol}//${url.host}${path}${query.length > 0 ? `?${query}` : ""}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
