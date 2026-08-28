import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  cacheInvalidationRequestSchema,
  operationStatusRealtimeMessageSchema,
  publicationRequestedPayloadSchema,
  publishingChangedRealtimeMessageSchema,
} from "@rz-chain-reporter/contracts";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import {
  type Executor,
  withWorkspaceContext,
} from "@rz-chain-reporter/db/executor";
import { recordPublicationSettlementActivity } from "@rz-chain-reporter/db/repositories/activity-event";
import { grantApproval } from "@rz-chain-reporter/db/repositories/approval";
import {
  admitDirectPublication,
  beginOrResumePublicationAttempt,
  claimPublicationExecution,
  claimPublicationFinalEffect,
  classifyPublicationWake,
  loadPublicationExecutionContext,
  reassertPublicationExecution,
  recordPublicationCheckpoint,
  settlePublicationExecution,
} from "@rz-chain-reporter/db/repositories/publication";
import { activityEvent } from "@rz-chain-reporter/db/schema/activity-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { copyVariant } from "@rz-chain-reporter/db/schema/copy-variant";
import { destinationAccount } from "@rz-chain-reporter/db/schema/destination-account";
import { draftRevision } from "@rz-chain-reporter/db/schema/draft-revision";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { mediaBrandDestinationAccount } from "@rz-chain-reporter/db/schema/media-brand-destination-account";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { promoIdea } from "@rz-chain-reporter/db/schema/promo-idea";
import { publication } from "@rz-chain-reporter/db/schema/publication";
import { publicationReconciliation } from "@rz-chain-reporter/db/schema/publication-reconciliation";
import { publishCheckpoint } from "@rz-chain-reporter/db/schema/publish-checkpoint";
import { publishOperation } from "@rz-chain-reporter/db/schema/publish-operation";
import { schedule } from "@rz-chain-reporter/db/schema/schedule";
import {
  type DestinationCredential,
  resolveDestinationCredential,
} from "@rz-chain-reporter/env/destination-bindings";
import { and, asc, desc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import sharp from "sharp";
import { workerLogger } from "../logging/logger";
import {
  scrubWorkerErrorEvent,
  scrubWorkerLog,
  scrubWorkerTransaction,
} from "../observability/privacy";
import { createPublisher } from "../publishing/factory";
import { createInstagramPublisher } from "../publishing/instagram";
import {
  PROVIDER_MEDIA_UPLOAD_TIMEOUT_MS,
  PROVIDER_REQUEST_TIMEOUT_MS,
  PROVIDER_RESPONSE_MAX_BYTES,
  type ProviderFailure,
  type PublisherRuntime,
  type PublishMaterial,
  type PublishRequest,
  providerCheckpointSchema,
  providerFailureSchema,
  providerRequestTimeoutMs,
  publishMaterialSchema,
  publishRequestSchema,
} from "../publishing/port";
import { publishRasterForUpload } from "../publishing/publish-raster";
import { createTelegramPublisher } from "../publishing/telegram";
import {
  classifyXFailure,
  createXPublisher,
  exactRecentTimelineCandidate,
  oauthAuthorization,
} from "../publishing/x";
import { settlePublishingNotification } from "../web-cache/publishing";
import { publishingEffectInputSchema } from "./publishing-effect";

const args = process.argv.slice(2);
const mode = parseMode(args);

type ProbeMode =
  | { kind: "zero-key" }
  | { callBudget: 4; kind: "bound"; platforms: readonly ["telegram", "x"] };

function parseMode(argv: readonly string[]): ProbeMode {
  if (argv.length === 2 && argv[0] === "--mode" && argv[1] === "zero-key") {
    return { kind: "zero-key" };
  }
  if (
    argv.length === 6 &&
    argv[0] === "--mode" &&
    argv[1] === "bound" &&
    argv[2] === "--platforms" &&
    argv[3] === "telegram,x" &&
    argv[4] === "--call-budget" &&
    argv[5] === "4"
  ) {
    return { callBudget: 4, kind: "bound", platforms: ["telegram", "x"] };
  }
  console.error(
    "publishing probe failed [USAGE: --mode zero-key | --mode bound --platforms telegram,x --call-budget 4]",
  );
  process.exit(1);
}

const ATTEMPT_ID = "00000000-0000-4000-8000-000000000011";
const OPERATION_ID = "00000000-0000-4000-8000-000000000012";
const PUBLICATION_ID = "00000000-0000-4000-8000-000000000013";
const WORKSPACE_ID = "00000000-0000-4000-8000-000000000014";
const PRIVACY_SENTINEL = "PHASE8_PRIVATE_CONTENT_SENTINEL";
const request = publishRequestSchema.parse({
  operationId: OPERATION_ID,
  publicationId: PUBLICATION_ID,
  workspaceId: WORKSPACE_ID,
});

const baseMaterial: PublishMaterial = {
  contentLocale: "en",
  destinationKey: "destination",
  draft: {
    body: "A bounded body",
    hashtags: ["#news"],
    headline: "A bounded headline",
  },
  media: null,
  platform: "telegram",
  source: {
    attribution: "Trusted Desk",
    canonicalUrl: "https://example.com/story",
  },
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function fakeFetch(
  responses: readonly (Response | Error)[],
  calls: string[],
  inits?: RequestInit[],
) {
  let index = 0;
  return (async (resource: string | URL | Request, init?: RequestInit) => {
    calls.push(String(resource));
    inits?.push(init ?? {});
    const response = responses[index];
    index += 1;
    if (!response) throw new Error("UNEXPECTED_PROVIDER_CALL");
    if (response instanceof Error) throw response;
    return response;
  }) as typeof fetch;
}

async function fixturePng() {
  const buffer = await sharp({
    create: {
      background: { r: 16, g: 16, b: 16 },
      channels: 3,
      height: 2,
      width: 2,
    },
  })
    .png()
    .toBuffer();
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}

function formFieldType(body: RequestInit["body"], field: string) {
  if (!(body instanceof FormData)) return null;
  const part = body.get(field);
  return part instanceof Blob ? part.type : null;
}

function fakeRuntime(
  material: PublishMaterial,
  checkpoints: Partial<
    Record<
      | "telegram_message"
      | "x_media"
      | "x_post"
      | "instagram_grant"
      | "instagram_container"
      | "instagram_media",
      string
    >
  > = {},
  resumed = false,
) {
  const effects: string[] = [];
  let attempts = 0;
  const runtime: PublisherRuntime = {
    beginAttempt: async () => {
      attempts += 1;
      return { id: ATTEMPT_ID, number: attempts, resumed };
    },
    claimFinalEffect: async () => true,
    existingCheckpoint: async (_request, kind) => {
      const id = checkpoints[kind];
      return id ? { kind, providerReferenceId: id } : null;
    },
    readMedia: async () => fixturePng(),
    renewLease: async () => {
      effects.push("renew");
    },
    run: async (name, effect) => {
      effects.push(`reassert:${name}`);
      return effect();
    },
    sleep: async (duration) => {
      effects.push(`sleep:${duration}`);
    },
    withMaterial: async (_name, effect) => effect(material),
  };
  return {
    effects,
    get attempts() {
      return attempts;
    },
    runtime,
  };
}

const REPLAY_HANDLER = Symbol("REPLAY_HANDLER");

function replayRuntime(material: PublishMaterial, initialNow: number) {
  const memoized = new Map<string, unknown>();
  const memoizedOutputs: unknown[] = [];
  const deadlineObservations: number[] = [];
  let attempts = 0;
  let finalEffectStarted = false;
  let clock = initialNow;
  let replayCount = 0;
  let runOccurrences = new Map<string, number>();
  let sleepOccurrence = 0;
  let renewalOccurrence = 0;

  const nextOccurrence = (name: string) => {
    const occurrence = (runOccurrences.get(name) ?? 0) + 1;
    runOccurrences.set(name, occurrence);
    return occurrence;
  };

  const replayStep = async <T>(key: string, effect: () => Promise<T>) => {
    if (memoized.has(key)) {
      return structuredClone(memoized.get(key)) as T;
    }
    const value = structuredClone(await effect());
    memoized.set(key, value);
    memoizedOutputs.push(value);
    throw REPLAY_HANDLER;
  };

  const runtime: PublisherRuntime = {
    beginAttempt: () =>
      replayStep("begin-attempt", async () => {
        attempts += 1;
        return { id: ATTEMPT_ID, number: attempts, resumed: false };
      }),
    claimFinalEffect: async () => {
      if (finalEffectStarted) return false;
      finalEffectStarted = true;
      return true;
    },
    existingCheckpoint: (_request, kind) =>
      replayStep(`existing-checkpoint:${kind}`, async () => null),
    readMedia: (objectKey) =>
      replayStep(`read-media:${objectKey}`, async () => fixturePng()),
    renewLease: async () => {
      renewalOccurrence += 1;
      await replayStep(`renew-lease:${renewalOccurrence}`, async () => null);
    },
    run: async (name, effect) => {
      const key = `run:${name}:${nextOccurrence(name)}`;
      const value = await replayStep(key, effect);
      if (name === "instagram-poll-deadline") {
        deadlineObservations.push(value as number);
      }
      return value;
    },
    sleep: async (duration) => {
      sleepOccurrence += 1;
      await replayStep(`sleep:${sleepOccurrence}`, async () => {
        clock += durationMilliseconds(duration);
        return null;
      });
    },
    withMaterial: async (name, effect) => {
      const key = `material:${name}:${nextOccurrence(name)}`;
      return replayStep(key, async () => effect(structuredClone(material)));
    },
  };

  return {
    deadlineObservations,
    get attempts() {
      return attempts;
    },
    get clock() {
      return clock;
    },
    memoized,
    memoizedOutputs,
    now: () => clock,
    async restart<T>(operation: () => Promise<T>) {
      for (let pass = 0; pass < 500; pass += 1) {
        runOccurrences = new Map();
        sleepOccurrence = 0;
        renewalOccurrence = 0;
        try {
          return await operation();
        } catch (error) {
          if (error !== REPLAY_HANDLER) throw error;
          replayCount += 1;
        }
      }
      throw new Error("REPLAY_PROBE_DID_NOT_SETTLE");
    },
    get replayCount() {
      return replayCount;
    },
    runtime,
  };
}

function durationMilliseconds(duration: string) {
  const parsed = /^(\d+)(ms|s)$/u.exec(duration);
  if (!parsed) throw new Error("REPLAY_DURATION_INVALID");
  const amount = Number(parsed[1]);
  return parsed[2] === "s" ? amount * 1_000 : amount;
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

type BoundShape = "telegram_text" | "telegram_photo" | "x_text" | "x_media";

type TemplateDestination = CustomerTemplate["destinationAccounts"][number];

type BoundFixture = {
  actorId: string;
  attemptId: string | null;
  destination: TemplateDestination;
  operationLifecycle: (typeof operation.$inferSelect)["lifecycle"];
  operationId: string;
  operationVersion: number | null;
  platform: "telegram" | "x";
  publicationId: string;
  request: PublishRequest;
  shape: BoundShape;
};

const BOUND_SHAPES = [
  "telegram_text",
  "telegram_photo",
  "x_text",
  "x_media",
] as const satisfies readonly BoundShape[];

function expectedProviderRequests(shape: BoundShape) {
  switch (shape) {
    case "telegram_text":
      return ["telegram_send_message"] as const;
    case "telegram_photo":
      return ["telegram_send_photo"] as const;
    case "x_text":
      return ["x_post"] as const;
    case "x_media":
      return ["x_media_upload", "x_post"] as const;
  }
}

function createBoundFetchGuard(
  callBudget: number,
  consumedShapes: readonly BoundShape[],
) {
  const providerFetch = globalThis.fetch.bind(globalThis);
  let active:
    | { expected: readonly string[]; index: number; shape: BoundShape }
    | undefined;
  let dispatchedOperations = consumedShapes.length;
  let providerRequests = consumedShapes.reduce(
    (total, shape) => total + expectedProviderRequests(shape).length,
    0,
  );

  return {
    begin(shape: BoundShape) {
      assert.equal(active, undefined, "BOUND_OPERATION_OVERLAP");
      assert.ok(
        dispatchedOperations < callBudget,
        "BOUND_OPERATION_BUDGET_EXCEEDED",
      );
      dispatchedOperations += 1;
      active = { expected: expectedProviderRequests(shape), index: 0, shape };
    },
    complete(allowPartial = false) {
      assert.ok(active, "BOUND_OPERATION_NOT_RESERVED");
      if (!allowPartial) {
        assert.equal(
          active.index,
          active.expected.length,
          "BOUND_PROVIDER_REQUEST_SEQUENCE_INCOMPLETE",
        );
      } else {
        assert.ok(
          active.index <= active.expected.length,
          "BOUND_PROVIDER_REQUEST_SEQUENCE_INVALID",
        );
      }
      active = undefined;
    },
    fetch: (async (resource: string | URL | Request, init?: RequestInit) => {
      assert.ok(active, "BOUND_PROVIDER_REQUEST_WITHOUT_OPERATION");
      const url = new URL(
        resource instanceof Request ? resource.url : String(resource),
      );
      const requestKind = classifyBoundProviderRequest(url, init?.method);
      assert.notEqual(requestKind, "instagram", "INSTAGRAM_CALL_FORBIDDEN");
      assert.equal(
        requestKind,
        active.expected[active.index],
        "BOUND_PROVIDER_REQUEST_SEQUENCE_INVALID",
      );
      active.index += 1;
      providerRequests += 1;
      return providerFetch(resource, init);
    }) as typeof fetch,
    summary() {
      assert.equal(active, undefined, "BOUND_OPERATION_UNFINISHED");
      assert.equal(
        dispatchedOperations,
        callBudget,
        "BOUND_OPERATION_BUDGET_NOT_CONSUMED",
      );
      assert.equal(providerRequests, 5, "BOUND_PROVIDER_REQUEST_COUNT_INVALID");
      return { dispatchedOperations, providerRequests };
    },
  };
}

function classifyBoundProviderRequest(url: URL, method = "GET") {
  if (url.hostname.includes("instagram") || url.hostname.includes("facebook")) {
    return "instagram" as const;
  }
  if (
    method === "POST" &&
    url.hostname === "api.telegram.org" &&
    url.pathname.endsWith("/sendMessage")
  ) {
    return "telegram_send_message" as const;
  }
  if (
    method === "POST" &&
    url.hostname === "api.telegram.org" &&
    url.pathname.endsWith("/sendPhoto")
  ) {
    return "telegram_send_photo" as const;
  }
  if (
    method === "POST" &&
    url.hostname === "upload.twitter.com" &&
    url.pathname === "/1.1/media/upload.json"
  ) {
    return "x_media_upload" as const;
  }
  if (
    method === "POST" &&
    url.hostname === "api.x.com" &&
    url.pathname === "/2/tweets"
  ) {
    return "x_post" as const;
  }
  throw new Error("BOUND_PROVIDER_REQUEST_FORBIDDEN");
}

async function runBound(callBudget: 4) {
  if (
    process.env.NODE_ENV === "production" ||
    process.env.INNGEST_DEV === undefined
  ) {
    throw new Error("BOUND_DIAGNOSTIC_MODE_REQUIRED");
  }
  const [{ assertWorkspace, openWorkerRuntime }, mediaStorage] =
    await Promise.all([import("./runtime"), import("./media-storage")]);
  const opened = openWorkerRuntime();
  try {
    const installation = await assertWorkspace({
      db: opened.database.db,
      identity: opened.identity,
    });
    const destinations = enabledBoundDestinations(opened.template);
    const credentials = destinations.map((destination) =>
      resolveDestinationCredential(destination, process.env),
    );
    const prior = await loadBoundBatch(
      opened.database.db,
      installation.workspaceId,
      destinations,
    );
    if (prior?.complete) throw new Error("BOUND_BATCH_ALREADY_CONSUMED");
    const fixtureBatchId = prior?.batchId ?? randomUUID();
    const prepared =
      prior ??
      (await prepareBoundFixtures({
        actorWorkspaceId: installation.workspaceId,
        batchId: fixtureBatchId,
        db: opened.database.db,
        destinations,
        readMedia: async (objectKey) =>
          mediaStorage.readStorageBytes(
            mediaStorage.workerStorage(),
            objectKey,
          ),
      }));
    assert.deepEqual(
      prepared.fixtures.map((fixture) => fixture.shape),
      BOUND_SHAPES,
    );
    assert.equal(prepared.fixtures.length, callBudget);

    const consumed = prepared.fixtures.filter(
      (fixture) => fixture.attemptId !== null,
    );
    const untouched = prepared.fixtures.filter(
      (fixture) =>
        fixture.attemptId === null && fixture.operationLifecycle === "queued",
    );
    if (prior) {
      assert.deepEqual(
        consumed.map((fixture) => fixture.shape),
        ["telegram_text", "telegram_photo"],
        "BOUND_CONSUMED_OPERATION_SET_INVALID",
      );
      assert.deepEqual(
        untouched.map((fixture) => fixture.shape),
        ["x_text", "x_media"],
        "BOUND_CONTINUATION_OPERATION_SET_INVALID",
      );
    }
    const guard = createBoundFetchGuard(
      callBudget,
      consumed.map((fixture) => fixture.shape),
    );
    const results: Array<{
      checkpointKinds: string[];
      destinationKey: string;
      durationMs: number;
      operationId: string;
      platform: "telegram" | "x";
      providerResultId: string | null;
      publicationId: string;
      shape: BoundShape;
      status: "confirmed" | "definite_failure" | "delivery_unknown";
    }> = [];
    for (const fixture of consumed) {
      let status: "definite_failure" | "delivery_unknown";
      if (fixture.operationLifecycle === "unknown") {
        status = "delivery_unknown";
      } else if (fixture.operationLifecycle === "failed") {
        await recordBoundSettlementActivity(
          { db: opened.database.db, fixture },
          "publication.failed",
        );
        status = "definite_failure";
      } else if (fixture.operationLifecycle === "running") {
        await settleConsumedUnknownFixture(
          opened.database.db,
          fixture,
          `publishing-bound-probe:${fixtureBatchId}`,
        );
        status = "delivery_unknown";
      } else {
        throw new Error("BOUND_CONSUMED_OPERATION_STATE_INVALID");
      }
      results.push({
        checkpointKinds: [],
        destinationKey: fixture.destination.key,
        durationMs: 0,
        operationId: fixture.operationId,
        platform: fixture.platform,
        providerResultId: null,
        publicationId: fixture.publicationId,
        shape: fixture.shape,
        status,
      });
    }
    for (const fixture of untouched) {
      guard.begin(fixture.shape);
      const startedAt = Date.now();
      const result = await executeBoundFixture({
        claimedBy: `publishing-bound-probe:${fixtureBatchId}`,
        db: opened.database.db,
        destination: fixture.destination,
        fetch: guard.fetch,
        fixture,
        readMedia: async (objectKey) =>
          mediaStorage.readStorageBytes(
            mediaStorage.workerStorage(),
            objectKey,
          ),
      });
      guard.complete(result.status !== "confirmed");
      results.push({
        checkpointKinds: result.checkpointKinds,
        destinationKey: fixture.destination.key,
        durationMs: Date.now() - startedAt,
        operationId: fixture.operationId,
        platform: fixture.platform,
        providerResultId:
          result.status === "confirmed" ? result.providerResultId : null,
        publicationId: fixture.publicationId,
        shape: fixture.shape,
        status: result.status,
      });
    }
    const dispatch = guard.summary();
    const databaseEvidence = await inspectBoundDatabase(
      opened.database.db,
      installation.workspaceId,
      results,
      prepared.contentSentinel,
      credentials,
    );
    console.log(
      JSON.stringify({
        databaseEvidence,
        dispatch,
        fixtureBatchId,
        instagram: "deferred_not_applicable",
        results,
      }),
    );
  } finally {
    await opened.database.close();
  }
}

function enabledBoundDestinations(template: CustomerTemplate) {
  const enabledInstagram = template.destinationAccounts.some(
    (destination) =>
      destination.platform === "instagram" && destination.enabled,
  );
  if (enabledInstagram) throw new Error("INSTAGRAM_DESTINATION_ENABLED");
  const destinations = template.destinationAccounts.filter(
    (destination) =>
      (destination.platform === "telegram" || destination.platform === "x") &&
      destination.enabled,
  );
  assert.equal(destinations.length, 2, "BOUND_DESTINATION_SET_INVALID");
  assert.deepEqual(
    destinations.map((destination) => destination.platform).sort(),
    ["telegram", "x"],
  );
  return destinations;
}

async function loadBoundBatch(
  db: Executor,
  workspaceId: string,
  destinations: readonly TemplateDestination[],
) {
  const rows = await db
    .select({
      actorId: operation.actor,
      attemptId: operationAttempt.id,
      destinationKey: destinationAccount.key,
      idempotencyKey: operation.idempotencyKey,
      lifecycle: operation.lifecycle,
      operationId: operation.id,
      operationVersion: operation.version,
      platform: publishOperation.platform,
      publicationId: publishOperation.publicationId,
    })
    .from(operation)
    .innerJoin(
      publishOperation,
      and(
        eq(publishOperation.workspaceId, workspaceId),
        eq(publishOperation.operationId, operation.id),
      ),
    )
    .innerJoin(
      destinationAccount,
      and(
        eq(destinationAccount.workspaceId, workspaceId),
        eq(destinationAccount.id, publishOperation.destinationAccountId),
      ),
    )
    .leftJoin(
      operationAttempt,
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(operationAttempt.operationId, operation.id),
      ),
    )
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        sql`${operation.idempotencyKey} like 'bound-publish:%'`,
      ),
    )
    .orderBy(desc(operation.createdAt))
    .limit(4);
  if (rows.length === 0) return null;
  assert.equal(rows.length, 4, "BOUND_BATCH_PARTIAL_FIXTURE_SET");
  const identities = rows.map((row) => {
    const match =
      /^bound-publish:([^:]+):(telegram_text|telegram_photo|x_text|x_media)$/u.exec(
        row.idempotencyKey,
      );
    assert.ok(match, "BOUND_BATCH_IDENTITY_INVALID");
    return { batchId: match[1] as string, shape: match[2] as BoundShape };
  });
  const batchId = identities[0]?.batchId;
  assert.ok(batchId, "BOUND_BATCH_IDENTITY_MISSING");
  assert.ok(
    identities.every((identity) => identity.batchId === batchId),
    "BOUND_BATCH_IDENTITY_MISMATCH",
  );
  const destinationByKey = new Map(
    destinations.map((destination) => [destination.key, destination]),
  );
  const fixtures = rows
    .map((row, index): BoundFixture => {
      const destination = destinationByKey.get(row.destinationKey);
      const identity = identities[index];
      assert.ok(destination && identity, "BOUND_BATCH_DESTINATION_MISSING");
      assert.ok(
        row.publicationId &&
          (row.platform === "telegram" || row.platform === "x"),
        "BOUND_BATCH_PUBLICATION_MISSING",
      );
      return {
        actorId: row.actorId,
        attemptId: row.attemptId,
        destination,
        operationLifecycle: row.lifecycle,
        operationId: row.operationId,
        operationVersion: row.operationVersion,
        platform: row.platform,
        publicationId: row.publicationId,
        request: publishRequestSchema.parse({
          operationId: row.operationId,
          publicationId: row.publicationId,
          workspaceId,
        }),
        shape: identity.shape,
      };
    })
    .sort(
      (left, right) =>
        BOUND_SHAPES.indexOf(left.shape) - BOUND_SHAPES.indexOf(right.shape),
    );
  return {
    batchId,
    complete: rows.every(
      (row) => row.lifecycle !== "queued" && row.lifecycle !== "running",
    ),
    contentSentinel: `phase8-bound-${batchId}`,
    fixtures,
  };
}

async function settleConsumedUnknownFixture(
  db: Executor,
  fixture: BoundFixture,
  claimedBy: string,
) {
  assert.ok(
    fixture.attemptId && fixture.operationVersion !== null,
    "BOUND_CONSUMED_ATTEMPT_MISSING",
  );
  const context = await loadPublicationExecutionContext(
    db,
    fixture.request.workspaceId,
    fixture.operationId,
  );
  assert.ok(context, "BOUND_CONSUMED_CONTEXT_MISSING");
  const publicationResult = await settlePublicationExecution(
    db,
    fixture.request.workspaceId,
    {
      attemptId: fixture.attemptId,
      claimedBy,
      expectedOperationVersion: fixture.operationVersion,
      failureCode: "DELIVERY_UNKNOWN",
      operationId: fixture.operationId,
      outcome: "delivery_unknown",
      publicationId: fixture.publicationId,
    },
  );
  assert.ok(publicationResult, "BOUND_UNKNOWN_SETTLEMENT_LOST");
  const occurredAt = new Date();
  await recordPublicationSettlementActivity(db, fixture.request.workspaceId, {
    actorId: context.operation.actor,
    eventType: "publication.delivery_unknown",
    idempotencyKey: `bound-unknown:${fixture.operationId}`,
    operationId: fixture.operationId,
    publicationId: fixture.publicationId,
    requestHash: `bound-unknown:${fixture.operationId}`,
    occurredAt,
  });
}

async function prepareBoundFixtures(input: {
  actorWorkspaceId: string;
  batchId: string;
  db: Executor;
  destinations: readonly TemplateDestination[];
  readMedia(objectKey: string): Promise<Uint8Array>;
}) {
  const destinationKeys = input.destinations.map(
    (destination) => destination.key,
  );
  const destinationRows = await input.db
    .select({
      bindingPresent: destinationAccount.bindingPresent,
      enabled: destinationAccount.enabled,
      id: destinationAccount.id,
      key: destinationAccount.key,
      platform: destinationAccount.platform,
    })
    .from(destinationAccount)
    .where(
      and(
        eq(destinationAccount.workspaceId, input.actorWorkspaceId),
        inArray(destinationAccount.key, destinationKeys),
        isNull(destinationAccount.deletedAt),
      ),
    );
  assert.equal(destinationRows.length, 2, "BOUND_DB_DESTINATIONS_MISSING");
  for (const destination of input.destinations) {
    const row = destinationRows.find(
      (candidate) =>
        candidate.key === destination.key &&
        candidate.platform === destination.platform,
    );
    assert.ok(
      row?.enabled && row.bindingPresent,
      "BOUND_DB_DESTINATION_UNREADY",
    );
  }

  const mappings = await input.db
    .select({
      destinationAccountId: mediaBrandDestinationAccount.destinationAccountId,
      mediaBrandId: mediaBrandDestinationAccount.mediaBrandId,
    })
    .from(mediaBrandDestinationAccount)
    .where(
      and(
        eq(mediaBrandDestinationAccount.workspaceId, input.actorWorkspaceId),
        inArray(
          mediaBrandDestinationAccount.destinationAccountId,
          destinationRows.map((destination) => destination.id),
        ),
        isNull(mediaBrandDestinationAccount.deletedAt),
      ),
    );
  const brandId = mappings.find((mapping) =>
    destinationRows.every((destination) =>
      mappings.some(
        (candidate) =>
          candidate.mediaBrandId === mapping.mediaBrandId &&
          candidate.destinationAccountId === destination.id,
      ),
    ),
  )?.mediaBrandId;
  assert.ok(brandId, "BOUND_SHARED_MEDIA_BRAND_MISSING");

  const [modelUnit] = await input.db
    .select({ id: analysisModelUnit.id })
    .from(analysisModelUnit)
    .where(
      and(
        eq(analysisModelUnit.workspaceId, input.actorWorkspaceId),
        eq(analysisModelUnit.mediaBrandId, brandId),
      ),
    )
    .orderBy(asc(analysisModelUnit.createdAt))
    .limit(1);
  const [originatingVariant] = await input.db
    .select({ id: copyVariant.id })
    .from(copyVariant)
    .where(eq(copyVariant.workspaceId, input.actorWorkspaceId))
    .orderBy(asc(copyVariant.createdAt))
    .limit(1);
  const [author] = await input.db
    .select({ id: draftRevision.authoredBy })
    .from(draftRevision)
    .where(eq(draftRevision.workspaceId, input.actorWorkspaceId))
    .orderBy(asc(draftRevision.createdAt))
    .limit(1);
  assert.ok(
    modelUnit && originatingVariant && author,
    "BOUND_PROVENANCE_MISSING",
  );

  const mediaCandidates = await input.db
    .select({
      actualBytes: mediaAsset.actualBytes,
      id: mediaAsset.id,
      mimeType: mediaAsset.mimeType,
      objectKey: mediaAsset.objectKey,
    })
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.workspaceId, input.actorWorkspaceId),
        eq(mediaAsset.kind, "image"),
        eq(mediaAsset.lifecycle, "verified"),
        isNull(mediaAsset.objectRemovedAt),
        sql`${mediaAsset.actualBytes} between 1 and ${5 * 1024 * 1024}`,
      ),
    )
    .orderBy(asc(mediaAsset.actualBytes));
  let approvedMedia:
    | { actualBytes: number; id: string; mimeType: string; objectKey: string }
    | undefined;
  for (const candidate of mediaCandidates) {
    if (candidate.actualBytes === null) continue;
    const bytes = await input.readMedia(candidate.objectKey).catch(() => null);
    if (bytes && bytes.byteLength === candidate.actualBytes) {
      approvedMedia = { ...candidate, actualBytes: candidate.actualBytes };
      break;
    }
  }
  assert.ok(approvedMedia, "BOUND_APPROVED_MEDIA_MISSING");

  const contentSentinel = `phase8-bound-${input.batchId}`;
  const destinationByPlatform = new Map(
    input.destinations.map((destination) => [
      destination.platform,
      destination,
    ]),
  );
  const fixtureRows = BOUND_SHAPES.map((shape, index) => ({
    destination: destinationByPlatform.get(
      shape.startsWith("telegram") ? "telegram" : "x",
    ) as TemplateDestination,
    draftId: randomUUID(),
    mediaAssetId:
      shape === "telegram_photo" || shape === "x_media"
        ? approvedMedia.id
        : null,
    promoIdeaId: randomUUID(),
    revisionId: randomUUID(),
    shape,
    sortOffset: index + 1,
  }));
  assert.ok(
    fixtureRows.every((fixture) => fixture.destination),
    "BOUND_DESTINATION_PLAN_INVALID",
  );

  await input.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, input.actorWorkspaceId);
    const [rankRow] = await tx
      .select({ value: max(promoIdea.rank) })
      .from(promoIdea)
      .where(
        and(
          eq(promoIdea.workspaceId, input.actorWorkspaceId),
          eq(promoIdea.analysisModelUnitId, modelUnit.id),
        ),
      );
    const [laneRow] = await tx
      .select({ value: max(platformDraft.lanePosition) })
      .from(platformDraft)
      .where(
        and(
          eq(platformDraft.workspaceId, input.actorWorkspaceId),
          eq(platformDraft.mediaBrandId, brandId),
        ),
      );
    const rankBase = rankRow?.value ?? 0;
    const laneBase = laneRow?.value ?? 0;
    await tx.insert(promoIdea).values(
      fixtureRows.map((fixture) => ({
        angle: contentSentinel,
        analysisModelUnitId: modelUnit.id,
        description: contentSentinel,
        id: fixture.promoIdeaId,
        rank: rankBase + fixture.sortOffset,
        title: contentSentinel,
        workspaceId: input.actorWorkspaceId,
      })),
    );
    await tx.insert(platformDraft).values(
      fixtureRows.map((fixture) => ({
        id: fixture.draftId,
        lanePosition: laneBase + fixture.sortOffset,
        mediaBrandId: brandId,
        platform: fixture.destination.platform,
        promoIdeaId: fixture.promoIdeaId,
        workspaceId: input.actorWorkspaceId,
      })),
    );
    await tx.insert(draftRevision).values(
      fixtureRows.map((fixture) => ({
        authoredBy: author.id,
        body: `Provider compatibility proof ${contentSentinel}`,
        contentLocale: "en" as const,
        hashtags: ["#providerproof"],
        headline: "Provider compatibility proof",
        id: fixture.revisionId,
        originatingCopyVariantId: originatingVariant.id,
        platformDraftId: fixture.draftId,
        revisionNumber: 1,
        selectedFinalMediaAssetId: fixture.mediaAssetId,
        workspaceId: input.actorWorkspaceId,
      })),
    );
    for (const fixture of fixtureRows) {
      await tx
        .update(platformDraft)
        .set({ activeRevisionId: fixture.revisionId, revisionVersion: 1 })
        .where(eq(platformDraft.id, fixture.draftId));
    }
  });

  const fixtures: BoundFixture[] = [];
  for (const fixture of fixtureRows) {
    const approvalResult = await grantApproval(
      input.db,
      input.actorWorkspaceId,
      {
        actorId: author.id,
        draftRevisionId: fixture.revisionId,
        expectedRevisionVersion: 1,
        idempotencyKey: `bound-approval:${input.batchId}:${fixture.shape}`,
        requestHash: `bound-approval:${input.batchId}:${fixture.shape}`,
        selectedFinalMediaAssetId: fixture.mediaAssetId,
      },
    );
    assert.ok("approval" in approvalResult, "BOUND_APPROVAL_REJECTED");
    const destinationRow = destinationRows.find(
      (candidate) => candidate.key === fixture.destination.key,
    );
    assert.ok(destinationRow, "BOUND_DESTINATION_ROW_MISSING");
    const admission = await admitDirectPublication(
      input.db,
      input.actorWorkspaceId,
      {
        actorId: author.id,
        approvalId: approvalResult.approval.id,
        expectedRevisionVersion: 1,
        destinationAccountId: destinationRow.id,
        idempotencyKey: `bound-publish:${input.batchId}:${fixture.shape}`,
        requestHash: `bound-publish:${input.batchId}:${fixture.shape}`,
        requestId: null,
      },
    );
    assert.ok("operationId" in admission, "BOUND_ADMISSION_REJECTED");
    fixtures.push({
      actorId: author.id,
      attemptId: null,
      destination: fixture.destination,
      operationLifecycle: "queued",
      operationId: admission.operationId,
      operationVersion: null,
      platform: fixture.destination.platform as "telegram" | "x",
      publicationId: admission.publication.id,
      request: publishRequestSchema.parse({
        operationId: admission.operationId,
        publicationId: admission.publication.id,
        workspaceId: input.actorWorkspaceId,
      }),
      shape: fixture.shape,
    });
  }
  return { contentSentinel, fixtures };
}

async function executeBoundFixture(input: {
  claimedBy: string;
  db: Executor;
  destination: TemplateDestination;
  fetch: typeof fetch;
  fixture: BoundFixture;
  readMedia(objectKey: string): Promise<Uint8Array>;
}) {
  const now = new Date();
  const claim = await claimPublicationExecution(
    input.db,
    input.fixture.request.workspaceId,
    {
      claimedBy: input.claimedBy,
      leaseExpiresAt: new Date(now.getTime() + 15 * 60_000),
      now,
      operationId: input.fixture.operationId,
      publicationId: input.fixture.publicationId,
    },
  );
  assert.equal(claim.status, "claimed", "BOUND_EFFECT_CLAIM_REJECTED");
  let claimVersion = claim.operation.version;
  const runtime: PublisherRuntime = {
    beginAttempt: async () => {
      const attempt = await beginOrResumePublicationAttempt(
        input.db,
        input.fixture.request.workspaceId,
        {
          claimedBy: input.claimedBy,
          now: new Date(),
          operationId: input.fixture.operationId,
        },
      );
      assert.ok(attempt, "BOUND_ATTEMPT_REJECTED");
      return attempt;
    },
    claimFinalEffect: async (attemptId) => {
      const claimed = await claimPublicationFinalEffect(
        input.db,
        input.fixture.request.workspaceId,
        {
          attemptId,
          claimedBy: input.claimedBy,
          operationId: input.fixture.operationId,
        },
      );
      assert.notEqual(claimed.status, "not_found", "BOUND_EFFECT_CLAIM_LOST");
      return claimed.status === "claimed";
    },
    existingCheckpoint: async (_request, kind) => {
      const context = await loadPublicationExecutionContext(
        input.db,
        input.fixture.request.workspaceId,
        input.fixture.operationId,
      );
      const checkpoint = context?.checkpoints.find(
        (entry) => entry.kind === kind,
      );
      return checkpoint
        ? providerCheckpointSchema.parse({
            kind: checkpoint.kind,
            providerReferenceId: checkpoint.providerReferenceId,
          })
        : null;
    },
    readMedia: input.readMedia,
    renewLease: async () => {
      const renewed = await import(
        "@rz-chain-reporter/db/repositories/publication"
      ).then(({ renewPublicationExecutionLease }) =>
        renewPublicationExecutionLease(
          input.db,
          input.fixture.request.workspaceId,
          {
            claimedBy: input.claimedBy,
            expectedVersion: claimVersion,
            leaseExpiresAt: new Date(Date.now() + 15 * 60_000),
            now: new Date(),
            operationId: input.fixture.operationId,
          },
        ),
      );
      assert.ok(renewed, "BOUND_LEASE_LOST");
      claimVersion = renewed.version;
    },
    run: async (_name, effect) => {
      await reassertBoundContext(input);
      return effect();
    },
    sleep: async () => {
      throw new Error("BOUND_SLEEP_FORBIDDEN");
    },
    withMaterial: async (_name, effect) => {
      const context = await reassertBoundContext(input);
      return effect(
        publishMaterialSchema.parse({
          contentLocale: context.draft.contentLocale,
          destinationKey: context.destination.key,
          draft: {
            body: context.draft.body,
            hashtags: context.draft.hashtags,
            headline: context.draft.headline,
          },
          media: context.media
            ? {
                actualBytes: context.media.actualBytes,
                mimeType: context.media.mimeType,
                objectKey: context.media.objectKey,
              }
            : null,
          platform: context.publishOperation.platform,
          source: null,
        }),
      );
    },
  };
  const publisher = createPublisher({
    acceptInstagramGrant: async () => {
      throw new Error("INSTAGRAM_CALL_FORBIDDEN");
    },
    destination: input.destination,
    fetch: input.fetch,
    issueInstagramGrant: async () => {
      throw new Error("INSTAGRAM_CALL_FORBIDDEN");
    },
    request: input.fixture.request,
    runtime,
    runtimeEnv: process.env,
  });
  const prepared = await publisher.prepare(input.fixture.request);
  if (prepared.status === "failed") {
    const status = await settleBoundFailure(
      input,
      claimVersion,
      prepared.attemptId,
      prepared.failure,
    );
    return { checkpointKinds: [], status };
  }
  const checkpointKinds: string[] = [];
  for (const checkpoint of prepared.prepared.checkpoints) {
    const recorded = await recordPublicationCheckpoint(
      input.db,
      input.fixture.request.workspaceId,
      {
        attemptId: prepared.prepared.attempt.id,
        kind: checkpoint.kind,
        operationId: input.fixture.operationId,
        platform: publisher.platform,
        providerReferenceId: checkpoint.providerReferenceId,
        publicationId: input.fixture.publicationId,
      },
    );
    assert.notEqual(recorded.status, "mismatch", "BOUND_CHECKPOINT_MISMATCH");
    checkpointKinds.push(checkpoint.kind);
  }
  const result = await publisher.publish(prepared.prepared);
  if (result.status === "failed") {
    const status = await settleBoundFailure(
      input,
      claimVersion,
      result.attemptId,
      result.failure,
    );
    return { checkpointKinds, status };
  }
  if (
    (publisher.platform === "telegram" &&
      result.checkpoint.kind !== "telegram_message") ||
    (publisher.platform === "x" && result.checkpoint.kind !== "x_post")
  ) {
    throw new Error("BOUND_CHECKPOINT_MISMATCH");
  }
  const confirmed = await settlePublicationExecution(
    input.db,
    input.fixture.request.workspaceId,
    {
      attemptId: result.attemptId,
      checkpoint: {
        kind: result.checkpoint.kind as "telegram_message" | "x_post",
        platform: publisher.platform as "telegram" | "x",
        providerReferenceId: result.checkpoint.providerReferenceId,
      },
      claimedBy: input.claimedBy,
      expectedOperationVersion: claimVersion,
      operationId: input.fixture.operationId,
      outcome: "confirmed",
      providerResultId: result.providerResultId,
      publicationId: input.fixture.publicationId,
    },
  );
  assert.ok(confirmed, "BOUND_CONFIRMATION_LOST");
  const occurredAt = new Date();
  await recordPublicationSettlementActivity(
    input.db,
    input.fixture.request.workspaceId,
    {
      actorId: input.fixture.actorId,
      eventType: "publication.confirmed",
      idempotencyKey: `bound-confirmed:${input.fixture.operationId}`,
      operationId: input.fixture.operationId,
      publicationId: input.fixture.publicationId,
      requestHash: `bound-confirmed:${input.fixture.operationId}`,
      occurredAt,
    },
  );
  checkpointKinds.push(result.checkpoint.kind);
  return {
    checkpointKinds,
    providerResultId: result.providerResultId,
    status: "confirmed" as const,
  };
}

async function settleBoundFailure(
  input: {
    claimedBy: string;
    db: Executor;
    fixture: BoundFixture;
  },
  claimVersion: number,
  attemptId: string | null,
  failure: ProviderFailure,
) {
  if (attemptId && failure.certainty === "delivery_unknown") {
    const publicationResult = await settlePublicationExecution(
      input.db,
      input.fixture.request.workspaceId,
      {
        attemptId,
        claimedBy: input.claimedBy,
        expectedOperationVersion: claimVersion,
        failureCode: failure.code,
        operationId: input.fixture.operationId,
        outcome: "delivery_unknown",
        publicationId: input.fixture.publicationId,
      },
    );
    assert.ok(publicationResult, "BOUND_UNKNOWN_SETTLEMENT_LOST");
    await recordBoundSettlementActivity(input, "publication.delivery_unknown");
    return "delivery_unknown" as const;
  }

  const publicationResult = await settlePublicationExecution(
    input.db,
    input.fixture.request.workspaceId,
    {
      attemptId,
      claimedBy: input.claimedBy,
      expectedOperationVersion: claimVersion,
      failureCode: failure.code,
      operationId: input.fixture.operationId,
      outcome: "definite_failure",
      publicationId: input.fixture.publicationId,
    },
  );
  assert.ok(publicationResult, "BOUND_FAILURE_SETTLEMENT_LOST");
  await recordBoundSettlementActivity(input, "publication.failed");
  return "definite_failure" as const;
}

async function recordBoundSettlementActivity(
  input: { db: Executor; fixture: BoundFixture },
  eventType: "publication.delivery_unknown" | "publication.failed",
) {
  const occurredAt = new Date();
  await recordPublicationSettlementActivity(
    input.db,
    input.fixture.request.workspaceId,
    {
      actorId: input.fixture.actorId,
      eventType,
      idempotencyKey: `bound-${eventType}:${input.fixture.operationId}`,
      operationId: input.fixture.operationId,
      publicationId: input.fixture.publicationId,
      requestHash: `bound-${eventType}:${input.fixture.operationId}`,
      occurredAt,
    },
  );
}

async function reassertBoundContext(input: {
  claimedBy: string;
  db: Executor;
  destination: TemplateDestination;
  fixture: BoundFixture;
}) {
  resolveDestinationCredential(input.destination, process.env);
  const asserted = await reassertPublicationExecution(
    input.db,
    input.fixture.request.workspaceId,
    {
      claimedBy: input.claimedBy,
      now: new Date(),
      operationId: input.fixture.operationId,
    },
  );
  assert.equal(asserted.status, "ready", "BOUND_REASSERTION_FAILED");
  if (asserted.status !== "ready") throw new Error("BOUND_REASSERTION_FAILED");
  return asserted.context;
}

function credentialValues(credential: DestinationCredential) {
  switch (credential.platform) {
    case "telegram":
      return [credential.botToken];
    case "x":
      return [
        credential.accessToken,
        credential.accessTokenSecret,
        credential.applicationKey,
        credential.applicationSecret,
      ];
    case "instagram":
      return [credential.systemUserAccessToken];
  }
}

async function inspectBoundDatabase(
  db: Executor,
  workspaceId: string,
  results: readonly {
    checkpointKinds: string[];
    operationId: string;
    publicationId: string;
    shape: BoundShape;
    status: "confirmed" | "definite_failure" | "delivery_unknown";
  }[],
  contentSentinel: string,
  credentials: readonly DestinationCredential[],
) {
  const operationIds = results.map((result) => result.operationId);
  const publicationIds = results.map((result) => result.publicationId);
  const [
    operations,
    attempts,
    publications,
    schedules,
    checkpoints,
    activities,
    reconciliations,
    outbox,
  ] = await Promise.all([
    db.select().from(operation).where(inArray(operation.id, operationIds)),
    db
      .select()
      .from(operationAttempt)
      .where(inArray(operationAttempt.operationId, operationIds)),
    db
      .select()
      .from(publication)
      .where(inArray(publication.id, publicationIds)),
    db
      .select()
      .from(schedule)
      .where(inArray(schedule.publicationId, publicationIds)),
    db
      .select()
      .from(publishCheckpoint)
      .where(inArray(publishCheckpoint.operationId, operationIds)),
    db
      .select()
      .from(activityEvent)
      .where(
        and(
          eq(activityEvent.workspaceId, workspaceId),
          inArray(activityEvent.operationId, operationIds),
        ),
      ),
    db
      .select()
      .from(publicationReconciliation)
      .where(inArray(publicationReconciliation.publicationId, publicationIds)),
    db
      .select()
      .from(outboxEvent)
      .where(inArray(outboxEvent.operationId, operationIds)),
  ]);
  const operationalJson = JSON.stringify({
    activities,
    attempts,
    checkpoints,
    operations,
    outbox,
    publications,
    reconciliations,
    schedules,
  });
  const forbidden = [
    contentSentinel,
    ...credentials.flatMap(credentialValues),
  ].filter((value) => value.length > 0);
  assert.equal(
    forbidden.some((value) => operationalJson.includes(value)),
    false,
    "BOUND_OPERATIONAL_LEAKAGE",
  );
  assert.equal(operations.length, 4, "BOUND_OPERATION_ROWS_INVALID");
  assert.equal(attempts.length, 4, "BOUND_ATTEMPT_ROWS_INVALID");
  assert.equal(publications.length, 4, "BOUND_PUBLICATION_ROWS_INVALID");
  const expectedCheckpoints = results.reduce(
    (total, result) => total + result.checkpointKinds.length,
    0,
  );
  assert.equal(
    checkpoints.length,
    expectedCheckpoints,
    "BOUND_CHECKPOINT_ROWS_INVALID",
  );
  assert.equal(activities.length, 8, "BOUND_ACTIVITY_ROWS_INVALID");
  assert.equal(schedules.length, 0, "BOUND_SCHEDULE_ROWS_INVALID");
  assert.equal(reconciliations.length, 0, "BOUND_RECONCILIATION_ROWS_INVALID");
  return {
    activityRows: activities.length,
    attemptRows: attempts.length,
    checkpointRows: checkpoints.length,
    operationalForbiddenMatches: 0,
    operationRows: operations.length,
    publicationRows: publications.length,
    reconciliationRows: reconciliations.length,
    scheduleRows: schedules.length,
  };
}

async function runZeroKey() {
  assert.deepEqual(
    publishingEffectInputSchema.parse({
      _inngest: { correlation_id: "opaque-platform-metadata" },
      claimedBy: "publishing:probe",
      claimVersion: 1,
      operationId: OPERATION_ID,
      publicationId: PUBLICATION_ID,
      workspaceId: WORKSPACE_ID,
    }),
    {
      claimedBy: "publishing:probe",
      claimVersion: 1,
      operationId: OPERATION_ID,
      publicationId: PUBLICATION_ID,
      workspaceId: WORKSPACE_ID,
    },
  );
  assert.equal(
    publishingEffectInputSchema.safeParse({
      claimVerison: 1,
      claimedBy: "publishing:probe",
      claimVersion: 1,
      operationId: OPERATION_ID,
      publicationId: PUBLICATION_ID,
      workspaceId: WORKSPACE_ID,
    }).success,
    false,
  );
  assert.equal(
    publishRequestSchema.safeParse({ ...request, accessToken: "secret" })
      .success,
    false,
  );
  assert.equal(
    providerFailureSchema.safeParse({
      class: "auth",
      effectScope: "publication",
      certainty: "definite",
      next: "operator_repair",
      code: "AUTH_FAILED",
      providerBody: "forbidden",
    }).success,
    false,
  );

  assert.equal(
    providerRequestTimeoutMs({
      body: JSON.stringify({ text: "ok" }),
      method: "POST",
    }),
    PROVIDER_REQUEST_TIMEOUT_MS,
  );
  assert.equal(
    providerRequestTimeoutMs({ body: new FormData(), method: "POST" }),
    PROVIDER_MEDIA_UPLOAD_TIMEOUT_MS,
  );
  assert.equal(providerRequestTimeoutMs(), PROVIDER_REQUEST_TIMEOUT_MS);

  const png = await fixturePng();
  const jpeg = await publishRasterForUpload(png, "image/png");
  assert.equal(jpeg?.mimeType, "image/jpeg");
  if (!jpeg) throw new Error("JPEG_DERIVATIVE_MISSING");
  assert.ok(jpeg.bytes.byteLength > 0);
  const passedThrough = await publishRasterForUpload(jpeg.bytes, "image/jpeg");
  assert.equal(passedThrough?.bytes, jpeg.bytes);
  assert.equal(await publishRasterForUpload(png, "image/gif"), null);
  const webp = await sharp(png).webp().toBuffer();
  const fromWebp = await publishRasterForUpload(
    new Uint8Array(webp.buffer, webp.byteOffset, webp.byteLength),
    "image/webp",
  );
  assert.equal(fromWebp?.mimeType, "image/jpeg");

  const photoMaterial: PublishMaterial = {
    ...baseMaterial,
    media: {
      actualBytes: png.byteLength,
      mimeType: "image/png",
      objectKey: "fixture.png",
    },
  };

  const textCalls: string[] = [];
  const textRuntime = fakeRuntime(baseMaterial);
  const telegramText = createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch(
      [jsonResponse({ ok: true, result: { message_id: 41, text: "ignored" } })],
      textCalls,
    ),
    runtime: textRuntime.runtime,
  });
  const textPrepared = await telegramText.prepare(request);
  assert.equal(textPrepared.status, "prepared");
  if (textPrepared.status !== "prepared")
    throw new Error("TEXT_PREPARE_FAILED");
  const textResult = await telegramText.publish(textPrepared.prepared);
  assert.equal(textResult.status, "confirmed");
  assert.equal(textCalls.length, 1);

  const deadlineSignals: (AbortSignal | null)[] = [];
  const deadlineTimeouts: number[] = [];
  const redirectPolicies: (RequestInit["redirect"] | undefined)[] = [];
  const deadlineRuntime = fakeRuntime(baseMaterial);
  const deadlinePublisher = createPublisher({
    acceptInstagramGrant: async () => undefined,
    destination: {
      enabled: true,
      key: "deadline",
      metadata: { channel: "@fixture", label: "Deadline" },
      platform: "telegram",
    },
    fetch: (async (_resource, init) => {
      deadlineSignals.push(init?.signal ?? null);
      deadlineTimeouts.push(providerRequestTimeoutMs(init));
      redirectPolicies.push(init?.redirect);
      return jsonResponse({ ok: true, result: { message_id: 43 } });
    }) as typeof fetch,
    issueInstagramGrant: async () => ({ id: "forbidden" }),
    request,
    runtime: deadlineRuntime.runtime,
    runtimeEnv: { DEST_DEADLINE_BOT_TOKEN: "local-fixture" },
  });
  const deadlinePrepared = await deadlinePublisher.prepare(request);
  if (deadlinePrepared.status !== "prepared") {
    throw new Error("DEADLINE_PREPARE_FAILED");
  }
  await deadlinePublisher.publish(deadlinePrepared.prepared);
  assert.equal(deadlineSignals.length, 1);
  assert.equal(deadlineSignals[0]?.aborted, false);
  assert.deepEqual(deadlineTimeouts, [PROVIDER_REQUEST_TIMEOUT_MS]);
  assert.deepEqual(redirectPolicies, ["error"]);

  const photoDeadlineTimeouts: number[] = [];
  const photoDeadlineTypes: (string | null)[] = [];
  const photoDeadlineRuntime = fakeRuntime(photoMaterial);
  const photoDeadlinePublisher = createPublisher({
    acceptInstagramGrant: async () => undefined,
    destination: {
      enabled: true,
      key: "deadline-photo",
      metadata: { channel: "@fixture", label: "Deadline photo" },
      platform: "telegram",
    },
    fetch: (async (_resource, init) => {
      photoDeadlineTimeouts.push(providerRequestTimeoutMs(init));
      photoDeadlineTypes.push(formFieldType(init?.body, "photo"));
      return jsonResponse({ ok: true, result: { message_id: 46 } });
    }) as typeof fetch,
    issueInstagramGrant: async () => ({ id: "forbidden" }),
    request,
    runtime: photoDeadlineRuntime.runtime,
    runtimeEnv: { DEST_DEADLINE_PHOTO_BOT_TOKEN: "local-fixture" },
  });
  const photoDeadlinePrepared = await photoDeadlinePublisher.prepare(request);
  if (photoDeadlinePrepared.status !== "prepared") {
    throw new Error("PHOTO_DEADLINE_PREPARE_FAILED");
  }
  assert.equal(
    (await photoDeadlinePublisher.publish(photoDeadlinePrepared.prepared))
      .status,
    "confirmed",
  );
  assert.deepEqual(photoDeadlineTimeouts, [PROVIDER_MEDIA_UPLOAD_TIMEOUT_MS]);
  assert.deepEqual(photoDeadlineTypes, ["image/jpeg"]);

  const xDeadlineTimeouts: number[] = [];
  const xDeadlineTypes: (string | null)[] = [];
  const xDeadlineRuntime = fakeRuntime({
    ...photoMaterial,
    platform: "x",
    source: null,
  });
  const xDeadlinePublisher = createPublisher({
    acceptInstagramGrant: async () => undefined,
    destination: {
      enabled: true,
      key: "deadline-x",
      metadata: { label: "Deadline X" },
      platform: "x",
    },
    fetch: (async (resource, init) => {
      xDeadlineTimeouts.push(providerRequestTimeoutMs(init));
      xDeadlineTypes.push(formFieldType(init?.body, "media"));
      return String(resource).includes("/1.1/media/upload.json")
        ? jsonResponse({ media_id_string: "media-deadline" })
        : jsonResponse({ data: { id: "post-deadline" } });
    }) as typeof fetch,
    issueInstagramGrant: async () => ({ id: "forbidden" }),
    request,
    runtime: xDeadlineRuntime.runtime,
    runtimeEnv: {
      DEST_DEADLINE_X_ACCESS_TOKEN: "token",
      DEST_DEADLINE_X_ACCESS_TOKEN_SECRET: "token-secret",
      X_API_KEY: "key",
      X_API_SECRET: "secret",
    },
  });
  const xDeadlinePrepared = await xDeadlinePublisher.prepare(request);
  if (xDeadlinePrepared.status !== "prepared") {
    throw new Error("X_DEADLINE_PREPARE_FAILED");
  }
  assert.equal(
    (await xDeadlinePublisher.publish(xDeadlinePrepared.prepared)).status,
    "confirmed",
  );
  assert.deepEqual(xDeadlineTimeouts, [
    PROVIDER_MEDIA_UPLOAD_TIMEOUT_MS,
    PROVIDER_REQUEST_TIMEOUT_MS,
  ]);
  assert.deepEqual(xDeadlineTypes, ["image/jpeg", null]);

  const oversizedRuntime = fakeRuntime(baseMaterial);
  const oversizedPublisher = createPublisher({
    acceptInstagramGrant: async () => undefined,
    destination: {
      enabled: true,
      key: "bounded-response",
      metadata: { channel: "@fixture", label: "Bounded response" },
      platform: "telegram",
    },
    fetch: (async () =>
      new Response("{}", {
        headers: {
          "content-length": String(PROVIDER_RESPONSE_MAX_BYTES + 1),
          "content-type": "application/json",
        },
      })) as typeof fetch,
    issueInstagramGrant: async () => ({ id: "forbidden" }),
    request,
    runtime: oversizedRuntime.runtime,
    runtimeEnv: { DEST_BOUNDED_RESPONSE_BOT_TOKEN: "local-fixture" },
  });
  const oversizedPrepared = await oversizedPublisher.prepare(request);
  if (oversizedPrepared.status !== "prepared") {
    throw new Error("OVERSIZED_RESPONSE_PREPARE_FAILED");
  }
  const oversizedResult = await oversizedPublisher.publish(
    oversizedPrepared.prepared,
  );
  assert.equal(oversizedResult.status, "failed");
  if (oversizedResult.status !== "failed") {
    throw new Error("OVERSIZED_RESPONSE_RESULT_INVALID");
  }
  assert.equal(oversizedResult.failure.class, "provider");

  const resumedTelegramCalls: string[] = [];
  const resumedTelegramRuntime = fakeRuntime(baseMaterial, {}, true);
  const resumedTelegram = createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch(
      [jsonResponse({ ok: true, result: { message_id: 45 } })],
      resumedTelegramCalls,
    ),
    runtime: resumedTelegramRuntime.runtime,
  });
  const resumedTelegramPrepared = await resumedTelegram.prepare(request);
  if (resumedTelegramPrepared.status !== "prepared") {
    throw new Error("RESUMED_TELEGRAM_PREPARE_FAILED");
  }
  const resumedTelegramResult = await resumedTelegram.publish(
    resumedTelegramPrepared.prepared,
  );
  assert.equal(resumedTelegramResult.status, "confirmed");
  assert.equal(resumedTelegramCalls.length, 1);

  const lostStepOutputCalls: string[] = [];
  const lostStepOutputBase = fakeRuntime(baseMaterial);
  let lostStepOutputClaimed = false;
  let lostStepOutputClaims = 0;
  const lostStepOutputRuntime: PublisherRuntime = {
    ...lostStepOutputBase.runtime,
    claimFinalEffect: async () => {
      lostStepOutputClaims += 1;
      if (lostStepOutputClaimed) return false;
      lostStepOutputClaimed = true;
      return true;
    },
    withMaterial: async (name, effect) => {
      if (name !== "telegram-final-effect") return effect(baseMaterial);
      await effect(baseMaterial);
      return effect(baseMaterial);
    },
  };
  const lostStepOutputTelegram = createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch(
      [jsonResponse({ ok: true, result: { message_id: 44 } })],
      lostStepOutputCalls,
    ),
    runtime: lostStepOutputRuntime,
  });
  const lostStepOutputPrepared = await lostStepOutputTelegram.prepare(request);
  if (lostStepOutputPrepared.status !== "prepared") {
    throw new Error("LOST_STEP_OUTPUT_PREPARE_FAILED");
  }
  const lostStepOutputResult = await lostStepOutputTelegram.publish(
    lostStepOutputPrepared.prepared,
  );
  assert.equal(lostStepOutputResult.status, "failed");
  if (lostStepOutputResult.status !== "failed") {
    throw new Error("LOST_STEP_OUTPUT_RESULT_INVALID");
  }
  assert.equal(lostStepOutputResult.failure.certainty, "delivery_unknown");
  assert.equal(lostStepOutputCalls.length, 1);
  assert.equal(lostStepOutputClaims, 2);

  const photoCalls: string[] = [];
  const photoInits: RequestInit[] = [];
  const photoRuntime = fakeRuntime(photoMaterial);
  const telegramPhoto = createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch(
      [jsonResponse({ ok: true, result: { message_id: 42 } })],
      photoCalls,
      photoInits,
    ),
    runtime: photoRuntime.runtime,
  });
  const photoPrepared = await telegramPhoto.prepare(request);
  assert.equal(photoPrepared.status, "prepared");
  if (photoPrepared.status !== "prepared")
    throw new Error("PHOTO_PREPARE_FAILED");
  assert.equal(photoPrepared.prepared.platform, "telegram");
  if (photoPrepared.prepared.platform !== "telegram")
    throw new Error("PLATFORM");
  assert.equal(photoPrepared.prepared.method, "sendPhoto");
  assert.equal(
    (await telegramPhoto.publish(photoPrepared.prepared)).status,
    "confirmed",
  );
  assert.equal(formFieldType(photoInits[0]?.body, "photo"), "image/jpeg");

  const overflowRuntime = fakeRuntime({
    ...baseMaterial,
    draft: { ...baseMaterial.draft, body: "x".repeat(5_000) },
  });
  const overflow = await createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch([], []),
    runtime: overflowRuntime.runtime,
  }).prepare(request);
  assert.equal(overflow.status, "failed");
  assert.equal(overflowRuntime.attempts, 0);

  const lostRuntime = fakeRuntime(baseMaterial);
  const lost = createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch([jsonResponse({ description: "gateway" }, 504)], []),
    runtime: lostRuntime.runtime,
  });
  const lostPrepared = await lost.prepare(request);
  if (lostPrepared.status !== "prepared")
    throw new Error("LOST_PREPARE_FAILED");
  const lostResult = await lost.publish(lostPrepared.prepared);
  assert.equal(lostResult.status, "failed");
  if (lostResult.status !== "failed") throw new Error("LOST_RESULT_INVALID");
  assert.equal(lostResult.failure.certainty, "delivery_unknown");
  assert.equal(lostResult.failure.next, "reconcile_first");
  assert.equal(lostRuntime.attempts, 1);

  const timeoutAfterClaimCalls: string[] = [];
  let timeoutAfterClaimClaims = 0;
  const timeoutAfterClaimBase = fakeRuntime(photoMaterial);
  const timeoutAfterClaim = createTelegramPublisher({
    credential: { botToken: "local-fixture", channel: "@fixture" },
    fetch: fakeFetch(
      [
        new DOMException(
          "The operation was aborted due to timeout",
          "TimeoutError",
        ),
      ],
      timeoutAfterClaimCalls,
    ),
    runtime: {
      ...timeoutAfterClaimBase.runtime,
      claimFinalEffect: async () => {
        timeoutAfterClaimClaims += 1;
        return true;
      },
    },
  });
  const timeoutAfterClaimPrepared = await timeoutAfterClaim.prepare(request);
  if (timeoutAfterClaimPrepared.status !== "prepared") {
    throw new Error("TIMEOUT_AFTER_CLAIM_PREPARE_FAILED");
  }
  const timeoutAfterClaimResult = await timeoutAfterClaim.publish(
    timeoutAfterClaimPrepared.prepared,
  );
  assert.equal(timeoutAfterClaimResult.status, "failed");
  if (timeoutAfterClaimResult.status !== "failed") {
    throw new Error("TIMEOUT_AFTER_CLAIM_RESULT_INVALID");
  }
  assert.equal(timeoutAfterClaimResult.failure.certainty, "delivery_unknown");
  assert.equal(timeoutAfterClaimResult.failure.class, "timeout");
  assert.equal(timeoutAfterClaimResult.failure.next, "reconcile_first");
  assert.equal(timeoutAfterClaimCalls.length, 1);
  assert.equal(timeoutAfterClaimClaims, 1);

  assert.equal(classifyXFailure(401, "publication").class, "auth");
  assert.equal(classifyXFailure(402, "publication").certainty, "definite");
  assert.equal(
    classifyXFailure(402, "publication").code,
    "X_CAPABILITY_UNAVAILABLE",
  );
  assert.equal(classifyXFailure(404, "publication").certainty, "definite");
  assert.equal(classifyXFailure(404, "publication").code, "X_REQUEST_INVALID");
  assert.equal(classifyXFailure(404, "preparation").certainty, "definite");
  assert.equal(classifyXFailure(404, "preparation").next, "operator_repair");
  assert.equal(classifyXFailure(429, "publication").class, "rate");
  assert.equal(
    classifyXFailure(504, "publication").certainty,
    "delivery_unknown",
  );
  assert.match(
    oauthAuthorization(
      "POST",
      "https://api.x.com/2/tweets",
      {
        accessToken: "token",
        accessTokenSecret: "token-secret",
        applicationKey: "key",
        applicationSecret: "secret",
      },
      "nonce",
      1_700_000_000,
    ),
    /^OAuth /u,
  );

  const xCalls: string[] = [];
  const xInits: RequestInit[] = [];
  const xRuntime = fakeRuntime({
    ...photoMaterial,
    platform: "x",
    source: null,
  });
  const xPublisher = createXPublisher({
    credential: {
      accessToken: "token",
      accessTokenSecret: "token-secret",
      applicationKey: "key",
      applicationSecret: "secret",
    },
    fetch: fakeFetch(
      [
        jsonResponse({ media_id_string: "media-1" }),
        jsonResponse({ data: { id: "post-1" } }),
      ],
      xCalls,
      xInits,
    ),
    nonce: () => "nonce",
    nowSeconds: () => 1_700_000_000,
    request,
    runtime: xRuntime.runtime,
  });
  const xPrepared = await xPublisher.prepare(request);
  if (xPrepared.status !== "prepared") throw new Error("X_PREPARE_FAILED");
  assert.deepEqual(xPrepared.prepared.checkpoints, [
    { kind: "x_media", providerReferenceId: "media-1" },
  ]);
  const xResult = await xPublisher.publish(xPrepared.prepared);
  assert.equal(xResult.status, "confirmed");
  assert.equal(xCalls.length, 2);
  assert.equal(formFieldType(xInits[0]?.body, "media"), "image/jpeg");
  assert.equal(formFieldType(xInits[1]?.body, "media"), null);
  const resumedXCalls: string[] = [];
  const resumedXRuntime = fakeRuntime(
    { ...baseMaterial, platform: "x", source: null },
    { x_media: "media-resumed" },
    true,
  );
  const resumedX = createXPublisher({
    credential: {
      accessToken: "token",
      accessTokenSecret: "token-secret",
      applicationKey: "key",
      applicationSecret: "secret",
    },
    fetch: fakeFetch(
      [jsonResponse({ data: { id: "post-resumed" } })],
      resumedXCalls,
    ),
    request,
    runtime: resumedXRuntime.runtime,
  });
  const resumedXPrepared = await resumedX.prepare(request);
  if (resumedXPrepared.status !== "prepared") {
    throw new Error("RESUMED_X_PREPARE_FAILED");
  }
  assert.deepEqual(resumedXPrepared.prepared.checkpoints, [
    { kind: "x_media", providerReferenceId: "media-resumed" },
  ]);
  assert.equal(
    (await resumedX.publish(resumedXPrepared.prepared)).status,
    "confirmed",
  );
  assert.equal(resumedXCalls.length, 1);
  const terminalXRate = classifyXFailure(429, "preparation", 5);
  assert.equal(terminalXRate.next, "operator_repair");
  assert.equal(terminalXRate.retryAt, undefined);
  assert.equal(
    exactRecentTimelineCandidate(
      "same",
      [
        { createdAt: "2026-08-27T10:00:00.000Z", id: "1", text: "same" },
        { createdAt: "2026-08-27T09:59:58.000Z", id: "2", text: "same" },
      ],
      new Date("2026-08-27T09:59:59.000Z"),
    ),
    "1",
  );
  assert.equal(
    exactRecentTimelineCandidate(
      "same",
      [{ createdAt: "2026-08-27T09:59:58.000Z", id: "1", text: "same" }],
      new Date("2026-08-27T09:59:59.000Z"),
    ),
    null,
  );
  assert.equal(
    exactRecentTimelineCandidate(
      "same",
      [
        { createdAt: "2026-08-27T10:00:00.000Z", id: "1", text: "same" },
        { createdAt: "2026-08-27T10:00:01.000Z", id: "2", text: "same" },
      ],
      new Date("2026-08-27T09:59:59.000Z"),
    ),
    null,
  );
  assert.equal(
    exactRecentTimelineCandidate(
      "same",
      [
        { createdAt: null, id: "1", text: "same" },
        {
          createdAt: "2026-08-27T10:00:00.000Z",
          id: "2",
          text: "different",
        },
      ],
      new Date("2026-08-27T09:59:59.000Z"),
    ),
    null,
  );

  const reconciliationMaterial = {
    ...baseMaterial,
    platform: "x" as const,
    source: null,
  };
  const failedReconciliationCalls: string[] = [];
  const failedReconciliation = createXPublisher({
    credential: {
      accessToken: "token",
      accessTokenSecret: "token-secret",
      applicationKey: "key",
      applicationSecret: "secret",
    },
    fetch: fakeFetch([jsonResponse({}, 401)], failedReconciliationCalls),
    reconciliationReference: {
      notBefore: new Date("2026-08-27T09:59:59.000Z"),
    },
    request,
    runtime: fakeRuntime(reconciliationMaterial).runtime,
  });
  const failedReconciliationResult = await failedReconciliation.reconcile(null);
  assert.equal(failedReconciliationResult.status, "failed");
  if (failedReconciliationResult.status !== "failed") {
    throw new Error("FAILED_RECONCILIATION_RESULT_INVALID");
  }
  assert.equal(failedReconciliationResult.failure.class, "auth");
  assert.equal(failedReconciliationResult.failure.code, "X_AUTH_FAILED");
  assert.equal(failedReconciliationCalls.length, 1);

  const rejectedReconciliation = createXPublisher({
    credential: {
      accessToken: "token",
      accessTokenSecret: "token-secret",
      applicationKey: "key",
      applicationSecret: "secret",
    },
    fetch: fakeFetch([jsonResponse({}, 404)], []),
    reconciliationReference: {
      notBefore: new Date("2026-08-27T09:59:59.000Z"),
    },
    request,
    runtime: fakeRuntime(reconciliationMaterial).runtime,
  });
  const rejectedReconciliationResult =
    await rejectedReconciliation.reconcile(null);
  assert.equal(rejectedReconciliationResult.status, "failed");
  if (rejectedReconciliationResult.status !== "failed") {
    throw new Error("REJECTED_RECONCILIATION_RESULT_INVALID");
  }
  assert.equal(rejectedReconciliationResult.failure.certainty, "definite");
  assert.equal(rejectedReconciliationResult.failure.code, "X_REQUEST_INVALID");

  const unknownReconciliationCalls: string[] = [];
  const unknownReconciliation = createXPublisher({
    credential: {
      accessToken: "token",
      accessTokenSecret: "token-secret",
      applicationKey: "key",
      applicationSecret: "secret",
    },
    fetch: fakeFetch(
      [jsonResponse({ data: { id: "account-1" } }), jsonResponse({ data: [] })],
      unknownReconciliationCalls,
    ),
    reconciliationReference: {
      notBefore: new Date("2026-08-27T09:59:59.000Z"),
    },
    request,
    runtime: fakeRuntime(reconciliationMaterial).runtime,
  });
  assert.deepEqual(await unknownReconciliation.reconcile(null), {
    status: "still_unknown",
  });
  assert.equal(unknownReconciliationCalls.length, 2);

  const instagramCalls: string[] = [];
  const instagramRuntime = fakeRuntime({
    ...baseMaterial,
    media: {
      actualBytes: 4,
      mimeType: "image/png",
      objectKey: "fixture.png",
    },
    platform: "instagram",
    source: null,
  });
  const accepted: string[] = [];
  const instagram = createInstagramPublisher({
    acceptGrant: async (id) => {
      accepted.push(id);
    },
    appUrl: "https://fixture.invalid",
    credential: {
      professionalAccountId: "account-1",
      systemUserAccessToken: "local-fixture",
    },
    fetch: fakeFetch(
      [
        jsonResponse({
          data: [{ quota_usage: 1, config: { quota_total: 100 } }],
        }),
        jsonResponse({ id: "container-1" }),
        jsonResponse({ status_code: "IN_PROGRESS" }),
        jsonResponse({ status_code: "FINISHED" }),
        jsonResponse({ id: "media-1" }),
      ],
      instagramCalls,
    ),
    issueGrant: async () => ({ id: "grant-1" }),
    request,
    runtime: instagramRuntime.runtime,
  });
  const instagramPrepared = await instagram.prepare(request);
  if (instagramPrepared.status !== "prepared") {
    throw new Error("INSTAGRAM_PREPARE_FAILED");
  }
  assert.deepEqual(instagramPrepared.prepared.checkpoints, [
    { kind: "instagram_grant", providerReferenceId: "grant-1" },
    { kind: "instagram_container", providerReferenceId: "container-1" },
  ]);
  assert.deepEqual(accepted, ["grant-1"]);
  const instagramResult = await instagram.publish(instagramPrepared.prepared);
  assert.equal(instagramResult.status, "confirmed");
  assert.equal(instagramCalls.length, 5);
  assert.ok(instagramRuntime.effects.includes("renew"));

  const malformedCapacity = createInstagramPublisher({
    acceptGrant: async () => {
      throw new Error("MALFORMED_CAPACITY_ACCEPT_FORBIDDEN");
    },
    appUrl: "https://fixture.invalid",
    credential: {
      professionalAccountId: "account-1",
      systemUserAccessToken: "local-fixture",
    },
    fetch: fakeFetch([jsonResponse({ data: [{}] })], []),
    issueGrant: async () => {
      throw new Error("MALFORMED_CAPACITY_GRANT_FORBIDDEN");
    },
    request,
    runtime: fakeRuntime({
      ...baseMaterial,
      media: {
        actualBytes: 4,
        mimeType: "image/png",
        objectKey: "fixture.png",
      },
      platform: "instagram",
      source: null,
    }).runtime,
  });
  const malformedCapacityResult = await malformedCapacity.prepare(request);
  assert.equal(malformedCapacityResult.status, "failed");
  if (malformedCapacityResult.status !== "failed") {
    throw new Error("MALFORMED_CAPACITY_RESULT_INVALID");
  }
  assert.equal(
    malformedCapacityResult.failure.code,
    "INSTAGRAM_CAPACITY_UNAVAILABLE",
  );
  assert.equal(malformedCapacityResult.failure.class, "provider");

  const resumeRuntime = fakeRuntime(
    {
      ...baseMaterial,
      media: {
        actualBytes: 4,
        mimeType: "image/png",
        objectKey: "fixture.png",
      },
      platform: "instagram",
      source: null,
    },
    { instagram_container: "container-1" },
    true,
  );
  const resumedInstagramCalls: string[] = [];
  const resumedInstagram = createInstagramPublisher({
    acceptGrant: async () => {
      throw new Error("RESUME_ACCEPT_GRANT_FORBIDDEN");
    },
    appUrl: "https://fixture.invalid",
    credential: {
      professionalAccountId: "account-1",
      systemUserAccessToken: "local-fixture",
    },
    fetch: fakeFetch(
      [
        jsonResponse({ status_code: "FINISHED" }),
        jsonResponse({ id: "media-resumed" }),
      ],
      resumedInstagramCalls,
    ),
    issueGrant: async () => {
      throw new Error("RESUME_ISSUE_GRANT_FORBIDDEN");
    },
    request,
    runtime: resumeRuntime.runtime,
  });
  const resumedPrepared = await resumedInstagram.prepare(request);
  if (
    resumedPrepared.status !== "prepared" ||
    resumedPrepared.prepared.platform !== "instagram"
  ) {
    throw new Error("INSTAGRAM_RESUME_PREPARE_FAILED");
  }
  assert.equal(resumedPrepared.prepared.containerId, "container-1");
  assert.deepEqual(resumedPrepared.prepared.checkpoints, [
    { kind: "instagram_container", providerReferenceId: "container-1" },
  ]);
  const resumedResult = await resumedInstagram.publish(
    resumedPrepared.prepared,
  );
  assert.equal(resumedResult.status, "confirmed");
  assert.equal(resumedInstagramCalls.length, 2);
  assert.ok(
    new URL(resumedInstagramCalls[0] ?? "").pathname.endsWith("/container-1"),
  );
  assert.ok(
    new URL(resumedInstagramCalls[1] ?? "").pathname.endsWith("/media_publish"),
  );

  const transientStatusCalls: string[] = [];
  const transientStatusRuntime = fakeRuntime(
    {
      ...baseMaterial,
      media: {
        actualBytes: 4,
        mimeType: "image/png",
        objectKey: "fixture.png",
      },
      platform: "instagram",
      source: null,
    },
    { instagram_container: "container-transient" },
    true,
  );
  const transientStatusInstagram = createInstagramPublisher({
    acceptGrant: async () => {
      throw new Error("TRANSIENT_ACCEPT_GRANT_FORBIDDEN");
    },
    appUrl: "https://fixture.invalid",
    credential: {
      professionalAccountId: "account-1",
      systemUserAccessToken: "local-fixture",
    },
    fetch: fakeFetch(
      [
        jsonResponse({}, 429),
        jsonResponse({}, 503),
        jsonResponse({ status_code: "PUBLISHED" }),
      ],
      transientStatusCalls,
    ),
    issueGrant: async () => {
      throw new Error("TRANSIENT_ISSUE_GRANT_FORBIDDEN");
    },
    request,
    runtime: transientStatusRuntime.runtime,
  });
  const transientPrepared = await transientStatusInstagram.prepare(request);
  if (transientPrepared.status !== "prepared") {
    throw new Error("TRANSIENT_INSTAGRAM_PREPARE_FAILED");
  }
  const transientResult = await transientStatusInstagram.publish(
    transientPrepared.prepared,
  );
  assert.equal(transientResult.status, "confirmed");
  assert.equal(transientStatusCalls.length, 3);
  assert.ok(
    transientStatusCalls.every((url) =>
      new URL(url).pathname.endsWith("/container-transient"),
    ),
  );

  const replayStartedAt = Date.parse("2026-08-27T00:00:00.000Z");
  const replay = replayRuntime(
    {
      ...baseMaterial,
      draft: { ...baseMaterial.draft, body: PRIVACY_SENTINEL },
      media: {
        actualBytes: 4,
        mimeType: "image/png",
        objectKey: "fixture.png",
      },
      platform: "instagram",
      source: null,
    },
    replayStartedAt,
  );
  let persistedGrantHash: string | null = null;
  let imageUrlGrantHash: string | null = null;
  let issueGrantCalls = 0;
  let containerCalls = 0;
  let pollCalls = 0;
  let publishCalls = 0;
  const replayAccepted: string[] = [];
  const replayFetch = (async (resource: string | URL | Request) => {
    const url = new URL(String(resource));
    if (url.pathname.endsWith("/content_publishing_limit")) {
      return jsonResponse({
        data: [{ quota_usage: 1, config: { quota_total: 100 } }],
      });
    }
    if (url.pathname.endsWith("/media")) {
      containerCalls += 1;
      const imageUrl = url.searchParams.get("image_url");
      const rawGrant = imageUrl?.match(
        /\/api\/publishing-media\/([A-Za-z0-9_-]{43})$/u,
      )?.[1];
      if (!rawGrant) throw new Error("REPLAY_IMAGE_GRANT_MISSING");
      imageUrlGrantHash = sha256(rawGrant);
      return jsonResponse({ id: "container-replay" });
    }
    if (url.pathname.endsWith("/container-replay")) {
      pollCalls += 1;
      return jsonResponse({ status_code: "IN_PROGRESS" });
    }
    if (url.pathname.endsWith("/media_publish")) {
      publishCalls += 1;
      return jsonResponse({ id: "unexpected-media" });
    }
    throw new Error("REPLAY_PROVIDER_CALL_UNEXPECTED");
  }) as typeof fetch;
  const replayPublisher = () =>
    createInstagramPublisher({
      acceptGrant: async (id) => {
        replayAccepted.push(id);
      },
      appUrl: "https://fixture.invalid",
      credential: {
        professionalAccountId: "account-1",
        systemUserAccessToken: "local-fixture",
      },
      fetch: replayFetch,
      issueGrant: async (_request, rawToken) => {
        issueGrantCalls += 1;
        persistedGrantHash = sha256(rawToken);
        return { id: "grant-replay" };
      },
      now: replay.now,
      request,
      runtime: replay.runtime,
    });
  const replayPrepared = await replay.restart(() =>
    replayPublisher().prepare(request),
  );
  if (replayPrepared.status !== "prepared") {
    throw new Error("REPLAY_INSTAGRAM_PREPARE_FAILED");
  }
  assert.equal(issueGrantCalls, 1);
  assert.equal(containerCalls, 1);
  assert.equal(persistedGrantHash, imageUrlGrantHash);
  assert.deepEqual(replayAccepted, ["grant-replay"]);
  assert.deepEqual(
    replay.memoized.get("material:instagram-prepare-container:1"),
    {
      grantId: "grant-replay",
      id: "container-replay",
    },
  );
  const memoizedJson = JSON.stringify(replay.memoizedOutputs);
  assert.equal(memoizedJson.includes("/api/publishing-media/"), false);
  assert.equal(memoizedJson.includes(PRIVACY_SENTINEL), false);
  assert.equal(memoizedJson.includes("fixture.png"), false);
  assert.equal(
    /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)/u.test(memoizedJson),
    false,
  );

  const safeEvent = publicationRequestedPayloadSchema.parse({
    operationId: OPERATION_ID,
    publicationId: PUBLICATION_ID,
    schemaVersion: 1,
    workspaceId: WORKSPACE_ID,
  });
  assert.equal(JSON.stringify(safeEvent).includes(PRIVACY_SENTINEL), false);
  assert.equal(
    publicationRequestedPayloadSchema.safeParse({
      ...safeEvent,
      content: PRIVACY_SENTINEL,
    }).success,
    false,
  );
  assert.equal(
    operationStatusRealtimeMessageSchema.safeParse({
      lifecycle: "succeeded",
      operationId: OPERATION_ID,
      operationVersion: 1,
      content: PRIVACY_SENTINEL,
    }).success,
    false,
  );
  assert.equal(
    publishingChangedRealtimeMessageSchema.safeParse({
      schemaVersion: 1,
      occurredAt: new Date(replayStartedAt).toISOString(),
      operationId: OPERATION_ID,
      publicationId: PUBLICATION_ID,
      scheduleId: null,
      content: PRIVACY_SENTINEL,
    }).success,
    false,
  );
  assert.equal(
    cacheInvalidationRequestSchema.safeParse({
      tags: [`workspace:${WORKSPACE_ID}:publishing`],
      content: PRIVACY_SENTINEL,
    }).success,
    false,
  );

  let workerLog = "";
  const stdoutWrite = process.stdout.write;
  Object.defineProperty(process.stdout, "write", {
    configurable: true,
    value(chunk: string | Uint8Array) {
      workerLog += chunk.toString();
      return true;
    },
  });
  try {
    workerLogger.warn("worker.privacy-probe", {
      reason: `token=${PRIVACY_SENTINEL}`,
    });
  } finally {
    Object.defineProperty(process.stdout, "write", {
      configurable: true,
      value: stdoutWrite,
    });
  }
  assert.equal(workerLog.includes(PRIVACY_SENTINEL), false);

  const scrubbedError = scrubWorkerErrorEvent({
    extra: { content: PRIVACY_SENTINEL },
    message: PRIVACY_SENTINEL,
    request: { data: PRIVACY_SENTINEL },
    type: undefined,
  });
  assert.equal(JSON.stringify(scrubbedError).includes(PRIVACY_SENTINEL), false);
  const scrubbedTransaction = scrubWorkerTransaction({
    spans: [
      {
        data: { content: PRIVACY_SENTINEL },
        description: `worker/publish?content=${PRIVACY_SENTINEL}`,
        span_id: "0000000000000001",
        start_timestamp: replayStartedAt / 1_000,
        trace_id: "00000000000000000000000000000001",
      },
    ],
    transaction: `worker/publish?content=${PRIVACY_SENTINEL}`,
    type: "transaction",
  });
  assert.equal(
    JSON.stringify(scrubbedTransaction).includes(PRIVACY_SENTINEL),
    false,
  );
  const scrubbedLog = scrubWorkerLog({
    attributes: { content: PRIVACY_SENTINEL },
    level: "info",
    message: `worker.event?content=${PRIVACY_SENTINEL}`,
  });
  assert.equal(JSON.stringify(scrubbedLog).includes(PRIVACY_SENTINEL), false);

  const delayed = await replay.restart(() =>
    replayPublisher().publish(replayPrepared.prepared),
  );
  assert.equal(delayed.status, "failed");
  if (delayed.status !== "failed") {
    throw new Error("REPLAY_DELAYED_RESULT_INVALID");
  }
  assert.equal(delayed.failure.code, "INSTAGRAM_CONTAINER_PROCESSING_DELAYED");
  const durableDeadline =
    replay.memoized.get("run:instagram-poll-deadline:1") ?? null;
  assert.equal(durableDeadline, replayStartedAt + 10 * 60_000);
  assert.equal(replay.clock, durableDeadline);
  assert.ok(replay.deadlineObservations.length > 1);
  assert.equal(new Set(replay.deadlineObservations).size, 1);
  assert.ok(replay.replayCount > 1);
  assert.ok(pollCalls > 1);
  assert.equal(containerCalls, 1);
  assert.equal(publishCalls, 0);

  const effectiveAt = new Date("2026-08-27T00:00:00.000Z");
  assert.equal(
    classifyPublicationWake(
      effectiveAt,
      new Date(effectiveAt.getTime() + 5 * 60_000),
    ),
    "due",
  );
  assert.equal(
    classifyPublicationWake(
      effectiveAt,
      new Date(effectiveAt.getTime() + 5 * 60_000 + 1),
    ),
    "missed",
  );

  let claimed = false;
  const wake = async () => {
    await Promise.resolve();
    if (claimed) return "honest_loser";
    claimed = true;
    return "effect";
  };
  assert.deepEqual((await Promise.all([wake(), wake()])).sort(), [
    "effect",
    "honest_loser",
  ]);

  const recoverable = [
    { lifecycle: "running", leaseExpired: true, publication: "effect_claimed" },
    {
      lifecycle: "running",
      leaseExpired: false,
      publication: "effect_claimed",
    },
    { lifecycle: "succeeded", leaseExpired: true, publication: "confirmed" },
  ].filter(
    (entry) =>
      entry.lifecycle === "running" &&
      entry.leaseExpired &&
      entry.publication === "effect_claimed",
  );
  assert.equal(recoverable.length, 1);

  const notificationOrder: string[] = [];
  const notification = await settlePublishingNotification(
    async () => {
      notificationOrder.push("lane2");
      return "accepted";
    },
    async () => {
      notificationOrder.push("settle");
    },
  );
  if (notification === "accepted") notificationOrder.push("lane3");
  assert.deepEqual(notificationOrder, ["lane2", "settle", "lane3"]);

  for (const failureOutcome of ["disabled", "failed", "rejected"] as const) {
    const failureOrder: string[] = [];
    const outcome = await settlePublishingNotification(
      async () => {
        failureOrder.push("lane2");
        return failureOutcome;
      },
      async () => {
        failureOrder.push("settle");
      },
    );
    assert.equal(outcome, failureOutcome);
    assert.deepEqual(failureOrder, ["lane2"]);
  }

  const parentSource = readFileSync(
    fileURLToPath(new URL("./publishing.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(
    parentSource.indexOf("wait-until-publication-effective-at") <
      parentSource.indexOf("claim-publication-after-wake"),
  );
  assert.ok(parentSource.includes("Date.parse(timing.effectiveAt) + 1_000"));
  assert.ok(
    parentSource.indexOf('step.invoke("invoke-publication-provider-effect"') <
      parentSource.indexOf('"settled",'),
  );
  assert.ok(parentSource.includes("settleTimedOutPublicationExecution"));
  assert.ok(parentSource.includes("readPublicationExecutionSummary"));
  assert.ok(!parentSource.includes("loadPublicationExecutionContext"));
  const missedBranch = parentSource.slice(
    parentSource.indexOf('if (claim.status === "missed")'),
    parentSource.indexOf("return { operationId, status: claim.status }"),
  );
  assert.ok(missedBranch.includes("publishOperationStatus("));
  assert.ok(
    missedBranch.indexOf("publishOperationStatus(") <
      missedBranch.indexOf("notifyPublishingChanged("),
  );
  assert.ok(
    parentSource.includes("attemptCount: claimed.operation.attemptSeq"),
  );
  const relaySource = readFileSync(
    fileURLToPath(new URL("../relay/relay.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(
    relaySource.indexOf("await markOutboxDispatched") <
      relaySource.indexOf("await this.notifyPublishingDispatchChanged(event)"),
  );
  assert.ok(relaySource.includes("readPendingPublicationFollowUps"));
  assert.ok(relaySource.includes("repairSettlementActivity"));
  assert.ok(relaySource.includes("repairPublishingNotification"));
  assert.ok(relaySource.includes("recordPublicationSettlementActivity("));
  assert.equal(relaySource.includes("appendActivityEvent("), false);
  assert.equal(relaySource.includes("markSettlementActivityRecorded("), false);
  const effectSource = readFileSync(
    fileURLToPath(new URL("./publishing-effect.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(effectSource.includes("settlePublicationExecution"));
  assert.ok(effectSource.includes("recordPublicationSettlementActivity("));
  assert.equal(effectSource.includes("appendActivityEvent("), false);
  assert.equal(effectSource.includes("markSettlementActivityRecorded("), false);
  assert.ok(effectSource.includes("const PUBLISH_EFFECT_RETRIES = 0 as const"));
  assert.ok(effectSource.includes("retries: PUBLISH_EFFECT_RETRIES"));
  assert.ok(
    effectSource.indexOf("settle-publication-confirmed") <
      effectSource.indexOf(
        'recordSettlementActivity(runtime, input, "publication.confirmed")',
      ),
  );
  assert.ok(effectSource.includes("withMaterial: async"));
  assert.equal(effectSource.includes("load-publication-material"), false);
  assert.equal(effectSource.includes("record-final-checkpoint"), false);
  const publishingSource = readFileSync(
    fileURLToPath(new URL("./publishing.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(publishingSource.includes("onFailure: async"));
  assert.ok(
    publishingSource.includes("settle-failed-publication-reconciliation"),
  );
  assert.ok(publishingSource.includes("settleReconciliationOperationFailure("));
  assert.ok(
    publishingSource.includes(
      "claimedBy: `publishing-reconciliation:$" + "{event.data.run_id}`",
    ),
  );
  assert.ok(publishingSource.includes("publicationFailureCodeSchema"));
  const telegramSource = readFileSync(
    fileURLToPath(new URL("../publishing/telegram.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(
    telegramSource.includes(
      'async reconcile() {\n      return { status: "still_unknown" };',
    ),
  );
  const factorySource = readFileSync(
    fileURLToPath(new URL("../publishing/factory.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(factorySource.includes("providerRequestTimeoutMs(init)"));
  assert.equal(factorySource.includes("PROVIDER_REQUEST_TIMEOUT_MS"), false);
  const reconciliationSource = readFileSync(
    fileURLToPath(new URL("../publishing/reconcile.ts", import.meta.url)),
    "utf8",
  );
  assert.ok(reconciliationSource.includes('result.status === "failed"'));
  assert.ok(
    reconciliationSource.includes("throw new Error(result.failure.code)"),
  );
  assert.ok(
    reconciliationSource.includes(
      'return { operation: settled, status: "still_unknown" as const }',
    ),
  );
  assert.ok(
    reconciliationSource.match(/publishOperationStatus\(/gu)?.length === 3,
  );
  const attemptRepositorySource = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../packages/db/src/repositories/operation-attempt.ts",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  assert.ok(
    attemptRepositorySource.includes(
      'eq(operation.commandType, "publishing:reconciliation")',
    ),
  );
  assert.ok(
    attemptRepositorySource.includes("isNull(operationAttempt.outcome)"),
  );
  assert.ok(attemptRepositorySource.includes('outcome: "failed_terminal"'));
  assert.ok(attemptRepositorySource.includes('lifecycle: "failed"'));
  assert.ok(
    attemptRepositorySource.includes(
      "providerFailureCode: input.providerFailureCode",
    ),
  );
  const activityRepositorySource = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../packages/db/src/repositories/activity-event.ts",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  assert.ok(
    activityRepositorySource.includes("recordPublicationSettlementActivity("),
  );
  assert.ok(
    activityRepositorySource.includes(
      'current.settlementActivityStatus === "recorded"',
    ),
  );
  assert.ok(activityRepositorySource.includes('status: "replayed" as const'));
  assert.equal(
    providerCheckpointSchema.safeParse({
      kind: "x_post",
      providerReferenceId: "post-1",
      accessToken: "forbidden",
    }).success,
    false,
  );

  console.log(
    "publishing zero-key probe passed scenarios=62 providers=telegram,x,instagram external_calls=0 privacy_sentinels=passed",
  );
}

async function main() {
  if (mode.kind === "zero-key") {
    await runZeroKey();
    return;
  }
  await runBound(mode.callBudget);
}

void main().catch((error: unknown) => {
  console.error(
    `publishing zero-key probe failed [${error instanceof Error ? error.message : "UNKNOWN"}]`,
  );
  process.exitCode = 1;
});
