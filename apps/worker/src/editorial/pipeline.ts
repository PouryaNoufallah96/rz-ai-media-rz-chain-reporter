import type {
  DuplicateMethod,
  FilteringReason,
  ItemEligibility,
  SemanticParticipation,
} from "@rz-chain-reporter/contracts/editorial";
import { MAX_EMBEDDING_VALUES } from "@rz-chain-reporter/contracts/editorial";
import type { SourceOrigin } from "@rz-chain-reporter/contracts/platform";
import type {
  CustomerTemplate,
  ValueSignalKind,
} from "@rz-chain-reporter/customer-template/schema";
import type {
  AnalysisRunFilterRow,
  AnalysisRunItemScores,
} from "@rz-chain-reporter/db/repositories/analysis-run";

import type { DedupCandidate, SimilarityPair } from "./dedup";
import {
  chooseSurvivor,
  clusterBySimilarity,
  dedupByCanonicalUrl,
  dedupByTitle,
} from "./dedup";
import { scoreFreshness } from "./freshness";
import { buildProjection } from "./projection";
import {
  detectValueSignals,
  evaluateValueGate,
  scoreDiversity,
  scoreMediaFit,
  scorePolicy,
  scorePolicyVirality,
  scoreRank,
} from "./scoring";
import {
  clusterFromVectors,
  planSemanticStage,
  rankFromVectors,
} from "./semantic";
import { normalizeText } from "./text";

export type PipelineConfiguration = {
  policy: CustomerTemplate["editorial"]["policy"];
  semantic: CustomerTemplate["editorial"]["semantic"];
  shortlistCap: number;
  telegramLaneCap: number;
  topicAliases: CustomerTemplate["editorial"]["topicAliases"];
  brands: readonly {
    mediaBrandId: string;
    editorial: CustomerTemplate["mediaBrands"][number]["editorial"];
  }[];
};

export type CandidateItem = {
  sourceItemId: string;
  sourceItemRevisionId: string;
  sourceKey: string;
  origin: SourceOrigin;
  publishedAt: Date | null;
  eligibility: ItemEligibility;
};

export type CandidateRevision = {
  sourceItemRevisionId: string;
  title: string;
  summary: string | null;
  canonicalUrl: string;
};

type Duplicate = {
  method: DuplicateMethod;
  ofSourceItemId: string;
  similarityBp: number;
};

type PreparedRoute = {
  mediaBrandId: string;
  valueSignalCount: number | null;
  mediaFitScore: number | null;
  passed: boolean;
  reason: FilteringReason | null;
};

type PreparedItem = {
  sourceItemId: string;
  sourceKey: string;
  origin: SourceOrigin;
  eligibility: ItemEligibility;
  publishedAt: Date | null;
  normalizedTitle: string;
  normalizedBody: string;
  normalizedText: string;
  projection: string;
  sourceAuthorityScore: number | null;
  freshnessScore: number | null;
  policyViralityScore: number | null;
  valueSignals: readonly ValueSignalKind[];
  duplicate: Duplicate | null;
  routes: readonly PreparedRoute[];
  semanticParticipation: SemanticParticipation | null;
};

type FreshnessInputs = {
  runStartedAt: Date;
  ladder: readonly { maxAgeHours: number; score: number }[];
  futureNeutralScore: number;
};

export type Prepared = {
  runStartedAt: Date;
  configuration: PipelineConfiguration;
  topics: readonly string[];
  items: readonly PreparedItem[];
};

export function prepareCandidates(input: {
  items: readonly CandidateItem[];
  revisions: readonly CandidateRevision[];
  runStartedAt: Date;
  configuration: PipelineConfiguration;
  topics: readonly string[];
}): Prepared {
  const { configuration, runStartedAt, topics } = input;
  const revisions = new Map(
    input.revisions.map((revision) => [
      revision.sourceItemRevisionId,
      revision,
    ]),
  );
  const freshness: FreshnessInputs = {
    runStartedAt,
    ladder: configuration.policy.freshnessLadder,
    futureNeutralScore: configuration.policy.futureDateNeutralScore,
  };

  const items = [...input.items]
    .sort((left, right) => compare(left.sourceItemId, right.sourceItemId))
    .map((item): PreparedItem & { canonicalUrl: string } => {
      const revision = revisions.get(item.sourceItemRevisionId);
      if (revision === undefined) {
        throw new Error("MISSING_SOURCE_ITEM_REVISION");
      }

      const normalizedTitle = normalizeText(revision.title);
      const projection = buildProjection(
        revision,
        configuration.semantic.maxChars,
      );
      const normalizedTitleLength = Array.from(normalizedTitle).length;
      const normalizedBody = Array.from(projection)
        .slice(normalizedTitleLength + 1)
        .join("");
      const normalizedText = projection;
      const candidate = item.eligibility === "candidate";

      return {
        sourceItemId: item.sourceItemId,
        sourceKey: item.sourceKey,
        origin: item.origin,
        eligibility: item.eligibility,
        publishedAt: item.publishedAt,
        canonicalUrl: revision.canonicalUrl,
        normalizedTitle,
        normalizedBody,
        normalizedText,
        projection,
        sourceAuthorityScore: candidate
          ? resolveAuthority(configuration, item.sourceKey)
          : null,
        freshnessScore: candidate
          ? scoreFreshness(
              item.publishedAt,
              runStartedAt,
              freshness.ladder,
              freshness.futureNeutralScore,
            )
          : null,
        policyViralityScore: null,
        valueSignals: candidate ? detectValueSignals(normalizedText) : [],
        duplicate: null,
        routes: [],
        semanticParticipation: null,
      };
    });

  const byId = new Map(items.map((item) => [item.sourceItemId, item]));
  const thresholdBp = Math.round(
    configuration.semantic.dedupThreshold * 10_000,
  );
  const dedupInput = items
    .filter((item) => item.eligibility === "candidate")
    .map(
      (item): DedupCandidate => ({
        sourceItemId: item.sourceItemId,
        canonicalUrl: item.canonicalUrl,
        normalizedTitle: item.normalizedTitle,
        publishedAt: item.publishedAt,
        sourceAuthorityScore: item.sourceAuthorityScore ?? 0,
        contentLength: Array.from(item.normalizedText).length,
      }),
    );

  collapse(dedupByCanonicalUrl(dedupInput), "canonical_url", () => 10_000, {
    dedupInput,
    byId,
    freshness,
  });

  const undeduped = dedupInput.filter(
    (item) => byId.get(item.sourceItemId)?.duplicate == null,
  );
  const titlePairs = dedupByTitle(undeduped, thresholdBp);
  collapse(
    clusterBySimilarity(titlePairs, thresholdBp),
    "title",
    (sourceItemId, survivor) =>
      similarityOf(titlePairs, sourceItemId, survivor),
    { dedupInput, byId, freshness },
  );

  for (const item of items) {
    if (item.eligibility !== "candidate" || item.duplicate !== null) {
      continue;
    }

    item.policyViralityScore = scorePolicyVirality(
      item.normalizedTitle,
      item.normalizedText,
      item.valueSignals,
      configuration.policy.virality,
    );
    item.routes = configuration.brands.map((brand): PreparedRoute => {
      const gate = evaluateValueGate(
        item.normalizedText,
        item.valueSignals,
        brand.editorial.valueGate,
      );
      if (!gate.passed) {
        return {
          mediaBrandId: brand.mediaBrandId,
          valueSignalCount: gate.count,
          mediaFitScore: null,
          passed: false,
          reason: "missing_required_value_signal",
        };
      }

      const mediaFitScore = scoreMediaFit(
        item.normalizedTitle,
        item.normalizedBody,
        brand.editorial,
      );
      const passed = mediaFitScore >= brand.editorial.mediaFitThreshold;

      return {
        mediaBrandId: brand.mediaBrandId,
        valueSignalCount: gate.count,
        mediaFitScore,
        passed,
        reason: passed ? null : "below_media_fit_threshold",
      };
    });
  }

  const admitted = items
    .filter(
      (item) =>
        item.projection.length > 0 && item.routes.some((route) => route.passed),
    )
    .map((item) => ({
      sourceItemId: item.sourceItemId,
      bestMediaFit: item.routes.reduce(
        (best, route) => Math.max(best, route.mediaFitScore ?? 0),
        0,
      ),
    }))
    .sort(
      (left, right) =>
        right.bestMediaFit - left.bestMediaFit ||
        compare(left.sourceItemId, right.sourceItemId),
    );

  for (const [position, entry] of admitted.entries()) {
    const item = byId.get(entry.sourceItemId);
    if (item !== undefined) {
      item.semanticParticipation =
        position < configuration.semantic.maxCandidates
          ? "included"
          : "outside_bound";
    }
  }

  return {
    runStartedAt,
    configuration,
    topics,
    items: items.map(
      ({ canonicalUrl: _canonicalUrl, ...item }): PreparedItem => item,
    ),
  };
}

export function scoreAndRoute(
  prepared: Prepared,
  vectors: readonly number[][] | null,
): {
  runItems: AnalysisRunItemScores[];
  filterRows: AnalysisRunFilterRow[];
  shortlists: { mediaBrandId: string; sourceItemIds: string[] }[];
} {
  const { configuration, runStartedAt, topics } = prepared;
  const freshness: FreshnessInputs = {
    runStartedAt,
    ladder: configuration.policy.freshnessLadder,
    futureNeutralScore: configuration.policy.futureDateNeutralScore,
  };
  const byId = new Map(prepared.items.map((item) => [item.sourceItemId, item]));
  const duplicates = new Map<string, Duplicate>();
  for (const item of prepared.items) {
    if (item.duplicate !== null) {
      duplicates.set(item.sourceItemId, item.duplicate);
    }
  }

  const semanticTopics = new Map<
    string,
    { topicScore: number | null; topicIndex: number | null }
  >();
  const semanticBrandScores = new Map<string, number>();

  if (vectors !== null) {
    const thresholdBp = Math.round(
      configuration.semantic.dedupThreshold * 10_000,
    );
    const { layout } = planSemanticStage(prepared, {
      maxValues: MAX_EMBEDDING_VALUES,
    });
    const pairs = clusterFromVectors(vectors, layout, thresholdBp);

    for (const cluster of clusterBySimilarity(pairs, thresholdBp)) {
      const members = cluster
        .map((sourceItemId) => byId.get(sourceItemId))
        .filter((item) => item !== undefined)
        .filter((item) => !duplicates.has(item.sourceItemId));
      if (members.length < 2) {
        continue;
      }

      const survivor = chooseSurvivor(members.map(toDedupCandidate), freshness);
      for (const member of members) {
        if (member.sourceItemId !== survivor) {
          duplicates.set(member.sourceItemId, {
            method: "semantic",
            ofSourceItemId: survivor,
            similarityBp: similarityOf(pairs, member.sourceItemId, survivor),
          });
        }
      }
    }

    for (const entry of rankFromVectors(vectors, layout)) {
      semanticTopics.set(entry.sourceItemId, {
        topicScore: entry.topicScore,
        topicIndex: entry.topicIndex,
      });
      for (const brand of entry.brandScores) {
        semanticBrandScores.set(
          routeKey(brand.mediaBrandId, entry.sourceItemId),
          brand.score,
        );
      }
    }
  }

  const filterRows: AnalysisRunFilterRow[] = [];
  const shortlists: { mediaBrandId: string; sourceItemIds: string[] }[] = [];
  const lexicalTopics = new Map<
    string,
    { score: number | null; index: number | null }
  >();

  for (const brand of configuration.brands) {
    const admitted = prepared.items.flatMap((item) => {
      if (duplicates.has(item.sourceItemId)) {
        return [];
      }

      const route = item.routes.find(
        (entry) => entry.mediaBrandId === brand.mediaBrandId,
      );
      if (route === undefined) {
        return [];
      }
      if (!route.passed || route.mediaFitScore === null) {
        filterRows.push({
          sourceItemId: item.sourceItemId,
          mediaBrandId: brand.mediaBrandId,
          disposition: "no_media_fit",
          reason: route.reason,
          valueSignalCount: route.valueSignalCount,
          mediaFitScore: route.mediaFitScore,
          sourcePreferenceScore: null,
          diversityScore: null,
          semanticBrandScore: null,
          policyScore: null,
          rankScore: null,
          rankPosition: null,
        });
        return [];
      }

      return [{ item, route, mediaFitScore: route.mediaFitScore }];
    });

    const policyInput = (
      entry: (typeof admitted)[number],
      diversityScore: number,
    ) => ({
      normalizedTitle: entry.item.normalizedTitle,
      normalizedText: entry.item.normalizedText,
      topics,
      aliases: configuration.topicAliases,
      sourceKey: entry.item.sourceKey,
      preferredSourceKeys: brand.editorial.preferredSourceKeys,
      mediaFitScore: entry.mediaFitScore,
      policyViralityScore: entry.item.policyViralityScore ?? 0,
      freshnessScore: entry.item.freshnessScore ?? 0,
      sourceAuthorityScore: entry.item.sourceAuthorityScore ?? 0,
      diversityScore,
      weights: configuration.policy.weights,
      thresholds: configuration.policy.thresholds,
    });

    const ordered = admitted
      .map((entry) => ({
        entry,
        baseScore: scorePolicy(policyInput(entry, 0)).policyScore,
      }))
      .sort(
        (left, right) =>
          right.baseScore - left.baseScore ||
          compare(left.entry.item.sourceItemId, right.entry.item.sourceItemId),
      );
    const diversity = scoreDiversity(
      ordered.map(({ entry }) => ({
        sourceItemId: entry.item.sourceItemId,
        sourceKey: entry.item.sourceKey,
      })),
    );

    const routed: RoutedRow[] = [];

    for (const { entry } of ordered) {
      const diversityScore = diversity.get(entry.item.sourceItemId) ?? 0;
      const policy = scorePolicy(policyInput(entry, diversityScore));
      if (!lexicalTopics.has(entry.item.sourceItemId)) {
        lexicalTopics.set(entry.item.sourceItemId, {
          score: policy.lexicalTopicScore,
          index: policy.lexicalTopicIndex,
        });
      }

      const brandScore = semanticBrandScores.get(
        routeKey(brand.mediaBrandId, entry.item.sourceItemId),
      );

      routed.push({
        item: entry.item,
        route: entry.route,
        mediaFitScore: entry.mediaFitScore,
        policyScore: policy.policyScore,
        sourcePreferenceScore: policy.sourcePreferenceScore,
        diversityScore,
        semanticBrandScore: brandScore ?? null,
        rankScore: scoreRank({
          policyScore: policy.policyScore,
          semantic:
            brandScore === undefined
              ? null
              : {
                  brandScore,
                  topicScore:
                    semanticTopics.get(entry.item.sourceItemId)?.topicScore ??
                    null,
                },
          brandWeight: configuration.semantic.brandWeight,
          topicWeight: configuration.semantic.topicWeight,
        }),
        passed: policy.passed,
      });
    }

    const passing = routed
      .filter((entry) => entry.passed)
      .sort(
        (left, right) =>
          right.rankScore - left.rankScore ||
          right.policyScore - left.policyScore ||
          right.mediaFitScore - left.mediaFitScore ||
          compare(left.item.sourceItemId, right.item.sourceItemId),
      );
    const shortlisted: string[] = [];
    let telegramLaneCount = 0;

    for (const [position, entry] of passing.entries()) {
      let disposition: AnalysisRunFilterRow["disposition"] = "telegram_lane";
      if (entry.item.origin === "rss") {
        if (shortlisted.length < configuration.shortlistCap) {
          disposition = "shortlisted";
          shortlisted.push(entry.item.sourceItemId);
        } else {
          disposition = "cap_exceeded";
        }
      } else if (telegramLaneCount < configuration.telegramLaneCap) {
        telegramLaneCount += 1;
      } else {
        disposition = "cap_exceeded";
      }

      filterRows.push(
        filterRow(entry, brand.mediaBrandId, disposition, {
          position: position + 1,
          score: entry.rankScore,
        }),
      );
    }

    for (const entry of routed) {
      if (!entry.passed) {
        filterRows.push(
          filterRow(entry, brand.mediaBrandId, "low_score", null),
        );
      }
    }

    shortlists.push({
      mediaBrandId: brand.mediaBrandId,
      sourceItemIds: shortlisted,
    });
  }

  const runItems = prepared.items.map((item): AnalysisRunItemScores => {
    const duplicate = duplicates.get(item.sourceItemId) ?? null;
    const semantic = semanticTopics.get(item.sourceItemId);
    const lexical = lexicalTopics.get(item.sourceItemId);

    return {
      sourceItemId: item.sourceItemId,
      eligibility: duplicate === null ? item.eligibility : "duplicate",
      duplicateMethod: duplicate?.method ?? null,
      duplicateOfSourceItemId: duplicate?.ofSourceItemId ?? null,
      duplicateSimilarityBp: duplicate?.similarityBp ?? null,
      sourceAuthorityScore: item.sourceAuthorityScore,
      freshnessScore: item.freshnessScore,
      policyViralityScore: item.policyViralityScore,
      lexicalTopicScore: lexical?.score ?? null,
      lexicalTopicIndex: lexical?.index ?? null,
      semanticTopicScore: semantic?.topicScore ?? null,
      semanticTopicIndex: semantic?.topicIndex ?? null,
      semanticParticipation:
        vectors === null ? null : item.semanticParticipation,
    };
  });

  filterRows.sort(
    (left, right) =>
      compare(left.mediaBrandId, right.mediaBrandId) ||
      compare(left.sourceItemId, right.sourceItemId),
  );

  return { runItems, filterRows, shortlists };
}

type RoutedRow = {
  item: PreparedItem;
  route: PreparedRoute;
  mediaFitScore: number;
  policyScore: number;
  sourcePreferenceScore: number;
  diversityScore: number;
  semanticBrandScore: number | null;
  rankScore: number;
  passed: boolean;
};

function filterRow(
  entry: RoutedRow,
  mediaBrandId: string,
  disposition: AnalysisRunFilterRow["disposition"],
  rank: { position: number; score: number } | null,
): AnalysisRunFilterRow {
  return {
    sourceItemId: entry.item.sourceItemId,
    mediaBrandId,
    disposition,
    reason: null,
    valueSignalCount: entry.route.valueSignalCount,
    mediaFitScore: entry.mediaFitScore,
    sourcePreferenceScore: entry.sourcePreferenceScore,
    diversityScore: entry.diversityScore,
    semanticBrandScore: entry.semanticBrandScore,
    policyScore: entry.policyScore,
    rankScore: rank?.score ?? null,
    rankPosition: rank?.position ?? null,
  };
}

function collapse(
  clusters: readonly (readonly string[])[],
  method: DuplicateMethod,
  similarity: (sourceItemId: string, survivor: string) => number,
  context: {
    dedupInput: readonly DedupCandidate[];
    byId: Map<string, { duplicate: Duplicate | null }>;
    freshness: FreshnessInputs;
  },
) {
  const candidates = new Map(
    context.dedupInput.map((item) => [item.sourceItemId, item]),
  );

  for (const cluster of clusters) {
    const members = cluster
      .map((sourceItemId) => candidates.get(sourceItemId))
      .filter((item) => item !== undefined)
      .filter((item) => context.byId.get(item.sourceItemId)?.duplicate == null);
    if (members.length < 2) {
      continue;
    }

    const survivor = chooseSurvivor(members, context.freshness);
    for (const member of members) {
      if (member.sourceItemId === survivor) {
        continue;
      }

      const item = context.byId.get(member.sourceItemId);
      if (item !== undefined) {
        item.duplicate = {
          method,
          ofSourceItemId: survivor,
          similarityBp: similarity(member.sourceItemId, survivor),
        };
      }
    }
  }
}

function similarityOf(
  pairs: readonly SimilarityPair[],
  sourceItemId: string,
  survivor: string,
): number {
  let best = 0;

  for (const pair of pairs) {
    if (
      (pair.sourceItemId === sourceItemId &&
        pair.otherSourceItemId === survivor) ||
      (pair.sourceItemId === survivor &&
        pair.otherSourceItemId === sourceItemId)
    ) {
      return pair.similarityBp;
    }
    if (
      pair.sourceItemId === sourceItemId ||
      pair.otherSourceItemId === sourceItemId
    ) {
      best = Math.max(best, pair.similarityBp);
    }
  }

  return best;
}

function toDedupCandidate(item: PreparedItem): DedupCandidate {
  return {
    sourceItemId: item.sourceItemId,
    canonicalUrl: "",
    normalizedTitle: item.normalizedTitle,
    publishedAt: item.publishedAt,
    sourceAuthorityScore: item.sourceAuthorityScore ?? 0,
    contentLength: Array.from(item.normalizedText).length,
  };
}

function resolveAuthority(
  configuration: PipelineConfiguration,
  sourceKey: string,
): number {
  return (
    configuration.policy.sourceAuthority[sourceKey] ??
    configuration.policy.unknownSourceAuthority
  );
}

function routeKey(mediaBrandId: string, sourceItemId: string): string {
  return `${mediaBrandId} ${sourceItemId}`;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
