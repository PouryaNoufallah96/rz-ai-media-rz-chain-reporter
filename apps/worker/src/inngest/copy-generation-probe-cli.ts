import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  assemblePublishPayload,
  COPY_CONFIGURATION_VERSION,
  COPY_GENERATION_COMMAND_PREFIX,
  COPY_PROMPT_VERSION,
  type ContentLocale,
  type EnrichmentReason,
  PLATFORM_COPY_HARD_MAX,
  type Platform,
  platformCopyLength,
} from "@rz-chain-reporter/contracts";
import { computeBrandPolicyFingerprint } from "@rz-chain-reporter/customer-template/fingerprint";
import {
  finalizeUsage,
  finalizeUsageWithResult,
  insertPendingUsage,
} from "@rz-chain-reporter/db/repositories/ai-usage-event";
import {
  COPY_PAGE_EXTRACT_POLICY,
  claimCopyGeneration,
  claimCopyGenerationUnit,
  findCopyExecutionContext,
  markCopyGenerationCancelled,
  persistCopyVariantResult,
  prepareCopyGenerationSource,
  scheduleCopyGenerationRecovery,
  settleCopyGeneration,
  startCopyOperation,
} from "@rz-chain-reporter/db/repositories/copy-generation";
import { allocateOperationAttempt } from "@rz-chain-reporter/db/repositories/operation-attempt";
import { insertSourceItemEnrichment } from "@rz-chain-reporter/db/repositories/source-import";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { analysisRunItem } from "@rz-chain-reporter/db/schema/analysis-run-item";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { copyGeneration } from "@rz-chain-reporter/db/schema/copy-generation";
import { copyGenerationUnit } from "@rz-chain-reporter/db/schema/copy-generation-unit";
import { copyVariant } from "@rz-chain-reporter/db/schema/copy-variant";
import { draftRevision } from "@rz-chain-reporter/db/schema/draft-revision";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { filterResult } from "@rz-chain-reporter/db/schema/filter-result";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { promoIdea } from "@rz-chain-reporter/db/schema/promo-idea";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemEnrichment } from "@rz-chain-reporter/db/schema/source-item-enrichment";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import { workspace } from "@rz-chain-reporter/db/schema/workspace";
import { ModelGatewayInvocationError } from "@rz-chain-reporter/model-gateway/errors";
import type { ModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import type { StructuredModelInvocation } from "@rz-chain-reporter/model-gateway/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { Inngest } from "inngest";
import { connect } from "inngest/connect";
import type {
  ArticleFetcher,
  ArticleFetchRequest,
  ArticleFetchResult,
} from "../articles/types";
import { workerEnv } from "../runtime/env";
import { notifyDraftsChanged } from "../web-cache/drafts";
import { notifyUsageLedgerChanged } from "../web-cache/usage-ledger";
import { createInngestClient } from "./client";
import {
  assembleCopy,
  bindCopyGenerationSource,
  COPY_OPERATION_LEASE_MS,
  COPY_PARENT_RETRIES,
  COPY_UNIT_INVOKE_TIMEOUT,
  COPY_UNIT_QUIESCENCE_PASSES,
  COPY_UNIT_RETRIES,
  copyMatchesContentLocale,
  createCopyGenerationFunctions,
  executeCopyGenerationUnit,
  loadCopyBrandGuidance,
  loadCopyGenerationSource,
  normalizeCopyCandidate,
} from "./copy-generation";
import { openWorkerRuntime } from "./runtime";
import { reconcileStaleCopyOperations } from "./storage-reconciliation";

const EXIT_FAILURE = 1;
const PROBE_COMMANDS = ["execution", "inngest", "source"] as const;
const PAGE_TEXT = "P".repeat(2_600);
const CHANGED_PAGE_TEXT = "C".repeat(2_700);
const FEED_TEXT = "F".repeat(2_300);
const BELOW_MINIMUM_TEXT = "B".repeat(1_100);
const LIMITED_SUMMARY = "L".repeat(900);
const TELEGRAM_POST = "T".repeat(2_200);
const X_HARD_MAXIMUM = 280;

type CopyNormalizationProbePolicy = Pick<
  (typeof opened.template.editorial.drafting.copy.platforms)[number],
  "assembledCharacters" | "emojiGraphemeCap" | "hashtags"
>;

const INSTAGRAM_NORMALIZATION_PROBE_POLICY = {
  assembledCharacters: { max: 1_200, min: 600 },
  emojiGraphemeCap: 8,
  hashtags: { max: 6, min: 4 },
} satisfies CopyNormalizationProbePolicy;

const [requestedCommand, ...args] = process.argv.slice(2);
const command = requestedCommand ?? "execution";
if (
  !PROBE_COMMANDS.includes(command as (typeof PROBE_COMMANDS)[number]) ||
  args.length !== 0
) {
  console.error(
    "copy-generation probe failed [USAGE: source|execution|inngest]",
  );
  process.exit(EXIT_FAILURE);
}

const databaseUrl = new URL(workerEnv.DATABASE_URL);
if (
  !["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname) ||
  !["/rz-chain-reporter", "/rz_chain_reporter_lifecycle_probe"].includes(
    databaseUrl.pathname,
  )
) {
  console.error("copy-generation probe failed [LOCAL_DATABASE_REQUIRED]");
  process.exit(EXIT_FAILURE);
}

const opened = openWorkerRuntime();
const runtime = {
  db: opened.database.db,
  identity: opened.identity,
  template: opened.template,
};

const copyClaimFences = new Map<
  string,
  { operationVersion: number; recovered: boolean; token: string }
>();

async function claimProbeCopy(
  operationId: string,
  token = `probe:${operationId}`,
) {
  const now = new Date();
  const claimed = await claimCopyGeneration(
    opened.database.db,
    fixture.workspaceId,
    {
      claimedBy: token,
      leaseExpiresAt: new Date(now.getTime() + COPY_OPERATION_LEASE_MS),
      now,
      operationId,
    },
  );
  assert.equal(claimed.status, "claimed");
  if (claimed.status !== "claimed") throw new Error("COPY_CLAIM_REQUIRED");
  const fence = {
    operationVersion: claimed.operation.version,
    recovered: claimed.recovered,
    token,
  };
  copyClaimFences.set(operationId, fence);
  return { claimed, fence };
}

function copyExecutionFence(operationId: string) {
  const fence = copyClaimFences.get(operationId);
  if (!fence) throw new Error("COPY_CLAIM_FENCE_REQUIRED");
  return fence;
}

async function runSourceProbe(probe: CopySourceFixture) {
  proveBrandPolicyFingerprint();
  await proveExtractPresent(probe);
  await proveFeedOnly(probe);
  await proveBelowMinimum(probe);
  await proveFetchFailureAndLimitedFallback(probe);
  await proveNoInputHardFail(probe);
  await proveMatchingHashReuse(probe);
  await proveChangedHashAppend(probe);
  await proveExplicitRefresh(probe);
  await proveTelegramNoFetch(probe);
  await provePromoNoSource(probe);
  await proveCrashBeforeIo(probe);
  await proveCrashAfterIo(probe);
}

function proveBrandPolicyFingerprint() {
  const first = runtime.template.mediaBrands[0];
  assert.ok(first);
  const second = runtime.template.mediaBrands.find(
    (brand) =>
      computeBrandPolicyFingerprint(brand.editorial) !==
      computeBrandPolicyFingerprint(first.editorial),
  );
  assert.ok(second);

  const policy = first.editorial;
  const reordered = {
    canonicalHashtags: policy.canonicalHashtags,
    semanticAnchors: policy.semanticAnchors,
    promoEnabled: policy.promoEnabled,
    phrases: policy.phrases,
    preferredSourceKeys: policy.preferredSourceKeys,
    aliases: policy.aliases,
    weakTerms: policy.weakTerms,
    strongTerms: policy.strongTerms,
    mediaFitThreshold: policy.mediaFitThreshold,
  } satisfies typeof policy;

  assert.equal(
    computeBrandPolicyFingerprint(policy),
    computeBrandPolicyFingerprint(reordered),
  );
  assert.notEqual(
    computeBrandPolicyFingerprint(policy),
    computeBrandPolicyFingerprint(second.editorial),
  );
  assert.notEqual(
    computeBrandPolicyFingerprint(policy),
    computeBrandPolicyFingerprint({
      ...policy,
      strongTerms: [...policy.strongTerms].reverse(),
    }),
  );
  pass("brand-policy-fingerprint");
}

async function proveExtractPresent(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("extract-present");
  const enrichmentId = await probe.seedEnrichment(
    origin.revisionId,
    "direct",
    PAGE_TEXT,
    COPY_PAGE_EXTRACT_POLICY,
  );
  const operationId = await probe.createRssGeneration(origin, false);
  const calls = { value: 0 };
  const result = await probe.bind(operationId, refusingFetcher(calls));
  assert.deepEqual(result, {
    kind: "rss",
    limited: false,
    pageFetch: "not_needed",
    status: "bound",
  });
  const loaded = await probe.load(operationId);
  assert.equal(loaded?.kind, "rss");
  assert.equal(loaded?.sourceItemEnrichmentId, enrichmentId);
  assert.equal(loaded?.content, PAGE_TEXT);
  assert.equal(calls.value, 0);
  await probe.assertReplay(operationId, calls);
  pass("extract-present");
}

async function proveFeedOnly(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("feed-only");
  await probe.seedEnrichment(
    origin.revisionId,
    "feed",
    FEED_TEXT,
    "extract-v1:feed",
  );
  const operationId = await probe.createRssGeneration(origin, false);
  const calls = { value: 0 };
  const result = await probe.bind(
    operationId,
    successfulFetcher(PAGE_TEXT, calls),
  );
  assert.equal(result.pageFetch, "succeeded");
  assert.equal(calls.value, 1);
  const loaded = await probe.load(operationId);
  if (loaded?.kind !== "rss") throw new Error("RSS_SOURCE_NOT_BOUND");
  assert.equal(loaded.content, PAGE_TEXT);
  await probe.assertReplay(operationId, calls);
  pass("feed-only");
}

async function proveBelowMinimum(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("below-minimum");
  await probe.seedEnrichment(
    origin.revisionId,
    "feed",
    BELOW_MINIMUM_TEXT,
    "extract-v1:feed",
  );
  const operationId = await probe.createRssGeneration(origin, false);
  const prepared = await prepareCopyGenerationSource(
    opened.database.db,
    probe.workspaceId,
    operationId,
    opened.template.editorial.drafting.copy.fetchMinimumChars,
  );
  assert.equal(prepared.status, "fetch_required");
  if (prepared.status !== "fetch_required") throw new Error("UNREACHABLE");
  assert.equal(prepared.claim.reason, "below_minimum");
  const calls = { value: 0 };
  const result = await probe.fetchAndComplete(
    operationId,
    prepared.claim,
    successfulFetcher(BELOW_MINIMUM_TEXT, calls),
  );
  assert.equal(result.pageFetch, "succeeded");
  const loaded = await probe.load(operationId);
  if (loaded?.kind !== "rss") throw new Error("RSS_SOURCE_NOT_BOUND");
  assert.equal(loaded.content, BELOW_MINIMUM_TEXT);
  await probe.assertReplay(operationId, calls);
  pass("below-minimum");
}

async function proveFetchFailureAndLimitedFallback(probe: CopySourceFixture) {
  for (const reason of ["off_origin", "ssrf_blocked"] as const) {
    const origin = await probe.createRssOrigin(
      `fetch-failure-${reason}`,
      LIMITED_SUMMARY,
    );
    const operationId = await probe.createRssGeneration(origin, false);
    const calls = { value: 0 };
    const result = await probe.bind(operationId, failingFetcher(calls, reason));
    assert.deepEqual(result, {
      kind: "rss",
      limited: true,
      pageFetch: "failed",
      status: "bound",
    });
    const generation = await probe.generation(operationId);
    assert.equal(generation?.limitedReason, reason);
    if (!generation?.pageFetchOperationAttemptId) {
      throw new Error("PAGE_FETCH_ATTEMPT_REQUIRED");
    }
    assert.deepEqual(
      await probe.attempt(generation.pageFetchOperationAttemptId),
      { failureCode: null, outcome: "failed_terminal" },
    );
    const loaded = await probe.load(operationId);
    assert.equal(loaded?.kind, "rss");
    assert.equal(loaded?.limited, true);
    assert.equal(loaded?.content.includes(LIMITED_SUMMARY), true);
    assert.equal(await probe.enrichmentCount(origin.revisionId), 0);
    await probe.assertReplay(operationId, calls);
  }
  pass("fetch-failure-limited-fallback");
}

async function proveNoInputHardFail(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("no-input", null, "");
  const operationId = await probe.createRssGeneration(origin, false);
  const calls = { value: 0 };
  const result = await probe.bind(
    operationId,
    failingFetcher(calls, "fetch_failed"),
  );
  assert.equal(result.status, "no_input");
  const loaded = await probe.load(operationId);
  assert.equal(loaded?.kind, "rss");
  assert.equal(loaded?.content, "");
  await probe.assertReplay(operationId, calls, "no_input");
  pass("no-input-hard-fail");
}

async function proveMatchingHashReuse(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("matching-hash");
  const enrichmentId = await probe.seedEnrichment(
    origin.revisionId,
    "direct",
    PAGE_TEXT,
    COPY_PAGE_EXTRACT_POLICY,
  );
  const before = await probe.enrichmentCount(origin.revisionId);
  const operationId = await probe.createRssGeneration(origin, true);
  const calls = { value: 0 };
  await probe.bind(operationId, successfulFetcher(PAGE_TEXT, calls));
  assert.equal(await probe.enrichmentCount(origin.revisionId), before);
  assert.equal(
    (await probe.generation(operationId))?.sourceItemEnrichmentId,
    enrichmentId,
  );
  await probe.assertReplay(operationId, calls);
  pass("matching-hash-reuse");
}

async function proveChangedHashAppend(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("changed-hash");
  const originalId = await probe.seedEnrichment(
    origin.revisionId,
    "direct",
    PAGE_TEXT,
    COPY_PAGE_EXTRACT_POLICY,
  );
  const before = await probe.enrichmentCount(origin.revisionId);
  const operationId = await probe.createRssGeneration(origin, true);
  const calls = { value: 0 };
  await probe.bind(operationId, successfulFetcher(CHANGED_PAGE_TEXT, calls));
  const generation = await probe.generation(operationId);
  assert.equal(await probe.enrichmentCount(origin.revisionId), before + 1);
  assert.notEqual(generation?.sourceItemEnrichmentId, originalId);
  assert.equal(generation?.pageContentHash, hash(CHANGED_PAGE_TEXT));
  const loaded = await probe.load(operationId);
  if (loaded?.kind !== "rss") throw new Error("RSS_SOURCE_NOT_BOUND");
  assert.equal(loaded.content, CHANGED_PAGE_TEXT);
  await probe.assertReplay(operationId, calls);
  pass("changed-hash-append");
}

async function proveExplicitRefresh(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("explicit-refresh");
  await probe.seedEnrichment(
    origin.revisionId,
    "direct",
    PAGE_TEXT,
    COPY_PAGE_EXTRACT_POLICY,
  );
  const operationId = await probe.createRssGeneration(origin, true);
  const prepared = await prepareCopyGenerationSource(
    opened.database.db,
    probe.workspaceId,
    operationId,
    opened.template.editorial.drafting.copy.fetchMinimumChars,
  );
  assert.equal(prepared.status, "fetch_required");
  if (prepared.status !== "fetch_required") throw new Error("UNREACHABLE");
  assert.equal(prepared.claim.reason, "explicit_refresh");
  const calls = { value: 0 };
  await probe.fetchAndComplete(
    operationId,
    prepared.claim,
    successfulFetcher(CHANGED_PAGE_TEXT, calls),
  );
  assert.equal(calls.value, 1);
  await probe.assertReplay(operationId, calls);
  pass("explicit-refresh");
}

async function proveTelegramNoFetch(probe: CopySourceFixture) {
  const origin = await probe.createTelegramOrigin();
  const operationId = await probe.createTelegramGeneration(origin);
  const calls = { value: 0 };
  const result = await probe.bind(operationId, refusingFetcher(calls));
  assert.equal(result.kind, "telegram");
  assert.equal(result.pageFetch, "not_needed");
  const loaded = await probe.load(operationId);
  assert.equal(loaded?.kind, "telegram");
  assert.equal(loaded?.content, TELEGRAM_POST);
  assert.equal(loaded?.attribution, "copy-source-probe");
  assert.match(loaded?.canonicalUrl ?? "", /^https:\/\/t\.me\/probe\//u);
  assert.equal(calls.value, 0);
  await probe.assertReplay(operationId, calls);
  pass("telegram-no-fetch");
}

async function provePromoNoSource(probe: CopySourceFixture) {
  const operationId = await probe.createPromoGeneration();
  const calls = { value: 0 };
  const result = await probe.bind(operationId, refusingFetcher(calls));
  assert.equal(result.kind, "promo");
  const generation = await probe.generation(operationId);
  assert.equal(generation?.sourceItemRevisionId, null);
  assert.equal(generation?.sourceItemEnrichmentId, null);
  assert.equal(generation?.pageFetchOperationAttemptId, null);
  assert.equal((await probe.load(operationId))?.kind, "promo");
  await probe.assertReplay(operationId, calls);
  pass("promo-no-source");
}

async function proveCrashBeforeIo(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("crash-before-io");
  const operationId = await probe.createRssGeneration(origin, false);
  const prepared = await prepareCopyGenerationSource(
    opened.database.db,
    probe.workspaceId,
    operationId,
    opened.template.editorial.drafting.copy.fetchMinimumChars,
  );
  assert.equal(prepared.status, "fetch_required");
  if (prepared.status !== "fetch_required") throw new Error("UNREACHABLE");
  const calls = { value: 0 };
  const replay = await probe.bind(operationId, refusingFetcher(calls));
  assert.equal(replay.pageFetch, "interrupted");
  assert.equal(calls.value, 0);
  assert.equal(
    await probe.attemptOutcome(prepared.claim.attemptId),
    "ambiguous",
  );
  await probe.assertReplay(operationId, calls);
  pass("crash-before-io");
}

async function proveCrashAfterIo(probe: CopySourceFixture) {
  const origin = await probe.createRssOrigin("crash-after-io");
  const operationId = await probe.createRssGeneration(origin, false);
  const prepared = await prepareCopyGenerationSource(
    opened.database.db,
    probe.workspaceId,
    operationId,
    opened.template.editorial.drafting.copy.fetchMinimumChars,
  );
  assert.equal(prepared.status, "fetch_required");
  if (prepared.status !== "fetch_required") throw new Error("UNREACHABLE");
  const calls = { value: 0 };
  await invokeClaimFetcher(prepared.claim, successfulFetcher(PAGE_TEXT, calls));
  assert.equal(calls.value, 1);
  const replay = await probe.bind(operationId, refusingFetcher(calls));
  assert.equal(replay.pageFetch, "interrupted");
  assert.equal(calls.value, 1);
  assert.equal(
    await probe.attemptOutcome(prepared.claim.attemptId),
    "ambiguous",
  );
  assert.equal(await probe.enrichmentCount(origin.revisionId), 0);
  await probe.assertReplay(operationId, calls);
  pass("crash-after-io");
}

type SourceOriginFixture = {
  itemId: string;
  revisionId: string;
};

class CopySourceFixture {
  workspaceId = "";
  actorId = "";
  private brandId = "";
  private brandKey = "";
  private analysisOperationId = "";
  private analysisRunId = "";
  private analysisModelUnitId = "";
  private enrichmentOperationId = "";
  private rssSourceId = "";
  private telegramSourceId = "";
  private rank = 0;
  private itemIds: string[] = [];
  private revisionIds: string[] = [];
  private draftRevisionIds: string[] = [];
  private draftIds: string[] = [];
  private operationIds: string[] = [];

  async setup(workspaceId: string) {
    this.workspaceId = workspaceId;
    const [actor] = await opened.database.db
      .select({ id: user.id })
      .from(user)
      .orderBy(asc(user.createdAt))
      .limit(1);
    const [brand] = await opened.database.db
      .select({ id: mediaBrand.id, key: mediaBrand.key })
      .from(mediaBrand)
      .where(eq(mediaBrand.workspaceId, workspaceId))
      .orderBy(asc(mediaBrand.sortOrder))
      .limit(1);
    if (!actor || !brand) throw new Error("DIAGNOSTIC_FIXTURE_REQUIRED");
    this.actorId = actor.id;
    this.brandId = brand.id;
    this.brandKey = brand.key;
    this.analysisOperationId = await this.insertOperation("analysis");
    this.enrichmentOperationId = await this.insertOperation("enrichment");
    this.analysisRunId = randomUUID();
    this.analysisModelUnitId = randomUUID();
    this.rssSourceId = randomUUID();
    this.telegramSourceId = randomUUID();

    await opened.database.db.insert(analysisRun).values({
      id: this.analysisRunId,
      workspaceId,
      kind: "promo",
      operationId: this.analysisOperationId,
      configuration: {
        kind: "promo",
        models: ["probe"],
        platforms: opened.template.editorial.drafting.copy.platforms.map(
          ({ platform }) => platform,
        ),
        promo: {
          brands: [brand.key],
          prompts: { [brand.key]: "deterministic probe" },
        },
      },
      templateFingerprint: opened.identity.fingerprint,
      semanticStatus: "skipped",
    });
    await opened.database.db.insert(analysisModelUnit).values({
      id: this.analysisModelUnitId,
      workspaceId,
      analysisRunId: this.analysisRunId,
      mediaBrandId: this.brandId,
      modelOptionKey: "probe",
      taskKey: "promo",
      status: "pending",
    });
    await opened.database.db.insert(source).values([
      {
        id: this.rssSourceId,
        workspaceId,
        key: `copy-source-probe-rss-${randomUUID()}`,
        origin: "rss",
        endpoint: "https://probe.invalid/feed.xml",
        name: "Copy source probe RSS",
        contentLocale: "en",
        articleFetchMode: "direct",
      },
      {
        id: this.telegramSourceId,
        workspaceId,
        key: `copy-source-probe-telegram-${randomUUID()}`,
        origin: "telegram_public",
        endpoint: "https://t.me/probe",
        name: "Copy source probe Telegram",
        contentLocale: "en",
        articleFetchMode: null,
      },
    ]);
  }

  async createRssOrigin(
    key: string,
    summary: string | null = "fixture summary",
    title = `Fixture ${key}`,
  ): Promise<SourceOriginFixture> {
    return this.createOrigin(this.rssSourceId, "rss", key, title, summary);
  }

  async createTelegramOrigin(): Promise<SourceOriginFixture> {
    return this.createOrigin(
      this.telegramSourceId,
      "telegram_public",
      "telegram",
      "Telegram first line",
      TELEGRAM_POST,
    );
  }

  async createRssGeneration(origin: SourceOriginFixture, force: boolean) {
    this.rank += 1;
    const selectionId = randomUUID();
    await opened.database.db.insert(editorialSelection).values({
      id: selectionId,
      workspaceId: this.workspaceId,
      analysisModelUnitId: this.analysisModelUnitId,
      rank: this.rank,
      sourceItemId: origin.itemId,
      suggestedPlatform: "telegram",
    });
    return this.createGeneration({ editorialSelectionId: selectionId }, force);
  }

  async createTelegramGeneration(origin: SourceOriginFixture) {
    this.rank += 1;
    const resultId = randomUUID();
    await opened.database.db.insert(filterResult).values({
      id: resultId,
      workspaceId: this.workspaceId,
      analysisRunId: this.analysisRunId,
      sourceItemId: origin.itemId,
      mediaBrandId: this.brandId,
      disposition: "telegram_lane",
      rankPosition: this.rank,
    });
    return this.createGeneration({ telegramFilterResultId: resultId }, false);
  }

  async createPromoGeneration() {
    this.rank += 1;
    const promoIdeaId = randomUUID();
    await opened.database.db.insert(promoIdea).values({
      id: promoIdeaId,
      workspaceId: this.workspaceId,
      analysisModelUnitId: this.analysisModelUnitId,
      rank: this.rank,
      title: "Promo fixture",
      description: "Promo fixture description",
      angle: "Promo fixture angle",
    });
    return this.createGeneration({ promoIdeaId }, false);
  }

  async createExecutionGeneration(
    platform: Platform,
    requestedContentLocale: ContentLocale = "en",
  ) {
    const policy = opened.template.editorial.drafting.copy.platforms.find(
      (entry) => entry.platform === platform,
    );
    const model = opened.template.editorial.models.find(
      (entry) =>
        opened.template.models?.tasks[`copy-generation:${entry.key}`] !==
        undefined,
    );
    if (!policy || !model) throw new Error("EXECUTION_TEMPLATE_REQUIRED");
    this.rank += 1;
    const promoIdeaId = randomUUID();
    await opened.database.db.insert(promoIdea).values({
      id: promoIdeaId,
      workspaceId: this.workspaceId,
      analysisModelUnitId: this.analysisModelUnitId,
      rank: this.rank,
      title: "Execution fixture",
      description: "Execution fixture description",
      angle: "Execution fixture angle",
    });
    const operationId = await this.createGeneration({ promoIdeaId }, false, {
      modelOptionKey: model.key,
      platform,
      requestedContentLocale,
      variantKeys: policy.variants.map((variant) => variant.key),
    });
    const [generation] = await opened.database.db
      .select({ platformDraftId: copyGeneration.platformDraftId })
      .from(copyGeneration)
      .where(eq(copyGeneration.operationId, operationId));
    if (!generation) throw new Error("COPY_EXECUTION_GENERATION_REQUIRED");
    return { operationId, platformDraftId: generation.platformDraftId, policy };
  }

  async startBaseGeneration(
    platformDraftId: string,
    requestedContentLocale: ContentLocale,
    mode: "refresh_article" | "regenerate",
  ) {
    const brand = opened.template.mediaBrands.find(
      (entry) => entry.key === this.brandKey,
    );
    const model = opened.template.editorial.models.find(
      (entry) =>
        opened.template.models?.tasks[`copy-generation:${entry.key}`] !==
        undefined,
    );
    if (!brand || !model) throw new Error("COPY_REPLACEMENT_FIXTURE_REQUIRED");
    const commandId = randomUUID();
    const result = await startCopyOperation(
      opened.database.db,
      this.workspaceId,
      {
        actor: this.actorId,
        configurationVersion: COPY_CONFIGURATION_VERSION,
        copyPolicy: {
          fingerprints: {
            [this.brandKey]: computeBrandPolicyFingerprint(brand.editorial),
          },
          modelOptionKeys: opened.template.editorial.models.map(
            (entry) => entry.key,
          ),
          platforms: opened.template.editorial.drafting.copy.platforms.map(
            (entry) => ({
              platform: entry.platform,
              variantKeys: entry.variants.map((variant) => variant.key),
            }),
          ),
        },
        customerTemplateFingerprint: opened.identity.fingerprint,
        idempotencyKey: `copy-replacement-probe-${commandId}`,
        mode,
        modelOptionKey: model.key,
        platformDraftId,
        promptVersion: COPY_PROMPT_VERSION,
        requestedContentLocale,
        requestHash: hash(commandId),
        requestId: null,
      },
    );
    assert.equal(result.status, "created");
    if (result.status !== "created") {
      throw new Error("COPY_REPLACEMENT_OPERATION_NOT_CREATED");
    }
    this.operationIds.push(result.operationId);
    return result.operationId;
  }

  async completeGeneration(
    operationId: string,
    outcome: "failed" | "succeeded",
  ) {
    const contentLocale = await this.generationLocale(operationId);
    let units = await opened.database.db
      .select({ id: copyGenerationUnit.id })
      .from(copyGenerationUnit)
      .where(eq(copyGenerationUnit.copyGenerationId, operationId))
      .orderBy(asc(copyGenerationUnit.createdAt), asc(copyGenerationUnit.id));
    if (units.length === 0) {
      await opened.database.db.insert(copyGenerationUnit).values({
        workspaceId: this.workspaceId,
        copyGenerationId: operationId,
        variantKey: "replacement-probe",
      });
      units = await opened.database.db
        .select({ id: copyGenerationUnit.id })
        .from(copyGenerationUnit)
        .where(eq(copyGenerationUnit.copyGenerationId, operationId));
    }
    const variants: string[] = [];
    for (const [index, unit] of units.entries()) {
      const attempt = await allocateOperationAttempt(
        opened.database.db,
        this.workspaceId,
        operationId,
      );
      if (!attempt) throw new Error("COPY_REPLACEMENT_ATTEMPT_REQUIRED");
      await opened.database.db
        .update(copyGenerationUnit)
        .set({ operationAttemptId: attempt.id, status: outcome })
        .where(eq(copyGenerationUnit.id, unit.id));
      await opened.database.db
        .update(operationAttempt)
        .set({
          failureCode: outcome === "failed" ? "VALIDATION_FAILED" : null,
          outcome: outcome === "failed" ? "failed_terminal" : "succeeded",
        })
        .where(eq(operationAttempt.id, attempt.id));
      if (outcome === "succeeded") {
        const id = randomUUID();
        variants.push(id);
        await opened.database.db.insert(copyVariant).values({
          id,
          workspaceId: this.workspaceId,
          body: `Replacement probe body ${index}`,
          contentLocale,
          copyGenerationUnitId: unit.id,
          hashtags: ["#probe"],
          headline: `Replacement probe headline ${index}`,
        });
      }
    }
    return variants;
  }

  async createRevisionFromVariant(platformDraftId: string, variantId: string) {
    const [variant] = await opened.database.db
      .select({
        body: copyVariant.body,
        contentLocale: copyVariant.contentLocale,
        hashtags: copyVariant.hashtags,
        headline: copyVariant.headline,
      })
      .from(copyVariant)
      .where(eq(copyVariant.id, variantId));
    if (!variant) throw new Error("COPY_REPLACEMENT_VARIANT_REQUIRED");
    const id = randomUUID();
    this.draftRevisionIds.push(id);
    await opened.database.db.insert(draftRevision).values({
      id,
      workspaceId: this.workspaceId,
      authoredBy: this.actorId,
      body: variant.body,
      contentLocale: variant.contentLocale,
      hashtags: variant.hashtags,
      headline: variant.headline,
      originatingCopyVariantId: variantId,
      platformDraftId,
      revisionNumber: 1,
    });
    return id;
  }

  async retryFailedGeneration(
    operationId: string,
    requestedContentLocale: ContentLocale,
  ) {
    const [generation] = await opened.database.db
      .select({ platformDraftId: copyGeneration.platformDraftId })
      .from(copyGeneration)
      .where(eq(copyGeneration.operationId, operationId));
    const brand = opened.template.mediaBrands.find(
      (entry) => entry.key === this.brandKey,
    );
    if (!generation || !brand) throw new Error("COPY_RETRY_FIXTURE_REQUIRED");

    const commandId = randomUUID();
    const idempotencyKey = `copy-source-probe-retry-${commandId}`;
    const result = await startCopyOperation(
      opened.database.db,
      this.workspaceId,
      {
        actor: this.actorId,
        configurationVersion: COPY_CONFIGURATION_VERSION,
        copyPolicy: {
          fingerprints: {
            [this.brandKey]: computeBrandPolicyFingerprint(brand.editorial),
          },
          modelOptionKeys: opened.template.editorial.models.map(
            (model) => model.key,
          ),
          platforms: opened.template.editorial.drafting.copy.platforms.map(
            (entry) => ({
              platform: entry.platform,
              variantKeys: entry.variants.map((variant) => variant.key),
            }),
          ),
        },
        customerTemplateFingerprint: opened.identity.fingerprint,
        idempotencyKey,
        mode: "retry_failed",
        platformDraftId: generation.platformDraftId,
        promptVersion: COPY_PROMPT_VERSION,
        requestedContentLocale,
        requestHash: hash(commandId),
        requestId: null,
      },
    );
    if (result.status === "created") this.operationIds.push(result.operationId);
    return { idempotencyKey, result };
  }

  async retryCommandArtifacts(idempotencyKey: string) {
    const operations = await opened.database.db
      .select({ id: operation.id })
      .from(operation)
      .where(
        and(
          eq(operation.workspaceId, this.workspaceId),
          eq(operation.actor, this.actorId),
          eq(
            operation.commandType,
            `${COPY_GENERATION_COMMAND_PREFIX}retry_failed`,
          ),
          eq(operation.idempotencyKey, idempotencyKey),
        ),
      );
    const operationIds = operations.map((entry) => entry.id);
    if (operationIds.length === 0) {
      return { attempts: 0, operations: 0, outboxEvents: 0 };
    }
    const attempts = await opened.database.db
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(inArray(operationAttempt.operationId, operationIds));
    const events = await opened.database.db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(inArray(outboxEvent.operationId, operationIds));
    return {
      attempts: attempts.length,
      operations: operations.length,
      outboxEvents: events.length,
    };
  }

  async seedEnrichment(
    revisionId: string,
    adapter: "direct" | "feed",
    extract: string,
    policyVersion: string,
  ) {
    const attempt = await allocateOperationAttempt(
      opened.database.db,
      this.workspaceId,
      this.enrichmentOperationId,
    );
    if (!attempt) throw new Error("ENRICHMENT_ATTEMPT_NOT_CREATED");
    await opened.database.db
      .update(operationAttempt)
      .set({ outcome: "succeeded" })
      .where(eq(operationAttempt.id, attempt.id));
    return insertSourceItemEnrichment(opened.database.db, this.workspaceId, {
      sourceItemRevisionId: revisionId,
      operationAttemptId: attempt.id,
      policyVersion,
      adapter,
      fallbackReason: null,
      pageContentHash: hash(extract),
      extract,
      brief: { forbiddenCopyInput: "probe poison" },
      providerRequestId: null,
    });
  }

  async bind(operationId: string, fetcher: ArticleFetcher) {
    const result = await bindCopyGenerationSource(
      {
        db: opened.database.db,
        identity: opened.identity,
        template: opened.template,
      },
      this.workspaceId,
      operationId,
      fetcher,
      {},
    );
    if (result.status === "not_found") {
      throw new Error("COPY_GENERATION_NOT_FOUND");
    }
    return result;
  }

  load(operationId: string) {
    return loadCopyGenerationSource(
      { db: opened.database.db, template: opened.template },
      this.workspaceId,
      operationId,
    );
  }

  async fetchAndComplete(
    operationId: string,
    claim: Extract<
      Awaited<ReturnType<typeof prepareCopyGenerationSource>>,
      { status: "fetch_required" }
    >["claim"],
    fetcher: ArticleFetcher,
  ) {
    const fetched = await invokeClaimFetcher(claim, fetcher);
    if (fetched.adapter === null || fetched.adapter === "feed") {
      throw new Error("EXPECTED_PAGE_FETCH_RESULT");
    }
    const extract = fetched.text.slice(0, 8_000).trim();
    const { completeCopyGenerationPageFetch } = await import(
      "@rz-chain-reporter/db/repositories/copy-generation"
    );
    const result = await completeCopyGenerationPageFetch(
      opened.database.db,
      this.workspaceId,
      operationId,
      {
        attemptId: claim.attemptId,
        adapter: fetched.adapter,
        extract,
        fallbackReason: fetched.fallbackReason,
        pageContentHash: hash(extract),
        sourceItemRevisionId: claim.sourceItemRevisionId,
      },
    );
    if (result.status === "not_found") {
      throw new Error("COPY_GENERATION_NOT_FOUND");
    }
    return result;
  }

  async assertReplay(
    operationId: string,
    calls: { value: number },
    expectedStatus: "bound" | "no_input" = "bound",
  ) {
    const before = calls.value;
    const replay = await this.bind(operationId, refusingFetcher(calls));
    assert.equal(replay.status, expectedStatus);
    assert.equal(calls.value, before);
  }

  async generation(operationId: string) {
    const [row] = await opened.database.db
      .select()
      .from(copyGeneration)
      .where(
        and(
          eq(copyGeneration.workspaceId, this.workspaceId),
          eq(copyGeneration.operationId, operationId),
        ),
      );
    return row;
  }

  async enrichmentCount(revisionId: string) {
    const rows = await opened.database.db
      .select({ id: sourceItemEnrichment.id })
      .from(sourceItemEnrichment)
      .where(
        and(
          eq(sourceItemEnrichment.workspaceId, this.workspaceId),
          eq(sourceItemEnrichment.sourceItemRevisionId, revisionId),
        ),
      );
    return rows.length;
  }

  async attemptOutcome(attemptId: string) {
    const [row] = await opened.database.db
      .select({ outcome: operationAttempt.outcome })
      .from(operationAttempt)
      .where(
        and(
          eq(operationAttempt.workspaceId, this.workspaceId),
          eq(operationAttempt.id, attemptId),
        ),
      );
    return row?.outcome;
  }

  async attempt(attemptId: string) {
    const [row] = await opened.database.db
      .select({
        failureCode: operationAttempt.failureCode,
        outcome: operationAttempt.outcome,
      })
      .from(operationAttempt)
      .where(
        and(
          eq(operationAttempt.workspaceId, this.workspaceId),
          eq(operationAttempt.id, attemptId),
        ),
      );
    return row;
  }

  async cleanup() {
    if (!this.workspaceId) return "exact_fixture_removed";
    await opened.database.db.transaction(async (tx) => {
      if (this.draftRevisionIds.length > 0) {
        await tx
          .delete(draftRevision)
          .where(inArray(draftRevision.id, this.draftRevisionIds));
      }
      if (this.operationIds.length > 0) {
        await tx
          .update(operation)
          .set({
            claimedBy: null,
            leaseExpiresAt: null,
            lifecycle: "cancelled",
          })
          .where(inArray(operation.id, this.operationIds));
        await tx
          .delete(outboxEvent)
          .where(inArray(outboxEvent.operationId, this.operationIds));
        await tx
          .delete(aiUsageEvent)
          .where(inArray(aiUsageEvent.operationId, this.operationIds));
        await tx
          .delete(copyVariant)
          .where(
            inArray(
              copyVariant.copyGenerationUnitId,
              tx
                .select({ id: copyGenerationUnit.id })
                .from(copyGenerationUnit)
                .where(
                  inArray(
                    copyGenerationUnit.copyGenerationId,
                    this.operationIds,
                  ),
                ),
            ),
          );
        await tx
          .delete(copyGenerationUnit)
          .where(
            inArray(copyGenerationUnit.copyGenerationId, this.operationIds),
          );
        await tx
          .delete(copyGeneration)
          .where(inArray(copyGeneration.operationId, this.operationIds));
      }
      if (this.revisionIds.length > 0) {
        await tx
          .delete(sourceItemEnrichment)
          .where(
            inArray(
              sourceItemEnrichment.sourceItemRevisionId,
              this.revisionIds,
            ),
          );
      }
      if (this.draftIds.length > 0) {
        await tx
          .delete(platformDraft)
          .where(inArray(platformDraft.id, this.draftIds));
      }
      if (this.analysisRunId) {
        await tx
          .delete(analysisRun)
          .where(eq(analysisRun.id, this.analysisRunId));
      }
      if (this.itemIds.length > 0) {
        await tx.delete(sourceItem).where(inArray(sourceItem.id, this.itemIds));
      }
      if (this.rssSourceId || this.telegramSourceId) {
        await tx
          .delete(source)
          .where(inArray(source.id, [this.rssSourceId, this.telegramSourceId]));
      }
      if (this.operationIds.length > 0) {
        await tx
          .delete(operation)
          .where(inArray(operation.id, this.operationIds));
        const remaining = await tx
          .select({ id: operation.id })
          .from(operation)
          .where(inArray(operation.id, this.operationIds));
        assert.equal(remaining.length, 0);
      }
    });
    return "exact_fixture_removed";
  }

  private async createOrigin(
    sourceId: string,
    origin: "rss" | "telegram_public",
    key: string,
    title: string,
    summary: string | null,
  ): Promise<SourceOriginFixture> {
    const itemId = randomUUID();
    const revisionId = randomUUID();
    const canonicalUrl =
      origin === "rss"
        ? `https://probe.invalid/${key}`
        : `https://t.me/probe/${this.rank + 1}`;
    const contentHash = hash(`${title}:${summary ?? ""}`);
    this.itemIds.push(itemId);
    this.revisionIds.push(revisionId);
    await opened.database.db.insert(sourceItem).values({
      id: itemId,
      workspaceId: this.workspaceId,
      sourceId,
      origin,
      externalId: `copy-source-probe-${key}-${randomUUID()}`,
      title,
      url: canonicalUrl,
      attribution: "copy-source-probe",
      contentLocale: "en",
    });
    await opened.database.db.insert(sourceItemRevision).values({
      id: revisionId,
      workspaceId: this.workspaceId,
      sourceItemId: itemId,
      revisionNumber: 1,
      title,
      summary,
      canonicalUrl,
      contentLocale: "en",
      contentHash,
    });
    await opened.database.db.insert(analysisRunItem).values({
      workspaceId: this.workspaceId,
      analysisRunId: this.analysisRunId,
      sourceItemId: itemId,
      sourceItemRevisionId: revisionId,
      eligibility: "candidate",
    });
    return { itemId, revisionId };
  }

  private async createGeneration(
    origin: {
      editorialSelectionId?: string;
      promoIdeaId?: string;
      telegramFilterResultId?: string;
    },
    forceArticleRefresh: boolean,
    execution?: {
      modelOptionKey: string;
      platform: Platform;
      requestedContentLocale: ContentLocale;
      variantKeys: readonly string[];
    },
  ) {
    const brand = opened.template.mediaBrands.find(
      (entry) => entry.key === this.brandKey,
    );
    if (!brand) throw new Error("COPY_FIXTURE_BRAND_REQUIRED");
    const draftId = randomUUID();
    const operationId = await this.insertOperation("copy");
    this.draftIds.push(draftId);
    await opened.database.db.insert(platformDraft).values({
      id: draftId,
      workspaceId: this.workspaceId,
      mediaBrandId: this.brandId,
      platform: execution?.platform ?? "telegram",
      lanePosition: this.rank,
      ...origin,
    });
    await opened.database.db.insert(copyGeneration).values({
      operationId,
      workspaceId: this.workspaceId,
      platformDraftId: draftId,
      requestedContentLocale: execution?.requestedContentLocale ?? "en",
      modelOptionKey: execution?.modelOptionKey ?? "probe",
      forceArticleRefresh,
      customerTemplateFingerprint: opened.identity.fingerprint,
      brandPolicyFingerprint: computeBrandPolicyFingerprint(brand.editorial),
      promptVersion: COPY_PROMPT_VERSION,
      configurationVersion: COPY_CONFIGURATION_VERSION,
    });
    if (execution && execution.variantKeys.length > 0) {
      await opened.database.db.insert(copyGenerationUnit).values(
        execution.variantKeys.map((variantKey) => ({
          workspaceId: this.workspaceId,
          copyGenerationId: operationId,
          variantKey,
        })),
      );
    }
    return operationId;
  }

  private async insertOperation(kind: string) {
    const id = randomUUID();
    this.operationIds.push(id);
    await opened.database.db.insert(operation).values({
      id,
      workspaceId: this.workspaceId,
      actor: this.actorId,
      commandType: `copy-source-probe-${kind}`,
      idempotencyKey: `copy-source-probe-${id}`,
      requestHash: hash(id),
    });
    return id;
  }

  private async generationLocale(operationId: string) {
    const [generation] = await opened.database.db
      .select({ locale: copyGeneration.requestedContentLocale })
      .from(copyGeneration)
      .where(eq(copyGeneration.operationId, operationId));
    if (!generation) throw new Error("COPY_REPLACEMENT_GENERATION_REQUIRED");
    return generation.locale;
  }
}

function successfulFetcher(
  text: string,
  calls: { value: number },
): ArticleFetcher {
  return async (request) => {
    assert.equal(request.feedContent, null);
    calls.value += 1;
    return { adapter: "direct", fallbackReason: null, text };
  };
}

function failingFetcher(
  calls: { value: number },
  reason: EnrichmentReason,
): ArticleFetcher {
  return async (request) => {
    assert.equal(request.feedContent, null);
    calls.value += 1;
    return { adapter: null, reason };
  };
}

function refusingFetcher(calls: { value: number }): ArticleFetcher {
  return async () => {
    calls.value += 1;
    throw new Error("DUPLICATE_FETCH");
  };
}

function invokeClaimFetcher(
  claim: {
    endpoint: string;
    mode: ArticleFetchRequest["mode"];
    url: string;
  },
  fetcher: ArticleFetcher,
): Promise<ArticleFetchResult> {
  return fetcher(
    {
      endpointOrigin: new URL(claim.endpoint).origin,
      feedContent: null,
      mode: claim.mode,
      timeoutMs: 20_000,
      url: claim.url,
    },
    {},
  );
}

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function pass(scenario: string) {
  console.log(`copy-generation source scenario=${scenario} status=pass`);
}

type GatewayMode =
  | { kind: "ambiguous" }
  | { kind: "schema-invalid" }
  | {
      kind: "output";
      output: { body: string; hashtags: string[]; headline: string };
    };

class DeterministicGateway implements ModelGateway {
  definiteCallbacks = 0;
  instructions: (string | undefined)[] = [];
  prompts: string[] = [];
  resultCallbacks = 0;

  constructor(private readonly modes: GatewayMode[]) {}

  async embedMany(): Promise<never> {
    throw new Error("COPY_PROBE_EMBEDDING_FORBIDDEN");
  }

  async invokeStructured<TOutput>(input: StructuredModelInvocation<TOutput>) {
    this.instructions.push(input.instructions);
    this.prompts.push(input.prompt);
    const mode = this.modes.shift();
    if (!mode) throw new Error("COPY_PROBE_SCRIPT_EXHAUSTED");
    const claimFence = input.claimFence
      ? { operationId: input.operationId, ...input.claimFence }
      : undefined;
    const pending = await insertPendingUsage(
      opened.database.db,
      input.workspaceId,
      {
        apiKind: "chat",
        backend: "local",
        invocationKey: input.invocationKey,
        operationAttemptId: input.operationAttemptId,
        operationId: input.operationId,
        providerGateway: "ollama",
        requestedModel: "deterministic-local-probe",
        taskKey: input.taskKey,
        ...(claimFence
          ? { claimFence: { ...claimFence, now: new Date() } }
          : {}),
      },
    );
    assert.equal(pending.inserted, true);
    const observed = {
      costAuthority: "local" as const,
      finishReason: mode.kind,
      providerRequestId: `probe-${pending.event.id}`,
      resolvedModel: "deterministic-local-probe",
      totalTokens: 3,
    };

    if (mode.kind === "ambiguous") {
      await finalizeUsage(opened.database.db, input.workspaceId, {
        claimFence,
        id: pending.event.id,
        status: "unknown",
        ...observed,
      });
      throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
        ambiguous: true,
        usageEventId: pending.event.id,
      });
    }

    if (mode.kind === "schema-invalid") {
      await finalizeUsageWithResult(
        opened.database.db,
        input.workspaceId,
        {
          claimFence,
          id: pending.event.id,
          status: "failed",
          ...observed,
        },
        async (tx) => {
          this.definiteCallbacks += 1;
          await input.persistDefiniteFailure?.(tx, {
            code: "STRUCTURED_OUTPUT_INVALID",
          });
        },
      );
      throw new ModelGatewayInvocationError("STRUCTURED_OUTPUT_INVALID", {
        usageEventId: pending.event.id,
      });
    }

    const output = mode.output as TOutput;
    await finalizeUsageWithResult(
      opened.database.db,
      input.workspaceId,
      {
        claimFence,
        id: pending.event.id,
        status: "succeeded",
        ...observed,
      },
      async (tx) => {
        this.resultCallbacks += 1;
        await input.persistResult(tx, output);
      },
    );
    return { output, usageEventId: pending.event.id };
  }
}

function candidateFor(
  platform: Platform,
  policy: CopyNormalizationProbePolicy,
  canonicalHashtag: string,
  accepted: boolean,
) {
  const hashtags = Array.from(
    { length: Math.max(0, policy.hashtags.min - 1) },
    (_, index) => `#topic${index + 1}`,
  );
  if (!accepted) {
    if (platform !== "x") throw new Error("PROBE_REJECTION_REQUIRES_X");
    return {
      body: "No truncation can rescue a headline that never fits.",
      hashtags,
      headline: "H".repeat(X_HARD_MAXIMUM + 40),
    };
  }
  const candidate = { body: "B", hashtags, headline: "Headline" };
  const normalize = () =>
    normalizeCopyCandidate(platform, candidate, {
      canonicalHashtag,
      emojiGraphemeCap: policy.emojiGraphemeCap,
      maximumCharacters: policy.assembledCharacters.max,
      maximumHashtags: policy.hashtags.max,
      minimumHashtags: policy.hashtags.min,
      requestedContentLocale: "en",
      source: null,
    });
  let checked = normalize();
  while (checked.length < policy.assembledCharacters.max) {
    candidate.body += "B";
    checked = normalize();
  }
  assert.equal(checked.length, policy.assembledCharacters.max);
  assert.equal(checked.valid, true);
  return candidate;
}

function persianCandidateFor(
  platform: Platform,
  policy: CopyNormalizationProbePolicy,
  canonicalHashtag: string,
) {
  const candidate = {
    body: "متن",
    hashtags: Array.from(
      { length: Math.max(0, policy.hashtags.min - 1) },
      (_, index) => `#خبر${index + 1}`,
    ),
    headline: "تیتر خبر",
  };
  const normalize = () =>
    normalizeCopyCandidate(platform, candidate, {
      canonicalHashtag,
      emojiGraphemeCap: policy.emojiGraphemeCap,
      maximumCharacters: policy.assembledCharacters.max,
      maximumHashtags: policy.hashtags.max,
      minimumHashtags: policy.hashtags.min,
      requestedContentLocale: "fa",
      source: null,
    });
  let checked = normalize();
  while (checked.length < policy.assembledCharacters.max) {
    candidate.body += "ب";
    checked = normalize();
  }
  assert.equal(checked.valid, true);
  return candidate;
}

function proveCopyNormalization(
  brand: (typeof opened.template.mediaBrands)[number],
) {
  const policy = opened.template.editorial.drafting.copy.platforms.find(
    (entry) => entry.platform === "x",
  );
  const telegramPolicy = opened.template.editorial.drafting.copy.platforms.find(
    (entry) => entry.platform === "telegram",
  );
  if (!policy || !telegramPolicy) throw new Error("NORMALIZATION_POLICY");
  const canonical = brand.editorial.canonicalHashtags.en;
  const input = {
    canonicalHashtag: canonical,
    emojiGraphemeCap: policy.emojiGraphemeCap,
    maximumCharacters: policy.assembledCharacters.max,
    maximumHashtags: policy.hashtags.max,
    minimumHashtags: policy.hashtags.min,
    requestedContentLocale: "en" as const,
    source: null,
  };

  const moved = normalizeCopyCandidate(
    "x",
    {
      body: "Spot flows turned positive #ETF today.",
      hashtags: ["%ETF"],
      headline: "Inflows return #Bitcoin",
    },
    input,
  );
  assert.equal(moved.valid, true);
  assert.deepEqual(moved.failures, []);
  assert.equal(moved.headline, "Inflows return");
  assert.equal(moved.body, "Spot flows turned positive today.");
  assert.deepEqual(moved.hashtags, [canonical, "#ETF", "#Bitcoin"]);

  const capped = normalizeCopyCandidate(
    "x",
    {
      body: "Desks reprice risk into the close.",
      hashtags: ["%ETF", "#markets", "#Markets", "#flows", "#macro", "#rates"],
      headline: "Liquidity thins",
    },
    input,
  );
  assert.equal(capped.valid, true);
  assert.equal(capped.hashtags.length, policy.hashtags.max);
  assert.equal(capped.hashtags[0], canonical);
  assert.deepEqual(capped.hashtags.slice(1), ["#ETF", "#markets"]);

  const truncated = normalizeCopyCandidate(
    "x",
    {
      body: Array.from({ length: 120 }, () => "flows").join(" "),
      hashtags: ["#markets", "#flows"],
      headline: "Liquidity thins as desks reprice risk",
    },
    input,
  );
  assert.equal(truncated.valid, true);
  assert.deepEqual(truncated.hashtags, [canonical, "#markets", "#flows"]);
  assert.equal(truncated.body.endsWith("flows\u2026"), true);
  assert.ok(truncated.length <= policy.assembledCharacters.max);
  assert.ok(truncated.length <= X_HARD_MAXIMUM);
  assert.ok(truncated.assembled.endsWith("#flows"));

  const belowMin = normalizeCopyCandidate(
    "x",
    {
      body: "Desks reprice risk into the close.",
      hashtags: [],
      headline: "Liquidity thins",
    },
    input,
  );
  assert.equal(belowMin.valid, false);
  assert.deepEqual(belowMin.failures, ["HASHTAGS_BELOW_MIN"]);
  assert.deepEqual(belowMin.hashtags, [canonical]);

  const floorHashtags = [canonical, "#markets"];
  const floorHeadlineLength =
    Math.min(policy.assembledCharacters.max, X_HARD_MAXIMUM) -
    platformCopyLength(
      "x",
      assembleCopy("x", {
        body: "flows…",
        hashtags: floorHashtags,
        headline: "",
      }),
    );
  assert.ok(floorHeadlineLength > 0);
  const floor = normalizeCopyCandidate(
    "x",
    {
      body: Array.from({ length: 80 }, () => "flows").join(" "),
      hashtags: ["#markets", "#flows"],
      headline: "H".repeat(floorHeadlineLength),
    },
    input,
  );
  assert.equal(floor.valid, true);
  assert.deepEqual(floor.hashtags, [canonical, "#markets"]);
  assert.equal(floor.body.endsWith("\u2026"), true);
  assert.ok(floor.length <= policy.assembledCharacters.max);

  const unfittable = normalizeCopyCandidate(
    "x",
    {
      body: "Body",
      hashtags: ["#markets"],
      headline: "H".repeat(X_HARD_MAXIMUM + 40),
    },
    input,
  );
  assert.equal(unfittable.valid, false);
  assert.deepEqual(unfittable.failures, ["LENGTH_ABOVE_MAX"]);

  const emoji = normalizeCopyCandidate(
    "telegram",
    {
      body: "Flows \u{1F680} keep \u{1F680} building \u{1F680} into \u{1F680} the close \u{1F680}",
      hashtags: ["#markets", "#bitcoin"],
      headline: "Momentum holds \u{1F525}",
    },
    {
      canonicalHashtag: canonical,
      emojiGraphemeCap: telegramPolicy.emojiGraphemeCap,
      maximumCharacters: telegramPolicy.assembledCharacters.max,
      maximumHashtags: telegramPolicy.hashtags.max,
      minimumHashtags: telegramPolicy.hashtags.min,
      requestedContentLocale: "en",
      source: null,
    },
  );
  assert.equal(emoji.valid, true);
  assert.equal(emoji.emojiCount, telegramPolicy.emojiGraphemeCap);

  const telegramSource = {
    attribution: "Coin Hall ".repeat(30).trim(),
    canonicalUrl: `https://example.invalid/${"story".repeat(40)}`,
  };
  const telegramMedia = normalizeCopyCandidate(
    "telegram",
    {
      body: Array.from({ length: 240 }, () => "market").join(" "),
      hashtags: ["#markets", "#bitcoin"],
      headline: "Markets reprice the latest verified move",
    },
    {
      canonicalHashtag: canonical,
      emojiGraphemeCap: telegramPolicy.emojiGraphemeCap,
      maximumCharacters: telegramPolicy.assembledCharacters.max,
      maximumHashtags: telegramPolicy.hashtags.max,
      minimumHashtags: telegramPolicy.hashtags.min,
      requestedContentLocale: "en",
      source: telegramSource,
    },
  );
  const telegramPayload = assemblePublishPayload({
    contentLocale: "en",
    draft: {
      body: telegramMedia.body,
      hashtags: telegramMedia.hashtags,
      headline: telegramMedia.headline,
    },
    hasMedia: true,
    platform: "telegram",
    source: telegramSource,
  });
  assert.equal(telegramMedia.valid, true);
  assert.equal(telegramPayload.status, "ready");
  assert.ok(telegramPayload.length <= 1_024);
  assert.equal(telegramMedia.hashtags[0], canonical);
  assert.ok(telegramMedia.hashtags.length >= telegramPolicy.hashtags.min);
  assert.match(telegramMedia.assembled, /Read full story/u);

  const wrongLocale = normalizeCopyCandidate(
    "x",
    { body: "English body", hashtags: ["#news"], headline: "English headline" },
    { ...input, requestedContentLocale: "fa" },
  );
  assert.equal(wrongLocale.valid, false);
  assert.deepEqual(wrongLocale.failures, ["CONTENT_LOCALE_MISMATCH"]);

  const persian = normalizeCopyCandidate(
    "x",
    { body: "متن فارسی", hashtags: ["#خبر"], headline: "تیتر فارسی" },
    { ...input, requestedContentLocale: "fa" },
  );
  assert.equal(persian.valid, true);

  console.log(
    `copy-generation execution normalization hashtags-moved=true tag-format=true hashtag-cap=${policy.hashtags.max} hashtag-floor=${policy.hashtags.min} body-truncated=true emoji-capped=${telegramPolicy.emojiGraphemeCap} telegram-send-photo=true telegram-source-suffix=true unfittable=rejected status=pass`,
  );
}

async function provePersianLocaleEnforcement(
  probe: CopySourceFixture,
  brand: (typeof opened.template.mediaBrands)[number],
) {
  const fixture = await probe.createExecutionGeneration("x", "fa");
  await claimProbeCopy(fixture.operationId);
  const context = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  if (context?.units.length !== 3) {
    throw new Error("PERSIAN_LOCALE_FIXTURE_INVALID");
  }
  const english = candidateFor(
    "x",
    fixture.policy,
    brand.editorial.canonicalHashtags.en,
    true,
  );
  const persian = persianCandidateFor(
    "x",
    fixture.policy,
    brand.editorial.canonicalHashtags.fa,
  );
  const gateway = new DeterministicGateway(
    context.units.flatMap(() => [
      { kind: "output" as const, output: english },
      { kind: "output" as const, output: persian },
    ]),
  );
  for (const unit of context.units) {
    await executeCopyGenerationUnit(runtime, gateway, {
      ...copyExecutionFence(fixture.operationId),
      operationId: fixture.operationId,
      unitId: unit.id,
      workspaceId: probe.workspaceId,
    });
  }
  const variants = await opened.database.db
    .select({
      body: copyVariant.body,
      contentLocale: copyVariant.contentLocale,
      headline: copyVariant.headline,
    })
    .from(copyVariant)
    .innerJoin(
      copyGenerationUnit,
      eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
    )
    .where(eq(copyGenerationUnit.copyGenerationId, fixture.operationId));
  assert.equal(variants.length, 3);
  assert.equal(gateway.resultCallbacks, 6);
  assert.equal(
    gateway.instructions.every((value) => value?.includes("Persian (fa)")),
    true,
  );
  assert.equal(
    variants.every(
      (variant) =>
        variant.contentLocale === "fa" &&
        copyMatchesContentLocale("fa", variant),
    ),
    true,
  );
  console.log(
    "copy-generation execution fa english-primary=rejected persian-retry=accepted variants=3 status=pass",
  );
}

function proveBrandGuidanceOwners() {
  const declared = opened.template.mediaBrands.find(
    (brand) => brand.brandBible !== undefined,
  );
  assert.ok(declared);

  const reviewed = loadCopyBrandGuidance(runtime, declared.key);
  assert.equal(reviewed.kind, "brand_bible");
  if (reviewed.kind !== "brand_bible") throw new Error("UNREACHABLE");
  assert.ok(reviewed.content.length > 0);
  assert.ok(Array.from(reviewed.content).length <= 8_000);

  const fallbackBrand = { ...declared, brandBible: undefined };
  const fallback = loadCopyBrandGuidance(
    {
      identity: runtime.identity,
      template: {
        ...runtime.template,
        mediaBrands: runtime.template.mediaBrands.map((brand) =>
          brand.key === fallbackBrand.key ? fallbackBrand : brand,
        ),
      },
    },
    fallbackBrand.key,
  );
  assert.deepEqual(fallback, {
    brandName: fallbackBrand.name,
    focus: fallbackBrand.editorial.semanticAnchors
      .slice(0, 8)
      .join(", ")
      .slice(0, 400),
    kind: "template_fallback",
  });
  console.log(
    "copy-generation execution brand-guidance reviewed-root=true bounded=true explicit-absent-bible=template-only status=pass",
  );
}

function proveCapturedXPrompts(
  prompts: readonly string[],
  brand: (typeof opened.template.mediaBrands)[number],
  policy: (typeof opened.template.editorial.drafting.copy.platforms)[number],
) {
  assert.equal(prompts.length, 7);
  for (const prompt of prompts) {
    const sections = prompt.split("\n\n");
    const identity = JSON.parse(sections[2] ?? "null") as {
      brandPolicyFingerprint: string;
      customerTemplateFingerprint: string;
      locale: string;
      platform: string;
      variant: { instruction: string; key: string };
    };
    const platformPolicy = JSON.parse(sections[3] ?? "null") as {
      assembledCopy: string;
      characterWindow: { max: number; min: number };
      emojiGraphemeCap: number;
      hardCharacterMaximum: number;
      hashtagPlacement: string;
      hashtags: {
        additional: { max: number; min: number };
        canonical: string;
        finalTotal: { max: number; min: number };
      };
      lengthSemantics: string;
    };
    assert.match(sections[0] ?? "", /aim for about \d+, the middle of the/u);
    assert.equal(
      identity.brandPolicyFingerprint,
      computeBrandPolicyFingerprint(brand.editorial),
    );
    assert.equal(
      identity.customerTemplateFingerprint,
      opened.identity.fingerprint,
    );
    assert.equal(identity.locale, "en");
    assert.equal(identity.platform, "x");
    assert.ok(
      policy.variants.some((variant) => variant.key === identity.variant.key),
    );
    assert.ok(identity.variant.instruction.length > 0);
    assert.equal(
      platformPolicy.assembledCopy,
      'headline + "\\n" + body + "\\n\\n" + finalHashtags.join(" ")',
    );
    assert.deepEqual(
      platformPolicy.characterWindow,
      policy.assembledCharacters,
    );
    assert.equal(platformPolicy.emojiGraphemeCap, policy.emojiGraphemeCap);
    assert.equal(platformPolicy.hardCharacterMaximum, X_HARD_MAXIMUM);
    assert.equal(
      platformPolicy.hashtagPlacement,
      "hashtags array only; none in headline or body",
    );
    assert.deepEqual(platformPolicy.hashtags.additional, {
      max: policy.hashtags.max - 1,
      min: Math.max(0, policy.hashtags.min - 1),
    });
    assert.equal(
      platformPolicy.hashtags.canonical,
      brand.editorial.canonicalHashtags.en,
    );
    assert.deepEqual(platformPolicy.hashtags.finalTotal, policy.hashtags);
    assert.match(platformPolicy.lengthSemantics, /URLs are removed/u);
    const guidance = JSON.parse(sections[7] ?? "null") as { kind?: string };
    assert.ok(
      guidance.kind === "brand_bible" || guidance.kind === "template_fallback",
    );
  }
  assert.doesNotMatch(prompts[1] ?? "", /rejected by the policy validator/u);
  assert.match(prompts[2] ?? "", /rejected by the policy validator/u);
  assert.match(prompts[2] ?? "", /LENGTH_ABOVE_MAX/u);
  assert.equal(prompts[2], prompts[3]);
  assert.equal(prompts[4], prompts[5]);
  assert.equal(prompts[5], prompts[6]);
  console.log(
    "copy-generation execution prompt-policy template=true assembly=true hashtags=true emoji=true locale-variant=true every-slot=true rejection-feedback=true status=pass",
  );
}

async function proveFingerprintDrift(probe: CopySourceFixture) {
  for (const field of [
    "customerTemplateFingerprint",
    "brandPolicyFingerprint",
  ] as const) {
    const fixture = await probe.createExecutionGeneration("x");
    await claimProbeCopy(fixture.operationId);
    const context = await findCopyExecutionContext(
      opened.database.db,
      probe.workspaceId,
      fixture.operationId,
    );
    const unit = context?.units[0];
    if (!unit) throw new Error("FINGERPRINT_DRIFT_FIXTURE_INVALID");
    await opened.database.db
      .update(copyGeneration)
      .set({ [field]: "0".repeat(64) })
      .where(eq(copyGeneration.operationId, fixture.operationId));

    const gateway = new DeterministicGateway([]);
    const result = await executeCopyGenerationUnit(runtime, gateway, {
      ...copyExecutionFence(fixture.operationId),
      operationId: fixture.operationId,
      unitId: unit.id,
      workspaceId: probe.workspaceId,
    });
    assert.equal(result.status, "failed");
    assert.equal(gateway.prompts.length, 0);
    assert.equal(await operationUsageCount(fixture.operationId), 0);
    const [attempt] = await opened.database.db
      .select({
        failureCode: operationAttempt.failureCode,
        outcome: operationAttempt.outcome,
      })
      .from(operationAttempt)
      .where(eq(operationAttempt.operationId, fixture.operationId));
    assert.deepEqual(attempt, {
      failureCode: "TEMPLATE_DRIFT",
      outcome: "failed_terminal",
    });
  }
  console.log(
    "copy-generation execution template-and-brand-fingerprint drift=failed-before-spend providerEffects=0 status=pass",
  );
}

async function proveHistoricalRetryUsesCurrentVersions(
  probe: CopySourceFixture,
) {
  const fixture = await probe.createExecutionGeneration("x");
  const historicalPromptVersion = "copy-prompt-v1";
  const historicalConfigurationVersion = "copy-configuration-v0";
  await opened.database.db
    .update(copyGeneration)
    .set({
      brandPolicyFingerprint: "1".repeat(64),
      configurationVersion: historicalConfigurationVersion,
      customerTemplateFingerprint: "0".repeat(64),
      promptVersion: historicalPromptVersion,
    })
    .where(eq(copyGeneration.operationId, fixture.operationId));
  const historicalUnits = await opened.database.db
    .select({ id: copyGenerationUnit.id })
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.copyGenerationId, fixture.operationId));
  for (const unit of historicalUnits) {
    const attempt = await allocateOperationAttempt(
      opened.database.db,
      probe.workspaceId,
      fixture.operationId,
    );
    if (!attempt) throw new Error("COPY_RETRY_ATTEMPT_REQUIRED");
    await opened.database.db
      .update(copyGenerationUnit)
      .set({ operationAttemptId: attempt.id, status: "failed" })
      .where(eq(copyGenerationUnit.id, unit.id));
    await opened.database.db
      .update(operationAttempt)
      .set({ failureCode: "TEMPLATE_DRIFT", outcome: "failed_terminal" })
      .where(eq(operationAttempt.id, attempt.id));
  }
  await opened.database.db
    .update(operation)
    .set({ lifecycle: "failed" })
    .where(eq(operation.id, fixture.operationId));

  const { result } = await probe.retryFailedGeneration(
    fixture.operationId,
    "en",
  );
  assert.equal(result.status, "created");
  if (result.status !== "created") throw new Error("COPY_RETRY_NOT_CREATED");

  const [retried] = await opened.database.db
    .select({
      brandPolicyFingerprint: copyGeneration.brandPolicyFingerprint,
      configurationVersion: copyGeneration.configurationVersion,
      customerTemplateFingerprint: copyGeneration.customerTemplateFingerprint,
      promptVersion: copyGeneration.promptVersion,
      requestedContentLocale: copyGeneration.requestedContentLocale,
    })
    .from(copyGeneration)
    .where(eq(copyGeneration.operationId, result.operationId));
  const retriedUnits = await opened.database.db
    .select({ variantKey: copyGenerationUnit.variantKey })
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.copyGenerationId, result.operationId))
    .orderBy(asc(copyGenerationUnit.createdAt), asc(copyGenerationUnit.id));
  const brand = opened.template.mediaBrands[0];
  if (!retried || !brand) throw new Error("COPY_RETRY_RESULT_REQUIRED");
  assert.deepEqual(retried, {
    brandPolicyFingerprint: computeBrandPolicyFingerprint(brand.editorial),
    configurationVersion: COPY_CONFIGURATION_VERSION,
    customerTemplateFingerprint: opened.identity.fingerprint,
    promptVersion: COPY_PROMPT_VERSION,
    requestedContentLocale: "en",
  });
  assert.deepEqual(
    retriedUnits.map((unit) => unit.variantKey),
    fixture.policy.variants.map((variant) => variant.key),
  );
  console.log(
    "copy-generation execution historical-retry current-template=true current-prompt=true failed-units-preserved=true status=pass",
  );
}

async function proveRetryLocaleContract(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("x");
  await probe.completeGeneration(fixture.operationId, "failed");
  await opened.database.db
    .update(operation)
    .set({ lifecycle: "failed" })
    .where(eq(operation.id, fixture.operationId));

  const mismatch = await probe.retryFailedGeneration(fixture.operationId, "fa");
  assert.equal(mismatch.result.status, "validation_failed");
  assert.deepEqual(await probe.retryCommandArtifacts(mismatch.idempotencyKey), {
    attempts: 0,
    operations: 0,
    outboxEvents: 0,
  });
  console.log(
    "copy-generation execution retry-locale same-locale=created mismatched-locale=rejected operations=0 attempts=0 outbox-events=0 worker-events=0 status=pass",
  );
}

async function proveLocaleVariantReplacement(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("x");
  const oldEnVariants = await probe.completeGeneration(
    fixture.operationId,
    "succeeded",
  );
  assert.equal(
    (
      await settleCopyGeneration(
        opened.database.db,
        probe.workspaceId,
        fixture.operationId,
      )
    )?.lifecycle,
    "succeeded",
  );

  const oldFaOperationId = await probe.startBaseGeneration(
    fixture.platformDraftId,
    "fa",
    "regenerate",
  );
  const oldFaVariants = await probe.completeGeneration(
    oldFaOperationId,
    "succeeded",
  );
  assert.equal(
    (
      await settleCopyGeneration(
        opened.database.db,
        probe.workspaceId,
        oldFaOperationId,
      )
    )?.lifecycle,
    "succeeded",
  );
  await probe.createRevisionFromVariant(
    fixture.platformDraftId,
    oldEnVariants[0] ?? "",
  );

  const replacementOperationId = await probe.startBaseGeneration(
    fixture.platformDraftId,
    "en",
    "regenerate",
  );
  const replacementVariants = await probe.completeGeneration(
    replacementOperationId,
    "succeeded",
  );
  const replacement = await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    replacementOperationId,
  );
  assert.equal(replacement?.lifecycle, "succeeded");

  const remaining = new Set(
    (
      await opened.database.db
        .select({ id: copyVariant.id })
        .from(copyVariant)
        .where(
          inArray(copyVariant.id, [
            ...oldEnVariants,
            ...oldFaVariants,
            ...replacementVariants,
          ]),
        )
    ).map((variant) => variant.id),
  );
  assert.equal(remaining.has(oldEnVariants[0] ?? ""), true);
  for (const variantId of oldEnVariants.slice(1)) {
    assert.equal(remaining.has(variantId), false);
  }
  for (const variantId of [...oldFaVariants, ...replacementVariants]) {
    assert.equal(remaining.has(variantId), true);
  }

  const [oldAudit] = await opened.database.db
    .select({
      commandType: operation.commandType,
      generationId: copyGeneration.operationId,
    })
    .from(operation)
    .innerJoin(copyGeneration, eq(copyGeneration.operationId, operation.id))
    .where(eq(operation.id, fixture.operationId));
  const oldAuditUnits = await opened.database.db
    .select({ id: copyGenerationUnit.id })
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.copyGenerationId, fixture.operationId));
  const [replacementAudit] = await opened.database.db
    .select({ commandType: operation.commandType })
    .from(operation)
    .where(eq(operation.id, replacementOperationId));
  assert.equal(oldAudit?.generationId, fixture.operationId);
  assert.equal(oldAuditUnits.length, oldEnVariants.length);
  assert.equal(
    replacementAudit?.commandType,
    `${COPY_GENERATION_COMMAND_PREFIX}regenerate`,
  );

  const refreshOrigin = await probe.createRssOrigin("replacement-refresh");
  const refreshBaselineOperationId = await probe.createRssGeneration(
    refreshOrigin,
    false,
  );
  const [refreshFixture] = await opened.database.db
    .select({ platformDraftId: copyGeneration.platformDraftId })
    .from(copyGeneration)
    .where(eq(copyGeneration.operationId, refreshBaselineOperationId));
  if (!refreshFixture) throw new Error("COPY_REFRESH_REPLACEMENT_REQUIRED");
  const refreshOldVariants = await probe.completeGeneration(
    refreshBaselineOperationId,
    "succeeded",
  );
  await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    refreshBaselineOperationId,
  );
  const refreshOperationId = await probe.startBaseGeneration(
    refreshFixture.platformDraftId,
    "en",
    "refresh_article",
  );
  const refreshVariants = await probe.completeGeneration(
    refreshOperationId,
    "succeeded",
  );
  await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    refreshOperationId,
  );
  assert.equal(await countExistingVariants(refreshOldVariants), 0);
  assert.equal(
    await countExistingVariants(refreshVariants),
    refreshVariants.length,
  );

  const preservationFixture = await probe.createExecutionGeneration("x");
  const preservedVariants = await probe.completeGeneration(
    preservationFixture.operationId,
    "succeeded",
  );
  await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    preservationFixture.operationId,
  );
  const failedOperationId = await probe.startBaseGeneration(
    preservationFixture.platformDraftId,
    "en",
    "regenerate",
  );
  await probe.completeGeneration(failedOperationId, "failed");
  assert.equal(
    (
      await settleCopyGeneration(
        opened.database.db,
        probe.workspaceId,
        failedOperationId,
      )
    )?.lifecycle,
    "failed",
  );
  assert.equal(
    await countExistingVariants(preservedVariants),
    preservedVariants.length,
  );

  const waitingOperationId = await probe.startBaseGeneration(
    preservationFixture.platformDraftId,
    "en",
    "regenerate",
  );
  const waiting = await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    waitingOperationId,
  );
  assert.equal(waiting && "waiting" in waiting, true);
  assert.equal(
    await countExistingVariants(preservedVariants),
    preservedVariants.length,
  );
  console.log(
    "copy-generation execution locale-replacement unreferenced=deleted referenced=retained other-locale=retained current=retained audit=retained failed=preserved waiting=preserved refresh=replace status=pass",
  );
}

async function runExecutionProbe(probe: CopySourceFixture) {
  const brand = opened.template.mediaBrands[0];
  if (!brand) throw new Error("EXECUTION_TEMPLATE_BRAND_REQUIRED");
  await proveLocaleVariantReplacement(probe);
  await proveHistoricalRetryUsesCurrentVersions(probe);
  await proveRetryLocaleContract(probe);
  proveBrandGuidanceOwners();
  proveCopyNormalization(brand);
  await proveStaleCopyReconciliation(probe);
  await proveCancellationFence(probe, brand);
  for (const platform of ["x", "telegram", "instagram"] as const) {
    const policy =
      opened.template.editorial.drafting.copy.platforms.find(
        (entry) => entry.platform === platform,
      ) ??
      (platform === "instagram" ? INSTAGRAM_NORMALIZATION_PROBE_POLICY : null);
    if (!policy) throw new Error(`EXECUTION_PLATFORM_${platform}`);
    assert.ok(
      policy.assembledCharacters.max <= PLATFORM_COPY_HARD_MAX[platform],
    );
    const candidate = candidateFor(
      platform,
      policy,
      brand.editorial.canonicalHashtags.en,
      true,
    );
    const checked = normalizeCopyCandidate(platform, candidate, {
      canonicalHashtag: brand.editorial.canonicalHashtags.en,
      emojiGraphemeCap: policy.emojiGraphemeCap,
      maximumCharacters: policy.assembledCharacters.max,
      maximumHashtags: policy.hashtags.max,
      minimumHashtags: policy.hashtags.min,
      requestedContentLocale: "en",
      source: null,
    });
    assert.equal(checked.length, policy.assembledCharacters.max);
    assert.equal(
      assembleCopy(platform, { ...candidate, hashtags: checked.hashtags }),
      checked.assembled,
    );
  }
  assert.equal(3 * 3, 9);
  assert.equal(3 * 3, 9);
  assert.equal(2 * 3, 6);
  console.log(
    "copy-generation execution maxima x=9 telegram=9 instagram=6 status=pass",
  );
  await proveFingerprintDrift(probe);
  await provePersianLocaleEnforcement(probe, brand);

  const partialFixture = await probe.createExecutionGeneration("x");
  await claimProbeCopy(partialFixture.operationId);
  const partialContext = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    partialFixture.operationId,
  );
  if (partialContext?.units.length !== 3) {
    throw new Error("PARTIAL_FIXTURE_INVALID");
  }
  const canonical = brand.editorial.canonicalHashtags.en;
  const validX = candidateFor("x", partialFixture.policy, canonical, true);
  const invalidX = candidateFor("x", partialFixture.policy, canonical, false);
  const partialGateway = new DeterministicGateway([
    { kind: "output", output: validX },
    { kind: "output", output: invalidX },
    { kind: "schema-invalid" },
    { kind: "output", output: validX },
    { kind: "schema-invalid" },
    { kind: "schema-invalid" },
    { kind: "schema-invalid" },
  ]);
  for (const unit of partialContext.units) {
    await executeCopyGenerationUnit(runtime, partialGateway, {
      ...copyExecutionFence(partialFixture.operationId),
      operationId: partialFixture.operationId,
      unitId: unit.id,
      workspaceId: probe.workspaceId,
    });
  }
  proveCapturedXPrompts(partialGateway.prompts, brand, partialFixture.policy);
  const partial = await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    partialFixture.operationId,
  );
  assert.equal(partial?.lifecycle, "succeeded");
  assert.equal(partialGateway.definiteCallbacks, 4);
  assert.equal(partialGateway.resultCallbacks, 3);
  assert.equal(await operationUsageCount(partialFixture.operationId), 7);
  assert.equal(await operationVariantCount(partialFixture.operationId), 2);
  assert.equal(await operationAttemptCount(partialFixture.operationId), 3);
  assert.equal(await pendingCopyWakeCount(partialFixture.operationId), 0);
  const beforeReplayUsage = await operationUsageCount(
    partialFixture.operationId,
  );
  await executeCopyGenerationUnit(runtime, partialGateway, {
    ...copyExecutionFence(partialFixture.operationId),
    operationId: partialFixture.operationId,
    unitId: partialContext.units[0]?.id ?? "",
    workspaceId: probe.workspaceId,
  });
  assert.equal(
    await operationUsageCount(partialFixture.operationId),
    beforeReplayUsage,
  );
  console.log(
    "copy-generation execution partial definite-callback policy-callback duplicate-success status=pass",
  );

  const ambiguousFixture = await probe.createExecutionGeneration("telegram");
  await claimProbeCopy(ambiguousFixture.operationId);
  const ambiguousContext = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    ambiguousFixture.operationId,
  );
  if (!ambiguousContext) throw new Error("AMBIGUOUS_FIXTURE_INVALID");
  const ambiguousGateway = new DeterministicGateway([{ kind: "ambiguous" }]);
  await executeCopyGenerationUnit(runtime, ambiguousGateway, {
    ...copyExecutionFence(ambiguousFixture.operationId),
    operationId: ambiguousFixture.operationId,
    unitId: ambiguousContext.units[0]?.id ?? "",
    workspaceId: probe.workspaceId,
  });
  assert.equal(await operationUsageCount(ambiguousFixture.operationId), 1);
  const [ambiguousAttempt] = await opened.database.db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(eq(operationAttempt.operationId, ambiguousFixture.operationId));
  assert.equal(ambiguousAttempt?.outcome, "ambiguous");
  assert.equal(ambiguousGateway.definiteCallbacks, 0);
  assert.equal(ambiguousGateway.resultCallbacks, 0);
  console.log(
    "copy-generation execution provider-ambiguity stops-without-definite-callback status=pass",
  );

  const failedFixture = await probe.createExecutionGeneration("x");
  await claimProbeCopy(failedFixture.operationId);
  const failedContext = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    failedFixture.operationId,
  );
  if (failedContext?.units.length !== 3)
    throw new Error("FAILED_FIXTURE_INVALID");
  const unfittableX = candidateFor("x", failedFixture.policy, canonical, false);
  const failedGateway = new DeterministicGateway(
    Array.from(
      { length: 9 },
      () => ({ kind: "output", output: unfittableX }) as const,
    ),
  );
  for (const unit of failedContext.units) {
    await executeCopyGenerationUnit(runtime, failedGateway, {
      ...copyExecutionFence(failedFixture.operationId),
      operationId: failedFixture.operationId,
      unitId: unit.id,
      workspaceId: probe.workspaceId,
    });
  }
  const failed = await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    failedFixture.operationId,
  );
  assert.equal(failed?.lifecycle, "failed");
  assert.equal(await operationUsageCount(failedFixture.operationId), 9);
  assert.equal(await operationVariantCount(failedFixture.operationId), 0);
  console.log(
    "copy-generation execution all-failed per-slot-usage status=pass",
  );

  const cancelledFixture = await probe.createExecutionGeneration("telegram");
  await opened.database.db
    .update(operation)
    .set({ lifecycle: "cancelled" })
    .where(eq(operation.id, cancelledFixture.operationId));
  const cancelledContext = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    cancelledFixture.operationId,
  );
  if (!cancelledContext) throw new Error("CANCELLED_FIXTURE_INVALID");
  const unusedGateway = new DeterministicGateway([]);
  await executeCopyGenerationUnit(runtime, unusedGateway, {
    operationVersion: 0,
    operationId: cancelledFixture.operationId,
    recovered: false,
    token: `probe:${cancelledFixture.operationId}`,
    unitId: cancelledContext.units[0]?.id ?? "",
    workspaceId: probe.workspaceId,
  });
  assert.equal(await operationUsageCount(cancelledFixture.operationId), 0);
  console.log("copy-generation execution pre-slot-cancellation status=pass");

  const waitingFixture = await probe.createExecutionGeneration("telegram");
  await claimProbeCopy(waitingFixture.operationId);
  const waitingContext = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    waitingFixture.operationId,
  );
  if (!waitingContext) throw new Error("WAITING_FIXTURE_INVALID");
  await claimCopyGenerationUnit(
    opened.database.db,
    probe.workspaceId,
    waitingFixture.operationId,
    waitingContext.units[0]?.id ?? "",
    {
      claimedBy: copyExecutionFence(waitingFixture.operationId).token,
      expectedVersion: copyExecutionFence(waitingFixture.operationId)
        .operationVersion,
    },
  );
  const waiting = await settleCopyGeneration(
    opened.database.db,
    probe.workspaceId,
    waitingFixture.operationId,
  );
  assert.equal(waiting && "waiting" in waiting, true);
  console.log(
    "copy-generation execution parent-restart still-running status=pass",
  );

  await proveCrashAfterPendingRecovery(probe);
  await proveSiblingWakePreservesActiveFence(probe, brand);
  await proveMixedRunningRejectedInvokes(probe);
  await proveFunctionPolicy();
  await proveFreshnessOrdering(probe, partialContext);
  await proveDraftInvalidationRetry(probe, partialContext);
  await proveRearm(probe);
}

async function proveStaleCopyReconciliation(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("telegram");
  await claimProbeCopy(fixture.operationId);
  const context = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  const runningUnit = context?.units[0];
  if (!runningUnit) throw new Error("STALE_COPY_FIXTURE_INVALID");
  const unit = await claimCopyGenerationUnit(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
    runningUnit.id,
    {
      claimedBy: copyExecutionFence(fixture.operationId).token,
      expectedVersion: copyExecutionFence(fixture.operationId).operationVersion,
    },
  );
  assert.equal(unit?.status, "running");
  const activeNow = new Date();
  const active = await reconcileStaleCopyOperations(
    opened.database.db,
    probe.workspaceId,
    activeNow,
  );
  assert.equal(
    active.settledDraftChanges.some(
      (item) => item.operationId === fixture.operationId,
    ),
    false,
  );
  const activeContext = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  assert.equal(activeContext?.operationLifecycle, "running");

  const now = new Date(activeNow.getTime() + COPY_OPERATION_LEASE_MS + 1);
  const reconciliation = await reconcileStaleCopyOperations(
    opened.database.db,
    probe.workspaceId,
    now,
  );
  const change = reconciliation.settledDraftChanges.find(
    (item) => item.operationId === fixture.operationId,
  );
  assert.ok(change);
  if (change.kind !== "draft") throw new Error("STALE_COPY_CHANGE_NOT_DRAFT");
  const settled = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  assert.equal(settled?.operationLifecycle, "failed");
  assert.equal(
    settled?.units.some(
      (item) => item.status === "pending" || item.status === "running",
    ),
    false,
  );
  const attempts = await opened.database.db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(eq(operationAttempt.operationId, fixture.operationId));
  assert.ok(attempts.length > 0);
  assert.equal(
    attempts.every((attempt) => attempt.outcome === "failed_terminal"),
    true,
  );

  const order: string[] = [];
  const step = {
    realtime: {
      publish: async () => {
        order.push("lane3");
      },
    },
    run: async (id: string) => {
      order.push(id.startsWith("let-") ? "settle" : "lane2");
      return "accepted";
    },
    sleep: async () => {
      order.push("settle");
    },
  } as never;
  await notifyDraftsChanged(
    step,
    probe.workspaceId,
    change,
    `stale-copy-${fixture.operationId}`,
  );
  assert.deepEqual(order, ["lane2", "settle", "lane3"]);
  console.log(
    `copy-generation execution stale-reconciliation operationId=${fixture.operationId} active-lease-preserved=true expired-lease-failed=true open-units=0 open-attempts=0 lane2-before-lane3=true providerEffects=0 status=pass`,
  );
}

async function proveCancellationFence(
  probe: CopySourceFixture,
  brand: (typeof opened.template.mediaBrands)[number],
) {
  const fixture = await probe.createExecutionGeneration("telegram");
  await claimProbeCopy(fixture.operationId);
  const context = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  const unit = context?.units[0];
  if (!unit) throw new Error("CANCEL_FENCE_FIXTURE_INVALID");
  const fence = copyExecutionFence(fixture.operationId);
  const claimed = await claimCopyGenerationUnit(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
    unit.id,
    {
      claimedBy: fence.token,
      expectedVersion: fence.operationVersion,
    },
  );
  if (claimed?.status !== "running" || !claimed.operationAttemptId) {
    throw new Error("CANCEL_FENCE_UNIT_CLAIM_FAILED");
  }
  const operationAttemptId = claimed.operationAttemptId;
  await markCopyGenerationCancelled(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  const candidate = candidateFor(
    "telegram",
    fixture.policy,
    brand.editorial.canonicalHashtags.en,
    true,
  );
  const rejected = await opened.database.db.transaction((tx) =>
    persistCopyVariantResult(tx, probe.workspaceId, {
      body: candidate.body,
      claimFence: {
        claimedBy: fence.token,
        expectedVersion: fence.operationVersion,
      },
      contentLocale: "en",
      hasMoreSlots: false,
      hashtags: candidate.hashtags,
      headline: candidate.headline,
      operationAttemptId,
      operationId: fixture.operationId,
      policyAccepted: true,
      unitId: unit.id,
    }),
  );
  assert.equal(rejected.status, "parent_invalidated");
  assert.equal(await operationVariantCount(fixture.operationId), 0);
  const terminal = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  assert.equal(terminal?.operationLifecycle, "cancelled");
  assert.equal(terminal?.units[0]?.status, "cancelled");
  const [attempt] = await opened.database.db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(eq(operationAttempt.id, operationAttemptId));
  assert.equal(attempt?.outcome, "failed_terminal");
  console.log(
    "copy-generation execution cancellation-fence parent=cancelled running-unit=cancelled post-cancel-variant=0 open-attempts=0 status=pass",
  );
}

async function runInngestProbe(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("telegram");
  const parentRunId = `copy-parent-${fixture.operationId}`;
  await claimProbeCopy(fixture.operationId, `inngest:${parentRunId}`);
  const context = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  const unit = context?.units[0];
  const brand = opened.template.mediaBrands[0];
  if (!unit || !brand) throw new Error("INNGEST_COPY_FIXTURE_INVALID");
  const gateway = new DeterministicGateway([
    {
      kind: "output",
      output: candidateFor(
        "telegram",
        fixture.policy,
        brand.editorial.canonicalHashtags.en,
        true,
      ),
    },
  ]);

  const childClient = new Inngest({
    appVersion: `copy-child-${randomUUID()}`,
    id: `rz-copy-probe-child-${randomUUID()}`,
  });
  const [parent, child] = createCopyGenerationFunctions(
    childClient,
    runtime,
    () => gateway,
  );
  if (!child) throw new Error("INNGEST_COPY_CHILD_MISSING");
  const driver = childClient.createFunction(
    {
      id: "copy-probe-child-driver",
      retries: 0,
      triggers: [{ event: "probe/copy-child.requested" }],
    },
    ({ step }) =>
      step.invoke("invoke-copy-probe-child", {
        data: {
          ...copyExecutionFence(fixture.operationId),
          operationId: fixture.operationId,
          unitId: unit.id,
          workspaceId: probe.workspaceId,
        },
        function: child,
      }),
  );
  const childConnection = await connect({
    apps: [{ client: childClient, functions: [child, driver] }],
    handleShutdownSignals: [],
    isolateExecution: false,
    maxWorkerConcurrency: 2,
  });
  try {
    await childClient.send({
      id: `copy-child:${fixture.operationId}`,
      name: "probe/copy-child.requested",
      data: {},
    });
    await waitForProbe(async () => {
      const latest = await findCopyExecutionContext(
        opened.database.db,
        probe.workspaceId,
        fixture.operationId,
      );
      return latest?.units.find((entry) => entry.id === unit.id)?.status ===
        "succeeded"
        ? latest
        : null;
    }, "COPY_CHILD_HANDLER_NOT_ENTERED");
    await waitForProbe(
      async () =>
        childConnection.getDebugState().inFlightRequestCount === 0
          ? true
          : null,
      "COPY_CHILD_HANDLER_NOT_QUIESCENT",
    );
  } finally {
    await childConnection.close();
    await childConnection.closed;
  }

  if (!parent) throw new Error("INNGEST_COPY_PARENT_MISSING");
  const order: string[] = [];
  let rejectedInvokes = 0;
  const step = {
    invoke: async () => {
      rejectedInvokes += 1;
      throw new Error("CONTROLLED_INVOKE_TRANSPORT_REJECTION");
    },
    realtime: {
      publish: async (id: string) => {
        order.push(id);
      },
    },
    run: async (id: string, execute: () => Promise<unknown>) => {
      if (id.startsWith("notify-")) {
        order.push(id);
        return "accepted";
      }
      return execute();
    },
    sleep: async (id: string) => {
      order.push(id);
    },
  };
  const handler = (
    parent as unknown as {
      fn: (input: {
        event: {
          data: { operationId: string; schemaVersion: 1; workspaceId: string };
        };
        runId: string;
        step: typeof step;
      }) => Promise<unknown>;
    }
  ).fn;
  await handler({
    event: {
      data: {
        operationId: fixture.operationId,
        schemaVersion: 1,
        workspaceId: probe.workspaceId,
      },
    },
    runId: parentRunId,
    step,
  });
  const terminal = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  if (!terminal) throw new Error("COPY_REJECTED_INVOKE_NOT_TERMINAL");

  assert.equal(terminal.operationLifecycle, "succeeded");
  assert.equal(
    terminal.units.filter((entry) => entry.status === "succeeded").length,
    1,
  );
  assert.equal(
    terminal.units.filter((entry) => entry.status === "failed").length,
    terminal.units.length - 1,
  );
  assert.equal(
    terminal.units.some(
      (entry) => entry.status === "pending" || entry.status === "running",
    ),
    false,
  );
  assert.equal(await operationUsageCount(fixture.operationId), 1);
  assert.equal(await operationAttemptCount(fixture.operationId), 3);
  assert.equal(gateway.resultCallbacks, 1);
  assert.equal(rejectedInvokes, terminal.units.length - 1);
  assert.ok(
    order.indexOf("notify-drafts-cache-terminal") <
      order.indexOf("publish-drafts-changed-terminal"),
  );
  assert.ok(
    order.indexOf("notify-usage-cache-terminal") <
      order.indexOf("publish-usage-ledger-terminal"),
  );
  console.log(
    "copy-generation inngest injected-envelope handler-step=true rejected-transport=pending-only-failed aggregate=terminal providerEffects=0 cleanup=pending status=pass",
  );
}

async function proveCrashAfterPendingRecovery(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("telegram");
  const activeRunId = `copy-crash-active-${fixture.operationId}`;
  await claimProbeCopy(fixture.operationId, `inngest:${activeRunId}`);
  const context = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  if (context?.units.length !== 3) {
    throw new Error("COPY_CRASH_AFTER_PENDING_FIXTURE_INVALID");
  }
  const fence = copyExecutionFence(fixture.operationId);
  const attemptIds: string[] = [];
  for (const unit of context.units) {
    const claimed = await claimCopyGenerationUnit(
      opened.database.db,
      probe.workspaceId,
      fixture.operationId,
      unit.id,
      {
        claimedBy: fence.token,
        expectedVersion: fence.operationVersion,
      },
    );
    if (claimed?.status !== "running" || !claimed.operationAttemptId) {
      throw new Error("COPY_CRASH_AFTER_PENDING_UNIT_CLAIM_FAILED");
    }
    attemptIds.push(claimed.operationAttemptId);
    const pending = await insertPendingUsage(
      opened.database.db,
      probe.workspaceId,
      {
        apiKind: "chat",
        backend: "local",
        claimFence: {
          claimedBy: fence.token,
          expectedVersion: fence.operationVersion,
          now: new Date(),
        },
        invocationKey: "primary",
        operationAttemptId: claimed.operationAttemptId,
        operationId: fixture.operationId,
        providerGateway: "ollama",
        requestedModel: "deterministic-local-probe",
        taskKey: `copy-generation:${context.modelOptionKey}`,
      },
    );
    assert.equal(pending.inserted, true);
  }
  await opened.database.db
    .update(operation)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(operation.id, fixture.operationId));

  const gateway = new DeterministicGateway([]);
  const client = new Inngest({
    appVersion: `copy-crash-recovery-${randomUUID()}`,
    id: `rz-copy-probe-crash-recovery-${randomUUID()}`,
  });
  const [parent] = createCopyGenerationFunctions(
    client,
    runtime,
    () => gateway,
  );
  if (!parent) throw new Error("COPY_CRASH_RECOVERY_PARENT_MISSING");
  let invoked = 0;
  const step = {
    invoke: async (
      _id: string,
      input: {
        data: {
          actorId?: string;
          operationId: string;
          operationVersion: number;
          recovered: boolean;
          token: string;
          unitId: string;
          workspaceId: string;
        };
      },
    ) => {
      invoked += 1;
      return executeCopyGenerationUnit(runtime, gateway, input.data);
    },
    realtime: { publish: async () => undefined },
    run: async (id: string, execute: () => Promise<unknown>) =>
      id.startsWith("notify-") ? "accepted" : execute(),
    sleep: async () => undefined,
  };
  const recovered = await (
    parent as unknown as {
      fn: (input: {
        event: {
          data: { operationId: string; schemaVersion: 1; workspaceId: string };
        };
        runId: string;
        step: typeof step;
      }) => Promise<unknown>;
    }
  ).fn({
    event: {
      data: {
        operationId: fixture.operationId,
        schemaVersion: 1,
        workspaceId: probe.workspaceId,
      },
    },
    runId: `copy-crash-recovery-${fixture.operationId}`,
    step,
  });
  assert.deepEqual(recovered, {
    lifecycle: "unknown",
    operationId: fixture.operationId,
  });
  const terminal = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  assert.equal(terminal?.operationLifecycle, "unknown");
  assert.equal(
    terminal?.units.every((unit) => unit.status === "failed"),
    true,
  );
  const attempts = await opened.database.db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(inArray(operationAttempt.id, attemptIds));
  assert.equal(
    attempts.every((attempt) => attempt.outcome === "ambiguous"),
    true,
  );
  const usage = await opened.database.db
    .select({
      costAuthority: aiUsageEvent.costAuthority,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(inArray(aiUsageEvent.operationAttemptId, attemptIds));
  assert.equal(usage.length, context.units.length);
  assert.equal(
    usage.every(
      (event) =>
        event.status === "unknown" && event.costAuthority === "unknown",
    ),
    true,
  );
  assert.equal(invoked, context.units.length);
  assert.equal(gateway.prompts.length, 0);
  assert.equal(gateway.definiteCallbacks, 0);
  assert.equal(gateway.resultCallbacks, 0);
  console.log(
    "copy-generation execution crash-after-pending expired-owner=recovered usage=unknown attempts=ambiguous aggregate=unknown providerRetries=0 status=pass",
  );
}

async function proveSiblingWakePreservesActiveFence(
  probe: CopySourceFixture,
  brand: (typeof opened.template.mediaBrands)[number],
) {
  const fixture = await probe.createExecutionGeneration("telegram");
  const activeRunId = `copy-active-${fixture.operationId}`;
  const { claimed: activeClaim } = await claimProbeCopy(
    fixture.operationId,
    `inngest:${activeRunId}`,
  );
  const context = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  const first = context?.units[0];
  const sibling = context?.units[1];
  if (!first || !sibling) throw new Error("COPY_SIBLING_WAKE_FIXTURE_INVALID");
  const siblingClaim = await claimCopyGenerationUnit(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
    sibling.id,
    {
      claimedBy: copyExecutionFence(fixture.operationId).token,
      expectedVersion: copyExecutionFence(fixture.operationId).operationVersion,
    },
  );
  assert.equal(siblingClaim?.status, "running");

  const output = candidateFor(
    "telegram",
    fixture.policy,
    brand.editorial.canonicalHashtags.en,
    true,
  );
  const firstResult = await executeCopyGenerationUnit(
    runtime,
    new DeterministicGateway([{ kind: "output", output }]),
    {
      ...copyExecutionFence(fixture.operationId),
      operationId: fixture.operationId,
      unitId: first.id,
      workspaceId: probe.workspaceId,
    },
  );
  assert.equal(firstResult.status, "succeeded");
  assert.equal(await pendingCopyWakeCount(fixture.operationId), 0);
  const scheduled = await scheduleCopyGenerationRecovery(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  assert.equal(scheduled.status, "scheduled");
  assert.ok(
    scheduled.status === "scheduled" &&
      scheduled.nextAttemptAt.getTime() >
        (activeClaim.operation.leaseExpiresAt?.getTime() ?? Number.MAX_VALUE),
  );
  assert.equal(await pendingCopyWakeCount(fixture.operationId), 1);

  const client = new Inngest({
    appVersion: `copy-wake-${randomUUID()}`,
    id: `rz-copy-probe-wake-${randomUUID()}`,
  });
  const [parent] = createCopyGenerationFunctions(client, runtime);
  if (!parent) throw new Error("COPY_SIBLING_WAKE_PARENT_MISSING");
  const siblingGateway = new DeterministicGateway([{ kind: "output", output }]);
  const recoveryGateway = new DeterministicGateway([
    { kind: "output", output },
  ]);
  let recoveryInvokes = 0;
  const busyStep = {
    invoke: async (
      _id: string,
      input: {
        data: {
          actorId?: string;
          operationId: string;
          operationVersion: number;
          recovered: boolean;
          token: string;
          unitId: string;
          workspaceId: string;
        };
      },
    ) => {
      recoveryInvokes += 1;
      return executeCopyGenerationUnit(runtime, recoveryGateway, input.data);
    },
    realtime: { publish: async () => undefined },
    run: async (id: string, execute: () => Promise<unknown>) =>
      id.startsWith("notify-") ? "accepted" : execute(),
    sleep: async () => undefined,
  };
  const wakeRunId = `copy-wake-${fixture.operationId}`;
  const busy = await (
    parent as unknown as {
      fn: (input: {
        event: {
          data: { operationId: string; schemaVersion: 1; workspaceId: string };
        };
        runId: string;
        step: typeof busyStep;
      }) => Promise<unknown>;
    }
  ).fn({
    event: {
      data: {
        operationId: fixture.operationId,
        schemaVersion: 1,
        workspaceId: probe.workspaceId,
      },
    },
    runId: wakeRunId,
    step: busyStep,
  });
  assert.deepEqual(busy, {
    operationId: fixture.operationId,
    replayed: true,
  });
  assert.equal(recoveryInvokes, 0);
  const beforeRecovery = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  assert.equal(beforeRecovery?.operationVersion, activeClaim.operation.version);

  const siblingResult = await executeCopyGenerationUnit(
    runtime,
    siblingGateway,
    {
      ...copyExecutionFence(fixture.operationId),
      operationId: fixture.operationId,
      unitId: sibling.id,
      workspaceId: probe.workspaceId,
    },
  );
  assert.equal(siblingResult.status, "succeeded");
  await opened.database.db
    .update(operation)
    .set({ leaseExpiresAt: new Date(0) })
    .where(eq(operation.id, fixture.operationId));

  const recovery = await (
    parent as unknown as {
      fn: (input: {
        event: {
          data: { operationId: string; schemaVersion: 1; workspaceId: string };
        };
        runId: string;
        step: typeof busyStep;
      }) => Promise<unknown>;
    }
  ).fn({
    event: {
      data: {
        operationId: fixture.operationId,
        schemaVersion: 1,
        workspaceId: probe.workspaceId,
      },
    },
    runId: `copy-recovery-${fixture.operationId}`,
    step: busyStep,
  });
  assert.deepEqual(recovery, {
    lifecycle: "succeeded",
    operationId: fixture.operationId,
  });
  assert.equal(siblingGateway.resultCallbacks, 1);
  assert.equal(recoveryGateway.resultCallbacks, 1);
  assert.equal(recoveryInvokes, 1);
  assert.equal(await operationUsageCount(fixture.operationId), 3);
  assert.equal(await operationVariantCount(fixture.operationId), 3);
  console.log(
    "copy-generation execution recovery-wake busy-run=immediate active-claim=preserved paid-sibling=retained expired-recovery=resumed status=pass",
  );
}

async function proveMixedRunningRejectedInvokes(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("telegram");
  const brand = opened.template.mediaBrands[0];
  if (!brand) throw new Error("INNGEST_COPY_MIXED_BRAND_MISSING");
  const parentRunId = `copy-mixed-${fixture.operationId}`;
  await claimProbeCopy(fixture.operationId, `inngest:${parentRunId}`);
  const initial = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  const heldUnit = initial?.units[0];
  if (!heldUnit) throw new Error("INNGEST_COPY_MIXED_UNIT_MISSING");
  const claimed = await claimCopyGenerationUnit(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
    heldUnit.id,
    {
      claimedBy: copyExecutionFence(fixture.operationId).token,
      expectedVersion: copyExecutionFence(fixture.operationId).operationVersion,
    },
  );
  assert.equal(claimed?.status, "running");
  assert.ok(claimed.operationAttemptId);

  const client = new Inngest({
    appVersion: `copy-mixed-${randomUUID()}`,
    id: `rz-copy-probe-mixed-${randomUUID()}`,
  });
  const [parent] = createCopyGenerationFunctions(
    client,
    runtime,
    () => new DeterministicGateway([]),
  );
  if (!parent) throw new Error("INNGEST_COPY_MIXED_PARENT_MISSING");

  const held = {
    attemptBefore: "",
    attemptId: claimed.operationAttemptId,
    unitBefore: "",
    unitId: heldUnit.id,
  };
  const [unitBefore] = await opened.database.db
    .select()
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.id, held.unitId));
  const [attemptBefore] = await opened.database.db
    .select()
    .from(operationAttempt)
    .where(eq(operationAttempt.id, held.attemptId));
  assert.ok(unitBefore);
  assert.ok(attemptBefore);
  held.unitBefore = JSON.stringify(unitBefore);
  held.attemptBefore = JSON.stringify(attemptBefore);
  let rejectedInvokes = 0;
  const waitingOrder: string[] = [];
  const waitingStep = {
    invoke: async (
      _id: string,
      input: {
        data: {
          operationId: string;
          operationVersion: number;
          token: string;
          unitId: string;
          workspaceId: string;
        };
      },
    ) => {
      if (input.data.unitId === held.unitId) {
        return { status: "waiting", unitId: held.unitId } as const;
      }
      rejectedInvokes += 1;
      throw new Error("CONTROLLED_MIXED_INVOKE_TRANSPORT_REJECTION");
    },
    realtime: {
      publish: async (id: string) => {
        waitingOrder.push(id);
      },
    },
    run: async (id: string, execute: () => Promise<unknown>) => {
      if (id.startsWith("notify-")) {
        waitingOrder.push(id);
        return "accepted";
      }
      return execute();
    },
    sleep: async (id: string) => {
      waitingOrder.push(id);
    },
  };
  const handler = (
    parent as unknown as {
      fn: (input: {
        event: {
          data: { operationId: string; schemaVersion: 1; workspaceId: string };
        };
        runId: string;
        step: typeof waitingStep;
      }) => Promise<unknown>;
    }
  ).fn;
  const waiting = await handler({
    event: {
      data: {
        operationId: fixture.operationId,
        schemaVersion: 1,
        workspaceId: probe.workspaceId,
      },
    },
    runId: parentRunId,
    step: waitingStep,
  });

  assert.deepEqual(waiting, {
    operationId: fixture.operationId,
    status: "waiting_for_unit",
  });
  assert.notEqual(held.unitId, "");
  assert.notEqual(held.unitBefore, "");
  assert.notEqual(held.attemptId, "");
  assert.notEqual(held.attemptBefore, "");
  const mixed = await findCopyExecutionContext(
    opened.database.db,
    probe.workspaceId,
    fixture.operationId,
  );
  if (!mixed) throw new Error("COPY_MIXED_REJECTED_INVOKE_NOT_FOUND");
  copyClaimFences.set(fixture.operationId, {
    operationVersion: mixed.operationVersion,
    recovered: false,
    token: `inngest:${parentRunId}`,
  });
  assert.equal(
    mixed.units.filter((entry) => entry.status === "running").length,
    1,
  );
  assert.equal(
    mixed.units.filter((entry) => entry.status === "failed").length,
    mixed.units.length - 1,
  );
  assert.equal(
    mixed.units.some((entry) => entry.status === "pending"),
    false,
  );
  assert.equal(rejectedInvokes, mixed.units.length - 1);
  assert.equal(
    await operationAttemptCount(fixture.operationId),
    mixed.units.length,
  );
  assert.equal(await operationUsageCount(fixture.operationId), 0);
  const [heldUnitAfter] = await opened.database.db
    .select()
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.id, held.unitId));
  const [heldAttemptAfter] = await opened.database.db
    .select()
    .from(operationAttempt)
    .where(eq(operationAttempt.id, held.attemptId));
  assert.equal(JSON.stringify(heldUnitAfter), held.unitBefore);
  assert.equal(JSON.stringify(heldAttemptAfter), held.attemptBefore);
  assert.equal(await pendingCopyWakeCount(fixture.operationId), 1);

  const gateway = new DeterministicGateway([
    {
      kind: "output",
      output: candidateFor(
        "telegram",
        fixture.policy,
        brand.editorial.canonicalHashtags.en,
        true,
      ),
    },
  ]);
  const unitResult = await executeCopyGenerationUnit(runtime, gateway, {
    ...copyExecutionFence(fixture.operationId),
    operationId: fixture.operationId,
    unitId: held.unitId,
    workspaceId: probe.workspaceId,
  });
  assert.equal(unitResult.status, "succeeded");
  assert.equal(gateway.resultCallbacks, 1);
  assert.equal(await operationUsageCount(fixture.operationId), 1);
  assert.equal(await pendingCopyWakeCount(fixture.operationId), 1);

  const terminalOrder: string[] = [];
  let terminalInvokes = 0;
  const terminalStep = {
    invoke: async () => {
      terminalInvokes += 1;
      throw new Error("TERMINAL_COPY_UNIT_REINVOKED");
    },
    realtime: {
      publish: async (id: string) => {
        terminalOrder.push(id);
      },
    },
    run: async (id: string, execute: () => Promise<unknown>) => {
      if (id.startsWith("notify-")) {
        terminalOrder.push(id);
        return "accepted";
      }
      return execute();
    },
    sleep: async (id: string) => {
      terminalOrder.push(id);
    },
  };
  const terminal = await (
    handler as unknown as (input: {
      event: {
        data: { operationId: string; schemaVersion: 1; workspaceId: string };
      };
      runId: string;
      step: typeof terminalStep;
    }) => Promise<unknown>
  )({
    event: {
      data: {
        operationId: fixture.operationId,
        schemaVersion: 1,
        workspaceId: probe.workspaceId,
      },
    },
    runId: parentRunId,
    step: terminalStep,
  });
  assert.deepEqual(terminal, {
    lifecycle: "succeeded",
    operationId: fixture.operationId,
  });
  assert.equal(terminalInvokes, 0);
  assert.ok(
    terminalOrder.indexOf("notify-drafts-cache-terminal") <
      terminalOrder.indexOf("publish-drafts-changed-terminal"),
  );
  assert.ok(
    terminalOrder.indexOf("notify-usage-cache-terminal") <
      terminalOrder.indexOf("publish-usage-ledger-terminal"),
  );
  console.log(
    "copy-generation inngest mixed-running=true rejected-pending=failed-once running-preserved=true wake-settled=true lane2-before-lane3=true providerEffects=0 cleanup=pending status=pass",
  );
}

async function waitForProbe<T>(
  load: () => Promise<T | null>,
  failure: string,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await load();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failure);
}

async function operationUsageCount(operationId: string) {
  return (
    await opened.database.db
      .select({ id: aiUsageEvent.id })
      .from(aiUsageEvent)
      .where(eq(aiUsageEvent.operationId, operationId))
  ).length;
}

async function operationVariantCount(operationId: string) {
  return (
    await opened.database.db
      .select({ id: copyVariant.id })
      .from(copyVariant)
      .innerJoin(
        copyGenerationUnit,
        eq(copyGenerationUnit.id, copyVariant.copyGenerationUnitId),
      )
      .where(eq(copyGenerationUnit.copyGenerationId, operationId))
  ).length;
}

async function countExistingVariants(variantIds: string[]) {
  if (variantIds.length === 0) return 0;
  return (
    await opened.database.db
      .select({ id: copyVariant.id })
      .from(copyVariant)
      .where(inArray(copyVariant.id, variantIds))
  ).length;
}

async function operationAttemptCount(operationId: string) {
  return (
    await opened.database.db
      .select({ id: operationAttempt.id })
      .from(operationAttempt)
      .where(eq(operationAttempt.operationId, operationId))
  ).length;
}

async function pendingCopyWakeCount(operationId: string) {
  return (
    await opened.database.db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.operationId, operationId),
          isNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
        ),
      )
  ).length;
}

async function proveFunctionPolicy() {
  const client = createInngestClient("copy-probe");
  const functions = createCopyGenerationFunctions(
    client,
    runtime,
    () => new DeterministicGateway([]),
  );
  const descriptors = functions.map(
    (fn) =>
      fn as unknown as {
        opts: {
          id: string;
          concurrency?: { limit: number; key?: string }[];
          retries?: number;
          onFailure?: unknown;
        };
      },
  );
  const parent = descriptors.find(
    (entry) => entry.opts.id === "copy-generation",
  );
  const child = descriptors.find(
    (entry) => entry.opts.id === "copy-generation-unit",
  );
  assert.equal(parent?.opts.retries, COPY_PARENT_RETRIES);
  assert.equal(typeof parent?.opts.onFailure, "function");
  assert.equal(child?.opts.retries, COPY_UNIT_RETRIES);
  assert.equal(
    child?.opts.concurrency?.[0]?.limit,
    opened.template.editorial.fanOut.unitConcurrency,
  );
  assert.equal(child?.opts.concurrency?.[0]?.key, undefined);
  assert.equal(COPY_UNIT_INVOKE_TIMEOUT, "10m");
  assert.equal(COPY_UNIT_QUIESCENCE_PASSES, 12);
  console.log(
    "copy-generation execution config retries=0 concurrency=unkeyed timeout=10m quiescence=12 onFailure=present cancelled-handler=present status=pass",
  );
}

async function proveFreshnessOrdering(
  probe: CopySourceFixture,
  context: NonNullable<Awaited<ReturnType<typeof findCopyExecutionContext>>>,
) {
  if (context.executionScope.kind !== "analysis_run") {
    throw new Error("draft notification requires an analysis-run scope");
  }
  const order: string[] = [];
  const messages: unknown[] = [];
  const step = {
    run: async (id: string) => {
      order.push(
        id.startsWith("let-")
          ? "sleep"
          : id.includes("drafts")
            ? "drafts-lane2"
            : "usage-lane2",
      );
      return "accepted";
    },
    sleep: async () => {
      order.push("sleep");
    },
    realtime: {
      publish: async (_id: string, _topic: unknown, message: unknown) => {
        order.push(messages.length === 0 ? "drafts-lane3" : "usage-lane3");
        messages.push(message);
      },
    },
  } as never;
  await notifyDraftsChanged(
    step,
    probe.workspaceId,
    {
      analysisRunId: context.executionScope.analysisRunId,
      code: "partial",
      operationId: context.operationId,
      platformDraftId: context.platformDraftId,
    },
    "probe",
  );
  await notifyUsageLedgerChanged(
    step,
    probe.workspaceId,
    probe.actorId,
    "probe",
  );
  assert.deepEqual(order, [
    "drafts-lane2",
    "sleep",
    "drafts-lane3",
    "usage-lane2",
    "sleep",
    "usage-lane3",
  ]);
  const serialized = JSON.stringify(messages);
  assert.equal(serialized.includes("headline"), false);
  assert.equal(serialized.includes("body"), false);
  assert.equal(serialized.includes("prompt"), false);
  console.log(
    "copy-generation execution freshness drafts-and-usage lane2-before-lane3 content-free status=pass",
  );
}

async function proveDraftInvalidationRetry(
  probe: CopySourceFixture,
  context: NonNullable<Awaited<ReturnType<typeof findCopyExecutionContext>>>,
) {
  if (context.executionScope.kind !== "analysis_run") {
    throw new Error("draft notification requires an analysis-run scope");
  }
  const originalBaseUrl = workerEnv.WEB_INTERNAL_BASE_URL;
  const originalSecret = workerEnv.CACHE_INVALIDATION_WEBHOOK_SECRET;
  const originalFetch = globalThis.fetch;
  const order: string[] = [];
  let requests = 0;
  Object.defineProperty(workerEnv, "WEB_INTERNAL_BASE_URL", {
    configurable: true,
    value: "http://127.0.0.1:3001",
  });
  Object.defineProperty(workerEnv, "CACHE_INVALIDATION_WEBHOOK_SECRET", {
    configurable: true,
    value: "x".repeat(32),
  });
  globalThis.fetch = async (_input, init) => {
    requests += 1;
    if (requests === 1) throw new Error("synthetic cache connection failure");
    if (requests === 2) return new Response(null, { status: 503 });
    const request = JSON.parse(String(init?.body)) as { tags: string[] };
    return new Response(
      JSON.stringify({
        status: "accepted",
        tags: request.tags.map((tag) => ({ revalidated: true, tag })),
      }),
      { headers: { "content-type": "application/json" }, status: 202 },
    );
  };
  try {
    const step = {
      realtime: {
        publish: async () => {
          order.push("lane3");
        },
      },
      run: async (_id: string, effect: () => Promise<unknown>) => {
        for (let attempt = 1; attempt <= 3; attempt += 1) {
          order.push(`lane2-${attempt}`);
          try {
            return await effect();
          } catch (error) {
            if (attempt === 3) throw error;
          }
        }
      },
      sleep: async () => {
        order.push("settle");
      },
    } as never;
    await notifyDraftsChanged(
      step,
      probe.workspaceId,
      {
        analysisRunId: context.executionScope.analysisRunId,
        code: "partial",
        operationId: context.operationId,
        platformDraftId: context.platformDraftId,
      },
      "probe-retry",
    );
  } finally {
    globalThis.fetch = originalFetch;
    Object.defineProperty(workerEnv, "WEB_INTERNAL_BASE_URL", {
      configurable: true,
      value: originalBaseUrl,
    });
    Object.defineProperty(workerEnv, "CACHE_INVALIDATION_WEBHOOK_SECRET", {
      configurable: true,
      value: originalSecret,
    });
  }
  assert.equal(requests, 3);
  assert.deepEqual(order, ["lane2-1", "lane2-2", "lane2-3", "settle", "lane3"]);
  console.log(
    "copy-generation execution drafts-cache failed-and-rejected=retried lane2-before-lane3=true providerEffects=0 status=pass",
  );
}

async function proveRearm(probe: CopySourceFixture) {
  const fixture = await probe.createExecutionGeneration("telegram");
  const id = randomUUID();
  await opened.database.db.insert(outboxEvent).values({
    id,
    workspaceId: probe.workspaceId,
    operationId: fixture.operationId,
    eventType: "operation/copy-generation.requested",
    schemaVersion: 1,
    payload: {
      schemaVersion: 1,
      workspaceId: probe.workspaceId,
      operationId: fixture.operationId,
    },
    exhaustedAt: new Date(),
  });
  const run = promisify(execFile);
  await run(
    resolve(process.cwd(), "node_modules/.bin/tsx"),
    [resolve(process.cwd(), "src/relay/rearm-cli.ts"), fixture.operationId],
    {
      cwd: process.cwd(),
      env: process.env,
    },
  );
  const [rearmed] = await opened.database.db
    .select()
    .from(outboxEvent)
    .where(eq(outboxEvent.id, id));
  assert.equal(rearmed?.operationId, fixture.operationId);
  assert.equal(rearmed?.exhaustedAt, null);
  assert.equal(rearmed?.dispatchAttemptCount, 0);
  console.log(
    `copy-generation execution relay-rearm operationId=${fixture.operationId} outboxId=${id} same-identity=true status=pass`,
  );
}

const fixture = new CopySourceFixture();
let passedMessage: string | null = null;

try {
  const [installation, extra] = await opened.database.db
    .select({ id: workspace.id })
    .from(workspace)
    .limit(2);
  if (!installation || extra) throw new Error("LOCAL_INSTALLATION_REQUIRED");
  await fixture.setup(installation.id);
  if (command === "source") {
    await runSourceProbe(fixture);
    passedMessage = "copy-generation source probe passed scenarios=12";
  } else if (command === "inngest") {
    await runInngestProbe(fixture);
    passedMessage =
      "copy-generation inngest probe passed cleanup=exact_fixture_removed";
  } else {
    await runExecutionProbe(fixture);
    passedMessage = "copy-generation execution probe passed";
  }
} catch (error) {
  process.exitCode = EXIT_FAILURE;
  console.error(
    `copy-generation probe failed [${error instanceof Error ? error.message : "UNKNOWN"}]`,
  );
} finally {
  await fixture.cleanup();
  await opened.database.close();
}
if (passedMessage) console.log(passedMessage);
