import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  duplicateMethodSchema,
  filterDispositionSchema,
  filteringReasonSchema,
  itemEligibilitySchema,
  MAX_EMBEDDING_VALUES,
} from "@rz-chain-reporter/contracts/editorial";
import { sourceOriginSchema } from "@rz-chain-reporter/contracts/platform";
import { customerTemplateSchema } from "@rz-chain-reporter/customer-template/schema";
import type {
  AnalysisRunFilterRow,
  AnalysisRunItemScores,
} from "@rz-chain-reporter/db/repositories/analysis-run";
import { z } from "zod";

import type {
  CandidateItem,
  CandidateRevision,
  PipelineConfiguration,
  Prepared,
} from "./pipeline";
import { prepareCandidates, scoreAndRoute } from "./pipeline";
import { planSemanticStage, SemanticVectorError } from "./semantic";

const EXIT_FAILURE = 1;

const fixtureItemSchema = z.strictObject({
  sourceItemId: z.uuid(),
  sourceItemRevisionId: z.uuid(),
  sourceKey: z.string(),
  origin: sourceOriginSchema,
  publishedAt: z.iso.datetime().nullable(),
  eligibility: itemEligibilitySchema,
  title: z.string(),
  summary: z.string().nullable(),
  canonicalUrl: z.string(),
  vector: z.array(z.number()),
});

const fixtureSchema = z.strictObject({
  template: customerTemplateSchema,
  runStartedAt: z.iso.datetime(),
  topics: z.array(z.string()),
  telegramLaneCap: z.int().min(1),
  brands: z.array(z.strictObject({ key: z.string(), mediaBrandId: z.uuid() })),
  items: z.array(fixtureItemSchema),
  topicVectors: z.array(z.array(z.number())),
  anchorVectors: z.record(z.string(), z.array(z.array(z.number()))),
  expected: z.strictObject({
    digests: z.strictObject({ succeeded: z.string(), degraded: z.string() }),
    items: z.array(
      z.strictObject({
        sourceItemId: z.uuid(),
        eligibility: itemEligibilitySchema,
        duplicateMethod: duplicateMethodSchema.nullable(),
        duplicateOfSourceItemId: z.uuid().nullable(),
        freshnessScore: z.int().nullable(),
      }),
    ),
    routes: z.array(
      z.strictObject({
        sourceItemId: z.uuid(),
        brandKey: z.string(),
        disposition: filterDispositionSchema,
        reason: filteringReasonSchema.nullable(),
        valueSignalCount: z.int().nullable(),
        mediaFitScore: z.int().nullable().optional(),
        rankPosition: z.int().nullable(),
      }),
    ),
    topicRelevanceRejected: z.array(
      z.strictObject({
        sourceItemId: z.uuid(),
        brandKey: z.string(),
        lexicalTopicScore: z.int(),
      }),
    ),
    boundedSummaryRejected: z.array(
      z.strictObject({ sourceItemId: z.uuid(), brandKey: z.string() }),
    ),
    originCaps: z.array(
      z.strictObject({
        brandKey: z.string(),
        rssShortlisted: z.int().nonnegative(),
        telegramLane: z.int().nonnegative(),
        rssCapExceeded: z.int().nonnegative(),
        telegramCapExceeded: z.int().nonnegative(),
      }),
    ),
  }),
});

type Fixture = z.infer<typeof fixtureSchema>;
type Outcome = ReturnType<typeof scoreAndRoute>;

const [command, path] = process.argv.slice(2);

if (command !== "fixture" || path === undefined) {
  console.error("usage: editorial fixture <frozen.json>");
  process.exitCode = EXIT_FAILURE;
} else {
  process.exitCode = (await runFixture(path)) ? 0 : EXIT_FAILURE;
}

async function runFixture(fixturePath: string): Promise<boolean> {
  const fixture = fixtureSchema.parse(
    JSON.parse(await readFile(fixturePath, "utf8")),
  );
  const configuration = buildConfiguration(fixture);
  const prepared = prepare(fixture, configuration, fixture.items);
  const vectors = layoutVectors(fixture, prepared);

  const succeeded = scoreAndRoute(prepared, vectors);
  const degraded = scoreAndRoute(prepared, null);
  const shuffledPrepared = prepare(
    fixture,
    configuration,
    [...fixture.items].reverse(),
  );
  const shuffled = scoreAndRoute(
    shuffledPrepared,
    layoutVectors(fixture, shuffledPrepared),
  );
  const reversedBrandConfiguration = {
    ...configuration,
    brands: [...configuration.brands].reverse(),
  };
  const reversedBrandPrepared = prepare(
    fixture,
    reversedBrandConfiguration,
    fixture.items,
  );
  const reversedBrands = scoreAndRoute(
    reversedBrandPrepared,
    layoutVectors(fixture, reversedBrandPrepared),
  );
  const rssOnlyPrepared = prepare(
    fixture,
    configuration,
    fixture.items.filter((item) => item.origin === "rss"),
  );
  const rssOnly = scoreAndRoute(
    rssOnlyPrepared,
    layoutVectors(fixture, rssOnlyPrepared),
  );

  const succeededDigest = digest(succeeded);
  const degradedDigest = digest(degraded);

  report("succeeded", succeededDigest, succeeded);
  report("degraded", degradedDigest, degraded);
  report("shuffled", digest(shuffled), shuffled);
  report("reversed-brands", digest(reversedBrands), reversedBrands);
  report("rss-only", digest(rssOnly), rssOnly);

  const checks = [
    check(
      "digest.succeeded",
      succeededDigest === fixture.expected.digests.succeeded,
    ),
    check(
      "digest.degraded",
      degradedDigest === fixture.expected.digests.degraded,
    ),
    check("digest.distinct", succeededDigest !== degradedDigest),
    check("digest.shuffled", digest(shuffled) === succeededDigest),
    check(
      "caps.input_order",
      sameOriginCapDispositions(fixture, succeeded, shuffled),
    ),
    check(
      "topics.brand_order",
      sameTopicScores(succeeded.runItems, reversedBrands.runItems),
    ),
    check("telegram.rss_dispositions", sameRssDispositions(succeeded, rssOnly)),
    check(
      "semantic.vector_count",
      throwsWith(
        () => scoreAndRoute(prepared, vectors.slice(1)),
        "dimension_mismatch",
      ),
    ),
    check(
      "semantic.dimension",
      throwsWith(
        () => scoreAndRoute(prepared, truncateFirst(vectors)),
        "dimension_mismatch",
      ),
    ),
    check(
      "semantic.non_finite",
      throwsWith(
        () => scoreAndRoute(prepared, poisonFirst(vectors)),
        "non_finite_value",
      ),
    ),
    ...expectedItemChecks(fixture, succeeded.runItems),
    ...expectedRouteChecks(fixture, succeeded.filterRows),
    ...expectedTopicRelevanceChecks(fixture, succeeded),
    ...expectedBoundedSummaryChecks(fixture, succeeded),
    ...expectedOriginCapChecks(fixture, succeeded),
  ];

  return checks.every((passed) => passed);
}

function buildConfiguration(fixture: Fixture): PipelineConfiguration {
  const brands = new Map(
    fixture.template.mediaBrands.map((brand) => [brand.key, brand.editorial]),
  );

  return {
    policy: fixture.template.editorial.policy,
    semantic: fixture.template.editorial.semantic,
    shortlistCap: fixture.template.editorial.shortlistCap,
    telegramLaneCap: fixture.telegramLaneCap,
    topicAliases: fixture.template.editorial.topicAliases,
    brands: fixture.brands.map((brand) => {
      const editorial = brands.get(brand.key);
      if (editorial === undefined) {
        throw new Error(`FIXTURE_UNKNOWN_BRAND ${brand.key}`);
      }
      return { mediaBrandId: brand.mediaBrandId, editorial };
    }),
  };
}

function prepare(
  fixture: Fixture,
  configuration: PipelineConfiguration,
  items: readonly Fixture["items"][number][],
): Prepared {
  return prepareCandidates({
    items: items.map(
      (item): CandidateItem => ({
        sourceItemId: item.sourceItemId,
        sourceItemRevisionId: item.sourceItemRevisionId,
        sourceKey: item.sourceKey,
        origin: item.origin,
        publishedAt:
          item.publishedAt === null ? null : new Date(item.publishedAt),
        eligibility: item.eligibility,
      }),
    ),
    revisions: items.map(
      (item): CandidateRevision => ({
        sourceItemRevisionId: item.sourceItemRevisionId,
        title: item.title,
        summary: item.summary,
        canonicalUrl: item.canonicalUrl,
      }),
    ),
    runStartedAt: new Date(fixture.runStartedAt),
    configuration,
    topicGroups: fixture.topics.map((topic) => ({
      original: topic,
      effective: topic,
    })),
  });
}

function layoutVectors(fixture: Fixture, prepared: Prepared): number[][] {
  const { layout } = planSemanticStage(prepared, {
    maxValues: MAX_EMBEDDING_VALUES,
  });
  const itemVectors = new Map(
    fixture.items.map((item) => [item.sourceItemId, item.vector]),
  );
  const brandKeys = new Map(
    fixture.brands.map((brand) => [brand.mediaBrandId, brand.key]),
  );
  const vectors: number[][] = [];

  for (const sourceItemId of layout.itemIds) {
    const vector = itemVectors.get(sourceItemId);
    if (vector === undefined) {
      throw new Error(`FIXTURE_MISSING_VECTOR ${sourceItemId}`);
    }
    vectors.push(vector);
  }

  vectors.push(...fixture.topicVectors.slice(0, layout.topicCount));

  for (const brand of layout.brands) {
    const key = brandKeys.get(brand.mediaBrandId);
    const anchors = key === undefined ? undefined : fixture.anchorVectors[key];
    if (anchors === undefined || anchors.length < brand.anchorCount) {
      throw new Error(`FIXTURE_MISSING_ANCHORS ${key ?? brand.mediaBrandId}`);
    }
    vectors.push(...anchors.slice(0, brand.anchorCount));
  }

  return vectors;
}

function digest(outcome: Outcome): string {
  const lines: string[] = [];

  for (const item of [...outcome.runItems].sort((left, right) =>
    left.sourceItemId < right.sourceItemId ? -1 : 1,
  )) {
    lines.push(
      [
        "item",
        item.sourceItemId,
        item.eligibility,
        item.duplicateMethod,
        item.duplicateOfSourceItemId,
        item.duplicateSimilarityBp,
        item.sourceAuthorityScore,
        item.freshnessScore,
        item.policyViralityScore,
        item.lexicalTopicScore,
        item.lexicalTopicIndex,
        item.semanticTopicScore,
        item.semanticTopicIndex,
        item.semanticParticipation,
      ].join("|"),
    );
  }

  for (const row of outcome.filterRows) {
    lines.push(
      [
        "route",
        row.mediaBrandId,
        row.sourceItemId,
        row.disposition,
        row.reason,
        row.valueSignalCount,
        row.mediaFitScore,
        row.sourcePreferenceScore,
        row.diversityScore,
        row.semanticBrandScore,
        row.policyScore,
        row.rankScore,
        row.rankPosition,
      ].join("|"),
    );
  }

  for (const shortlist of outcome.shortlists) {
    lines.push(
      ["shortlist", shortlist.mediaBrandId, ...shortlist.sourceItemIds].join(
        "|",
      ),
    );
  }

  return createHash("sha256").update(lines.join("\n")).digest("hex");
}

function report(pass: string, value: string, outcome: Outcome) {
  const counts = new Map<string, number>();
  for (const row of outcome.filterRows) {
    counts.set(row.disposition, (counts.get(row.disposition) ?? 0) + 1);
  }

  console.log(
    `pass=${pass} digest=${value} items=${outcome.runItems.length}` +
      ` duplicates=${outcome.runItems.filter((item) => item.eligibility === "duplicate").length}` +
      ` routes=${outcome.filterRows.length}` +
      ` shortlisted=${counts.get("shortlisted") ?? 0}` +
      ` telegram_lane=${counts.get("telegram_lane") ?? 0}` +
      ` cap_exceeded=${counts.get("cap_exceeded") ?? 0}` +
      ` low_score=${counts.get("low_score") ?? 0}` +
      ` no_media_fit=${counts.get("no_media_fit") ?? 0}`,
  );
}

function check(name: string, passed: boolean, detail = ""): boolean {
  console.log(
    `check=${name} status=${passed ? "pass" : "fail"}${detail === "" ? "" : ` detail=${detail}`}`,
  );
  return passed;
}

function expectedItemChecks(
  fixture: Fixture,
  runItems: readonly AnalysisRunItemScores[],
): boolean[] {
  const byId = new Map(runItems.map((item) => [item.sourceItemId, item]));

  return fixture.expected.items.map((expected) => {
    const actual = byId.get(expected.sourceItemId);
    const passed =
      actual !== undefined &&
      actual.eligibility === expected.eligibility &&
      actual.duplicateMethod === expected.duplicateMethod &&
      actual.duplicateOfSourceItemId === expected.duplicateOfSourceItemId &&
      actual.freshnessScore === expected.freshnessScore;

    return check(
      `item.${expected.sourceItemId}`,
      passed,
      passed
        ? ""
        : `eligibility=${actual?.eligibility} duplicateMethod=${actual?.duplicateMethod} duplicateOf=${actual?.duplicateOfSourceItemId} freshness=${actual?.freshnessScore}`,
    );
  });
}

function expectedRouteChecks(
  fixture: Fixture,
  filterRows: readonly AnalysisRunFilterRow[],
): boolean[] {
  const brandIds = new Map(
    fixture.brands.map((brand) => [brand.key, brand.mediaBrandId]),
  );
  const byRoute = new Map(
    filterRows.map((row) => [`${row.mediaBrandId} ${row.sourceItemId}`, row]),
  );

  return fixture.expected.routes.map((expected) => {
    const actual = byRoute.get(
      `${brandIds.get(expected.brandKey) ?? ""} ${expected.sourceItemId}`,
    );
    const passed =
      actual !== undefined &&
      actual.disposition === expected.disposition &&
      actual.reason === expected.reason &&
      actual.valueSignalCount === expected.valueSignalCount &&
      (expected.mediaFitScore === undefined ||
        actual.mediaFitScore === expected.mediaFitScore) &&
      actual.rankPosition === expected.rankPosition;

    return check(
      `route.${expected.brandKey}.${expected.sourceItemId}`,
      passed,
      passed
        ? ""
        : `disposition=${actual?.disposition} reason=${actual?.reason} valueSignalCount=${actual?.valueSignalCount} mediaFitScore=${actual?.mediaFitScore} rankPosition=${actual?.rankPosition}`,
    );
  });
}

function sameRssDispositions(withTelegram: Outcome, rssOnly: Outcome): boolean {
  const baseline = new Map(
    rssOnly.filterRows.map((row) => [
      `${row.mediaBrandId} ${row.sourceItemId}`,
      row.disposition,
    ]),
  );

  for (const row of withTelegram.filterRows) {
    if (row.disposition === "telegram_lane") {
      continue;
    }
    const key = `${row.mediaBrandId} ${row.sourceItemId}`;
    if (!baseline.has(key)) {
      continue;
    }
    if (baseline.get(key) !== row.disposition) {
      return false;
    }
  }

  return true;
}

function sameOriginCapDispositions(
  fixture: Fixture,
  outcome: Outcome,
  shuffled: Outcome,
): boolean {
  const origins = new Map(
    fixture.items.map((item) => [item.sourceItemId, item.origin]),
  );
  const dispositions = (candidate: Outcome) =>
    candidate.filterRows
      .filter(
        (row) =>
          row.disposition === "shortlisted" ||
          row.disposition === "telegram_lane" ||
          row.disposition === "cap_exceeded",
      )
      .map((row) =>
        [
          row.mediaBrandId,
          row.sourceItemId,
          origins.get(row.sourceItemId),
          row.disposition,
        ].join(" "),
      )
      .sort();

  return dispositions(outcome).join("\n") === dispositions(shuffled).join("\n");
}

function sameTopicScores(
  outcome: readonly AnalysisRunItemScores[],
  reversedBrands: readonly AnalysisRunItemScores[],
): boolean {
  const baseline = new Map(
    outcome.map((item) => [
      item.sourceItemId,
      `${item.lexicalTopicScore} ${item.lexicalTopicIndex}`,
    ]),
  );

  return (
    outcome.length === reversedBrands.length &&
    reversedBrands.every(
      (item) =>
        baseline.get(item.sourceItemId) ===
        `${item.lexicalTopicScore} ${item.lexicalTopicIndex}`,
    )
  );
}

function expectedTopicRelevanceChecks(
  fixture: Fixture,
  outcome: Outcome,
): boolean[] {
  const brandIds = new Map(
    fixture.brands.map((brand) => [brand.key, brand.mediaBrandId]),
  );
  const runItems = new Map(
    outcome.runItems.map((item) => [item.sourceItemId, item]),
  );
  const routes = new Map(
    outcome.filterRows.map((row) => [
      `${row.mediaBrandId} ${row.sourceItemId}`,
      row,
    ]),
  );

  return fixture.expected.topicRelevanceRejected.map((expected) => {
    const item = runItems.get(expected.sourceItemId);
    const route = routes.get(
      `${brandIds.get(expected.brandKey) ?? ""} ${expected.sourceItemId}`,
    );
    const passed =
      fixture.topics.length > 0 &&
      item?.lexicalTopicScore === expected.lexicalTopicScore &&
      route?.disposition === "low_score";

    return check(
      `topic_relevance.${expected.brandKey}.${expected.sourceItemId}`,
      passed,
      passed
        ? ""
        : `lexicalTopicScore=${item?.lexicalTopicScore} disposition=${route?.disposition}`,
    );
  });
}

function expectedBoundedSummaryChecks(
  fixture: Fixture,
  outcome: Outcome,
): boolean[] {
  const brandIds = new Map(
    fixture.brands.map((brand) => [brand.key, brand.mediaBrandId]),
  );
  const runItems = new Map(
    outcome.runItems.map((item) => [item.sourceItemId, item]),
  );
  const routes = new Map(
    outcome.filterRows.map((row) => [
      `${row.mediaBrandId} ${row.sourceItemId}`,
      row,
    ]),
  );

  return fixture.expected.boundedSummaryRejected.map((expected) => {
    const item = runItems.get(expected.sourceItemId);
    const route = routes.get(
      `${brandIds.get(expected.brandKey) ?? ""} ${expected.sourceItemId}`,
    );
    const passed =
      item?.lexicalTopicScore === null && route?.disposition === "no_media_fit";

    return check(
      `bounded_summary.${expected.brandKey}.${expected.sourceItemId}`,
      passed,
      passed
        ? ""
        : `lexicalTopicScore=${item?.lexicalTopicScore} disposition=${route?.disposition}`,
    );
  });
}

function expectedOriginCapChecks(
  fixture: Fixture,
  outcome: Outcome,
): boolean[] {
  const brandIds = new Map(
    fixture.brands.map((brand) => [brand.key, brand.mediaBrandId]),
  );
  const origins = new Map(
    fixture.items.map((item) => [item.sourceItemId, item.origin]),
  );

  return fixture.expected.originCaps.map((expected) => {
    const mediaBrandId = brandIds.get(expected.brandKey);
    const rows = outcome.filterRows.filter(
      (row) => row.mediaBrandId === mediaBrandId,
    );
    const count = (origin: "rss" | "telegram_public", disposition: string) =>
      rows.filter(
        (row) =>
          origins.get(row.sourceItemId) === origin &&
          row.disposition === disposition,
      ).length;
    const actual = {
      rssShortlisted: count("rss", "shortlisted"),
      telegramLane: count("telegram_public", "telegram_lane"),
      rssCapExceeded: count("rss", "cap_exceeded"),
      telegramCapExceeded: count("telegram_public", "cap_exceeded"),
    };
    const passed =
      actual.rssShortlisted === expected.rssShortlisted &&
      actual.telegramLane === expected.telegramLane &&
      actual.rssCapExceeded === expected.rssCapExceeded &&
      actual.telegramCapExceeded === expected.telegramCapExceeded;

    return check(
      `caps.${expected.brandKey}`,
      passed,
      passed ? "" : JSON.stringify(actual),
    );
  });
}

function throwsWith(run: () => unknown, reason: string): boolean {
  try {
    run();
  } catch (error) {
    return error instanceof SemanticVectorError && error.reason === reason;
  }

  return false;
}

function truncateFirst(vectors: readonly number[][]): number[][] {
  return vectors.map((vector, index) =>
    index === 0 ? vector.slice(0, -1) : vector,
  );
}

function poisonFirst(vectors: readonly number[][]): number[][] {
  return vectors.map((vector, index) =>
    index === 0 ? [Number.NaN, ...vector.slice(1)] : vector,
  );
}
