import { randomUUID } from "node:crypto";
import type {
  CardOriginReference,
  ContentLocale,
  Platform,
} from "@rz-chain-reporter/contracts";
import {
  MARKET_GENERATION_FINAL_MEDIA_KIND,
  runCardOriginReferenceSchema,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { sql } from "drizzle-orm";
import pg from "pg";

import type { Transaction } from "../executor";
import { createDb } from "../index";
import {
  findCopyExecutionContext,
  loadBoundCopyGenerationSourceInput,
  prepareCopyGenerationSource,
  type StartCopyOperationInput,
  settleCopyGeneration,
  startCopyOperation,
} from "../repositories/copy-generation";
import {
  type ExecuteDraftRevisionCommandInput,
  executeDraftRevisionCommand,
  readDraftRevisionCommandContext,
  readDraftRevisionReceiptInFreshTransaction,
} from "../repositories/draft-revision";
import { prepareMarketPlatform } from "../repositories/market-analysis-handoff";
import { routePlatformDraft } from "../repositories/platform-draft";
import {
  canReadOwnedMarketMedia,
  findServableMedia,
} from "../repositories/servable-media";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 12 });
const client = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const brandId = randomUUID();
const sourceId = randomUUID();
const analysisOperationId = randomUUID();
const analysisRunId = randomUUID();
const analysisUnitId = randomUUID();
const promoOperationId = randomUUID();
const promoRunId = randomUUID();
const promoUnitId = randomUUID();
const actor = `platform-draft-probe-${randomUUID()}`;
const selections = Array.from({ length: 6 }, () => randomUUID());
const sourceItems = Array.from({ length: 8 }, () => randomUUID());
const sourceRevisions = Array.from({ length: 8 }, () => randomUUID());
const filterResultId = randomUUID();
const invalidFilterResultId = randomUUID();
const promoIdeaId = randomUUID();
const observed: string[] = [];
const marketRollback = new Error("EXPECTED_PLATFORM_DRAFT_MARKET_ROLLBACK");

await client.connect();

try {
  await cleanupStaleFixtures();
  await insertFixture();
  await proveXor();

  const selectionOrigin = selection(0);
  const editorial = await route(selectionOrigin, "x", "editorial");
  assertStatus(editorial.status, "created", "editorial origin");
  const telegram = await route(
    { kind: "telegram_filter_result", telegramFilterResultId: filterResultId },
    "telegram",
    "telegram",
  );
  assertStatus(telegram.status, "created", "telegram origin");
  const promo = await route(
    { kind: "promo_idea", promoIdeaId },
    "instagram",
    "promo",
  );
  assertStatus(promo.status, "created", "promo origin");
  observed.push("all-three-origins");

  await proveMarketOrigin();

  const replay = await route(selectionOrigin, "x", "editorial");
  assertStatus(replay.status, "replayed", "ordinary replay");
  assertDraft(replay, editorial, "ordinary replay");
  observed.push("ordinary-replay");

  const sameKeyInput = input(selection(1), "telegram", "same-key", "same-hash");
  const sameKey = await Promise.all([
    routePlatformDraft(database.db, workspaceId, sameKeyInput),
    routePlatformDraft(database.db, workspaceId, sameKeyInput),
  ]);
  if (!sameKey.some((result) => result.status === "created")) {
    throw new Error("concurrent same-key route did not create");
  }
  const sameKeyDrafts = sameKey.flatMap((result) =>
    "draft" in result ? [result.draft.id] : [],
  );
  if (new Set(sameKeyDrafts).size !== 1) {
    throw new Error("concurrent same-key replay returned different drafts");
  }
  observed.push("concurrent-same-key-same-hash");

  const mismatchBase = input(
    selection(2),
    "telegram",
    "mismatch-key",
    "hash-a",
  );
  const mismatch = await Promise.all([
    routePlatformDraft(database.db, workspaceId, mismatchBase),
    routePlatformDraft(database.db, workspaceId, {
      ...mismatchBase,
      requestHash: "hash-b",
    }),
  ]);
  if (!mismatch.some((result) => result.status === "mismatch")) {
    throw new Error("concurrent changed payload was not rejected");
  }
  observed.push("concurrent-same-key-different-hash");

  const freshKeys = await Promise.all([
    routePlatformDraft(
      database.db,
      workspaceId,
      input(selection(3), "x", "fresh-a", "fresh-a"),
    ),
    routePlatformDraft(
      database.db,
      workspaceId,
      input(selection(3), "x", "fresh-b", "fresh-b"),
    ),
  ]);
  const statuses = freshKeys
    .map((result) => result.status)
    .sort()
    .join(",");
  if (statuses !== "created,reconciled") {
    throw new Error(`fresh-key race settled as ${statuses}`);
  }
  const freshDrafts = freshKeys.flatMap((result) =>
    "draft" in result ? [result.draft.id] : [],
  );
  if (new Set(freshDrafts).size !== 1) {
    throw new Error("fresh-key race returned different drafts");
  }
  await assertFreshRaceCounts(freshDrafts[0] as string);
  const reconciled = freshKeys.find((result) => result.status === "reconciled");
  if (
    !reconciled ||
    !("generationLifecycle" in reconciled) ||
    reconciled.generationLifecycle !== "queued"
  ) {
    throw new Error(
      "reconciled route did not return authoritative queued state",
    );
  }
  const reconciledReplay = await routePlatformDraft(
    database.db,
    workspaceId,
    input(selection(3), "x", "fresh-b", "fresh-b"),
  );
  assertStatus(reconciledReplay.status, "replayed", "terminal no-op replay");
  assertDraft(reconciledReplay, reconciled, "terminal no-op replay");
  observed.push("fresh-key-reconciliation");

  await assertRejectedWithoutEffects(
    selectionOrigin,
    "instagram",
    "news-editorial-platform",
  );
  await assertRejectedWithoutEffects(
    { kind: "telegram_filter_result", telegramFilterResultId: filterResultId },
    "instagram",
    "news-telegram-platform",
  );
  await assertRejectedWithoutEffects(
    { kind: "promo_idea", promoIdeaId },
    "x",
    "promo-platform",
  );
  observed.push("selected-platform-admission-no-effects");

  assertStatus(
    (
      await routePlatformDraft(
        database.db,
        workspaceId,
        input(selection(4), "x", "stale", "stale", "old-template"),
      )
    ).status,
    "stale_origin",
    "stale origin",
  );
  assertStatus(
    (
      await routePlatformDraft(
        database.db,
        workspaceId,
        input(
          { kind: "editorial_selection", editorialSelectionId: randomUUID() },
          "x",
          "tampered",
          "tampered",
        ),
      )
    ).status,
    "not_found",
    "tampered origin",
  );
  assertStatus(
    (
      await routePlatformDraft(
        database.db,
        otherWorkspaceId,
        input(selection(5), "x", "cross", "cross"),
      )
    ).status,
    "not_found",
    "cross-workspace origin",
  );
  assertStatus(
    (
      await routePlatformDraft(
        database.db,
        workspaceId,
        input(
          {
            kind: "telegram_filter_result",
            telegramFilterResultId: invalidFilterResultId,
          },
          "x",
          "disposition",
          "disposition",
        ),
      )
    ).status,
    "invalid_disposition",
    "invalid disposition",
  );
  observed.push("stale-tampered-cross-workspace-invalid-disposition");

  if (process.argv.includes("revision")) {
    const editorialDraftId = requireDraftId(editorial, "editorial");
    const telegramDraftId = requireDraftId(telegram, "telegram");
    await proveCopyOperationReplay(editorialDraftId);
    await proveDraftRevisionReplay({
      editorialDraftId,
      telegramDraftId,
      firstRaceDraftId: sameKeyDrafts[0] as string,
      secondRaceDraftId: mismatch.flatMap((result) =>
        "draft" in result ? [result.draft.id] : [],
      )[0] as string,
    });
  }

  console.log(`platform draft probe passed: ${observed.join(", ")}`);
} finally {
  await cleanup();
  await client.end();
  await database.close();
}

function selection(index: number): CardOriginReference {
  return {
    kind: "editorial_selection",
    editorialSelectionId: selections[index] as string,
  };
}

function input(
  origin: CardOriginReference,
  platform: Platform,
  idempotencyKey: string,
  requestHash: string,
  customerTemplateFingerprint = "probe-template",
) {
  return {
    actor,
    origin,
    platform,
    modelOptionKey: "probe-model",
    requestedContentLocale: "en" as const,
    idempotencyKey,
    requestHash,
    requestId: null,
    variantKeys: ["first", "second"],
    customerTemplateFingerprint,
    brandPolicyFingerprint: "probe-brand-policy",
    promptVersion: "probe-prompt",
    configurationVersion: "probe-configuration",
  };
}

async function route(
  origin: CardOriginReference,
  platform: Platform,
  key: string,
) {
  return routePlatformDraft(
    database.db,
    workspaceId,
    input(origin, platform, key, `${key}-hash`),
  );
}

async function assertRejectedWithoutEffects(
  origin: CardOriginReference,
  platform: Platform,
  key: string,
) {
  const before = await durableRouteCounts();
  const result = await routePlatformDraft(
    database.db,
    workspaceId,
    input(origin, platform, key, `${key}-hash`),
  );
  assertStatus(result.status, "platform_not_allowed", `${key} admission`);
  const after = await durableRouteCounts();
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error(
      `${key} rejection changed durable effects: ${JSON.stringify({ before, after })}`,
    );
  }
}

async function durableRouteCounts() {
  const result = await client.query<{
    drafts: number;
    generations: number;
    operations: number;
    outbox: number;
    units: number;
  }>(
    `select
       (select count(*)::int from operation where workspace_id = $1) as operations,
       (select count(*)::int from platform_draft where workspace_id = $1) as drafts,
       (select count(*)::int from copy_generation where workspace_id = $1) as generations,
       (select count(*)::int from copy_generation_unit where workspace_id = $1) as units,
       (select count(*)::int from outbox_event where workspace_id = $1) as outbox`,
    [workspaceId],
  );
  const row = result.rows[0];
  if (!row) throw new Error("durable route counts returned no row");
  return row;
}

function copyInput(
  platformDraftId: string,
  mode: Exclude<StartCopyOperationInput["mode"], "recover_incomplete">,
  idempotencyKey: string,
  requestHash: string,
): StartCopyOperationInput {
  const base = {
    actor,
    idempotencyKey,
    platformDraftId,
    requestHash,
    requestId: null,
  };
  const versionIdentity = {
    configurationVersion: "probe-configuration",
    copyPolicy: {
      fingerprints: { probe: "probe-brand-policy" },
      modelOptionKeys: ["probe-model"],
      platforms: [
        { platform: "instagram" as const, variantKeys: ["first", "second"] },
        { platform: "telegram" as const, variantKeys: ["first", "second"] },
        { platform: "x" as const, variantKeys: ["first", "second"] },
      ],
    },
    customerTemplateFingerprint: "probe-template",
    promptVersion: "probe-prompt",
  };
  if (mode === "retry_failed") {
    return {
      ...base,
      ...versionIdentity,
      mode,
      requestedContentLocale: "en" as const,
    };
  }
  return {
    ...base,
    ...versionIdentity,
    mode,
    requestedContentLocale: "en" as const,
    modelOptionKey: "probe-model",
  };
}

async function proveCopyOperationReplay(platformDraftId: string) {
  await settleDraftOperations(platformDraftId);

  for (const mode of [
    "regenerate",
    "refresh_article",
    "retry_failed",
  ] as const) {
    if (mode === "retry_failed")
      await failLatestGenerationUnit(platformDraftId);

    const replayKey = `${mode}-replay`;
    const replayInput = copyInput(
      platformDraftId,
      mode,
      replayKey,
      `${replayKey}-hash`,
    );
    const concurrent = await Promise.all([
      startCopyOperation(database.db, workspaceId, replayInput),
      startCopyOperation(database.db, workspaceId, replayInput),
    ]);
    assertOperationPair(concurrent, "replayed", `${mode} same-hash race`);

    const winner = concurrent.find((result) => result.status === "created");
    if (!winner || !("operationId" in winner)) {
      throw new Error(`${mode} same-hash race has no winner`);
    }
    const nonterminalReplay = await startCopyOperation(
      database.db,
      workspaceId,
      replayInput,
    );
    assertStatus(
      nonterminalReplay.status,
      "replayed",
      `${mode} nonterminal replay`,
    );
    await assertCopyWorkCount(replayKey, 1);
    await settleOperation(winner.operationId);

    if (mode === "retry_failed")
      await failLatestGenerationUnit(platformDraftId);

    const mismatchKey = `${mode}-mismatch`;
    const mismatch = await Promise.all([
      startCopyOperation(
        database.db,
        workspaceId,
        copyInput(platformDraftId, mode, mismatchKey, `${mismatchKey}-a`),
      ),
      startCopyOperation(
        database.db,
        workspaceId,
        copyInput(platformDraftId, mode, mismatchKey, `${mismatchKey}-b`),
      ),
    ]);
    assertOperationPair(
      mismatch,
      "idempotency_mismatch",
      `${mode} mismatch race`,
    );
    const mismatchWinner = mismatch.find(
      (result) => result.status === "created",
    );
    if (!mismatchWinner || !("operationId" in mismatchWinner)) {
      throw new Error(`${mode} mismatch race has no winner`);
    }
    await assertCopyWorkCount(mismatchKey, 1);
    await settleOperation(mismatchWinner.operationId);
  }

  await failLatestGenerationUnit(platformDraftId);
  const staleRetryKey = "retry-failed-template-drift";
  const staleRetry = await startCopyOperation(database.db, workspaceId, {
    ...copyInput(
      platformDraftId,
      "retry_failed",
      staleRetryKey,
      `${staleRetryKey}-hash`,
    ),
    customerTemplateFingerprint: "obsolete-probe-template",
  });
  assertStatus(staleRetry.status, "template_drift", "stale copy retry");
  await assertCopyWorkCount(staleRetryKey, 0);

  observed.push(
    "copy-producer-replay-mismatch-no-duplicate-work-template-drift",
  );
}

function assertOperationPair(
  results: Array<{ status: string }>,
  expectedSecond: "idempotency_mismatch" | "replayed",
  label: string,
) {
  const statuses = results
    .map((result) => result.status)
    .sort()
    .join(",");
  const expected = ["created", expectedSecond].sort().join(",");
  if (statuses !== expected) {
    throw new Error(`${label} settled as ${statuses}, expected ${expected}`);
  }
}

async function assertCopyWorkCount(idempotencyKey: string, expected: number) {
  const result = await client.query<{
    generations: number;
    operations: number;
    outbox: number;
  }>(
    `select
       (select count(*)::int from operation where workspace_id = $1 and actor = $2 and idempotency_key = $3) as operations,
       (select count(*)::int from copy_generation generation join operation on operation.id = generation.operation_id where generation.workspace_id = $1 and operation.actor = $2 and operation.idempotency_key = $3) as generations,
       (select count(*)::int from outbox_event event join operation on operation.id = event.operation_id where event.workspace_id = $1 and operation.actor = $2 and operation.idempotency_key = $3) as outbox`,
    [workspaceId, actor, idempotencyKey],
  );
  const row = result.rows[0];
  if (
    row?.operations !== expected ||
    row.generations !== expected ||
    row.outbox !== expected
  ) {
    throw new Error(
      `${idempotencyKey} duplicate work: ${JSON.stringify(result.rows[0])}`,
    );
  }
}

async function settleDraftOperations(platformDraftId: string) {
  await client.query(
    `update operation
       set lifecycle = 'succeeded', version = version + 1, updated_at = now()
      where workspace_id = $1
        and id in (
          select operation_id from copy_generation
           where workspace_id = $1 and platform_draft_id = $2
        )`,
    [workspaceId, platformDraftId],
  );
}

async function settleOperation(operationId: string) {
  await client.query(
    `update operation set lifecycle = 'succeeded', version = version + 1, updated_at = now() where workspace_id = $1 and id = $2`,
    [workspaceId, operationId],
  );
}

async function failLatestGenerationUnit(platformDraftId: string) {
  const unit = await client.query<{
    operationId: string;
    unitId: string;
  }>(
    `select generation.operation_id as "operationId", unit.id as "unitId"
       from copy_generation generation
       join copy_generation_unit unit on unit.copy_generation_id = generation.operation_id
      where generation.workspace_id = $1 and generation.platform_draft_id = $2
      order by generation.created_at desc, generation.operation_id desc, unit.created_at, unit.id
      limit 1`,
    [workspaceId, platformDraftId],
  );
  const row = unit.rows[0];
  if (!row) throw new Error("retry fixture has no generation unit");
  const attemptId = randomUUID();
  const nextAttempt = await client.query<{ attemptNumber: number }>(
    `select coalesce(max(attempt_number), 0)::int + 1 as "attemptNumber" from operation_attempt where workspace_id = $1 and operation_id = $2`,
    [workspaceId, row.operationId],
  );
  await client.query(
    `insert into operation_attempt (id, workspace_id, operation_id, attempt_number, outcome, failure_code, created_at, updated_at)
     values ($1, $2, $3, $4, 'failed_terminal', 'provider_rejected', now(), now())`,
    [
      attemptId,
      workspaceId,
      row.operationId,
      nextAttempt.rows[0]?.attemptNumber ?? 1,
    ],
  );
  await client.query(
    `update copy_generation_unit set status = 'failed', operation_attempt_id = $1, updated_at = now() where workspace_id = $2 and id = $3`,
    [attemptId, workspaceId, row.unitId],
  );
}

async function proveDraftRevisionReplay(input: {
  editorialDraftId: string;
  telegramDraftId: string;
  firstRaceDraftId: string;
  secondRaceDraftId: string;
}) {
  const editorialVariantId = await seedSucceededVariant(
    input.editorialDraftId,
    "editorial",
  );
  const telegramVariantId = await seedSucceededVariant(
    input.telegramDraftId,
    "telegram",
  );
  const firstRaceVariantId = await seedSucceededVariant(
    input.firstRaceDraftId,
    "race-first",
  );
  const secondRaceVariantId = await seedSucceededVariant(
    input.secondRaceDraftId,
    "race-second",
  );

  const apply = await revisionSubmitInput(
    input.editorialDraftId,
    editorialVariantId,
    "revision-apply",
    "revision-apply-hash",
    null,
  );
  const appended = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    apply,
  );
  assertStatus(appended.status, "appended", "revision append");
  if (!("revision" in appended)) throw new Error("append has no revision");

  const sameReplay = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    apply,
  );
  assertStatus(sameReplay.status, "replayed", "revision same-key replay");
  if (
    !("revision" in sameReplay) ||
    sameReplay.revision.id !== appended.revision.id
  ) {
    throw new Error("same-key replay did not return original revision");
  }

  const mismatch = await executeDraftRevisionCommand(database.db, workspaceId, {
    ...apply,
    requestHash: "revision-apply-changed",
  });
  assertStatus(
    mismatch.status,
    "idempotency_mismatch",
    "revision changed-payload replay",
  );

  const noOpInput: ExecuteDraftRevisionCommandInput = {
    actorId: actor,
    platformDraftId: input.editorialDraftId,
    commandKind: "submit_content",
    idempotencyKey: "revision-no-op",
    requestHash: "revision-no-op-hash",
    expectedActive: {
      id: appended.revision.id,
      version: 1,
    },
    content: {
      contentLocale: appended.revision.contentLocale,
      headline: appended.revision.headline,
      body: appended.revision.body,
      hashtags: appended.revision.hashtags,
    },
  };
  const noOp = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    noOpInput,
  );
  assertStatus(noOp.status, "no_op", "revision material no-op");
  if (!("appendedRevision" in noOp) || noOp.appendedRevision) {
    throw new Error("revision no-op appended a row");
  }

  const selectedMediaAssetId = randomUUID();
  await client.query(
    `insert into media_asset
       (id, workspace_id, kind, object_key, mime_type, declared_bytes, actual_bytes, checksum, lifecycle, verified_at, created_at, updated_at)
     values ($1, $2, 'image', $3, 'image/png', 1, 1, 'probe-image-checksum', 'verified', now(), now(), now())`,
    [
      selectedMediaAssetId,
      workspaceId,
      `${workspaceId}/platform-draft-probe/${selectedMediaAssetId}`,
    ],
  );
  const adopted = await executeDraftRevisionCommand(database.db, workspaceId, {
    actorId: actor,
    commandKind: "adopt_image",
    expectedActive: noOpInput.expectedActive,
    expectedImageIntentVersion: 0,
    finalMediaAssetId: selectedMediaAssetId,
    idempotencyKey: "revision-adopt-image",
    platformDraftId: input.editorialDraftId,
    requestHash: "revision-adopt-image-hash",
  });
  if (
    !("revision" in adopted) ||
    adopted.revision.selectedFinalMediaAssetId !== selectedMediaAssetId
  ) {
    throw new Error("revision image was not selected");
  }
  const servableImage = await findServableMedia(
    database.db,
    workspaceId,
    selectedMediaAssetId,
  );
  if (!servableImage) {
    throw new Error("verified adopted operator image is not servable");
  }
  if (
    (await findServableMedia(
      database.db,
      otherWorkspaceId,
      selectedMediaAssetId,
    )) !== null
  ) {
    throw new Error("operator image serving crossed the workspace boundary");
  }
  const mediaCases = [
    { label: "jpeg", mimeType: "image/jpeg", servable: true },
    { label: "webp", mimeType: "image/webp", servable: true },
    { label: "reference", kind: "reference_image" },
    { label: "provider-original", kind: "provider_original" },
    { label: "orphan-generated-final", kind: "image_final" },
    { label: "pending", lifecycle: "pending" },
    { label: "rejected", lifecycle: "rejected" },
    { label: "removed", objectRemovedAt: new Date() },
    { label: "missing-bytes", actualBytes: null },
    { label: "missing-checksum", checksum: null },
    { label: "unsupported-mime", mimeType: "image/svg+xml" },
  ].map((value) => ({
    kind: "image",
    lifecycle: "verified",
    mimeType: "image/png",
    actualBytes: 1,
    checksum: "probe-image-checksum",
    objectRemovedAt: null,
    servable: false,
    ...value,
  }));
  for (const mediaCase of mediaCases) {
    const mediaId = randomUUID();
    await client.query(
      `insert into media_asset
         (id, workspace_id, kind, object_key, mime_type, declared_bytes, actual_bytes, checksum, lifecycle, object_removed_at)
       values ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9)`,
      [
        mediaId,
        workspaceId,
        mediaCase.kind,
        `${workspaceId}/platform-draft-probe/${mediaId}`,
        mediaCase.mimeType,
        mediaCase.actualBytes,
        mediaCase.checksum,
        mediaCase.lifecycle,
        mediaCase.objectRemovedAt,
      ],
    );
    const servable = await findServableMedia(database.db, workspaceId, mediaId);
    if ((servable !== null) !== mediaCase.servable) {
      throw new Error(`operator image serving mishandled ${mediaCase.label}`);
    }
  }
  observed.push("operator-upload-serving-mime-lifecycle-workspace-provenance");

  const editInput: ExecuteDraftRevisionCommandInput = {
    ...noOpInput,
    idempotencyKey: "revision-edit",
    requestHash: "revision-edit-hash",
    expectedActive: { id: adopted.revision.id, version: 1 },
    content: { ...noOpInput.content, body: "Probe editorial body edited" },
  };
  const edited = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    editInput,
  );
  assertStatus(edited.status, "appended", "revision direct edit");
  if (
    !("revision" in edited) ||
    edited.revision.selectedFinalMediaAssetId !== selectedMediaAssetId
  ) {
    throw new Error("revision direct edit detached selected media");
  }
  const noOpReplay = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    noOpInput,
  );
  if (
    noOpReplay.status !== "replayed" ||
    noOpReplay.revision.id !== appended.revision.id ||
    noOpReplay.appendedRevision
  ) {
    throw new Error("no-op replay drifted after a newer revision");
  }

  const telegramFirst = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    await revisionSubmitInput(
      input.telegramDraftId,
      telegramVariantId,
      "telegram-apply",
      "telegram-apply-hash",
      null,
    ),
  );
  if (telegramFirst.status !== "appended") {
    throw new Error(
      `telegram revision seed settled as ${telegramFirst.status}`,
    );
  }
  const expectedActive = {
    id: telegramFirst.revision.id,
    version: 1,
  };
  const concurrentEdits = await Promise.all([
    executeDraftRevisionCommand(database.db, workspaceId, {
      actorId: actor,
      platformDraftId: input.telegramDraftId,
      commandKind: "submit_content",
      idempotencyKey: "telegram-edit-a",
      requestHash: "telegram-edit-a-hash",
      expectedActive,
      content: {
        contentLocale: "en",
        headline: "Probe telegram headline",
        body: "Probe telegram concurrent edit A",
        hashtags: ["#probe", "#a"],
      },
    }),
    executeDraftRevisionCommand(database.db, workspaceId, {
      actorId: actor,
      platformDraftId: input.telegramDraftId,
      commandKind: "submit_content",
      idempotencyKey: "telegram-edit-b",
      requestHash: "telegram-edit-b-hash",
      expectedActive,
      content: {
        contentLocale: "en",
        headline: "Probe telegram headline",
        body: "Probe telegram concurrent edit B",
        hashtags: ["#probe", "#b"],
      },
    }),
  ]);
  const concurrentStatuses = concurrentEdits
    .map((result) => result.status)
    .sort()
    .join(",");
  if (concurrentStatuses !== "appended,version_conflict") {
    throw new Error(
      `independent revision transactions settled as ${concurrentStatuses}`,
    );
  }

  const firstRace = await revisionSubmitInput(
    input.firstRaceDraftId,
    firstRaceVariantId,
    "nested-savepoint-race",
    "nested-savepoint-race-hash",
    null,
  );
  const secondRace = await revisionSubmitInput(
    input.secondRaceDraftId,
    secondRaceVariantId,
    "nested-savepoint-race",
    "nested-savepoint-race-hash",
    null,
  );
  const raced = await Promise.all([
    executeDraftRevisionCommand(database.db, workspaceId, firstRace),
    executeDraftRevisionCommand(database.db, workspaceId, secondRace),
  ]);
  const raceStatuses = raced
    .map((result) => result.status)
    .sort()
    .join(",");
  if (raceStatuses !== "appended,replayed") {
    throw new Error(`nested-savepoint receipt race settled as ${raceStatuses}`);
  }
  await assertRevisionRaceCounts(
    input.firstRaceDraftId,
    input.secondRaceDraftId,
    "nested-savepoint-race",
  );

  await proveFreshTransactionWinnerRead(firstRace);
  await proveRevisionSnapshots({
    draftId: input.editorialDraftId,
    variantId: editorialVariantId,
    originalId: appended.revision.id,
    editedId: edited.revision.id,
    foreignRevisionId: telegramFirst.revision.id,
    selectedMediaAssetId,
    replayInput: noOpInput,
  });
  observed.push(
    "revision-append-no-op-media-preserved-replay-conflict-savepoint-fresh-read",
  );
}

async function proveRevisionSnapshots(input: {
  draftId: string;
  variantId: string;
  originalId: string;
  editedId: string;
  foreignRevisionId: string;
  selectedMediaAssetId: string;
  replayInput: ExecuteDraftRevisionCommandInput;
}) {
  const initial = await readDraftRevisionCommandContext(
    database.db,
    workspaceId,
    input.draftId,
    actor,
    input.originalId,
  );
  if (!initial?.active || !initial.expectedRevision) {
    throw new Error("revision snapshot fixture is incomplete");
  }
  const original = initial.expectedRevision;
  if (
    original.selectedFinalMediaAssetId !== input.selectedMediaAssetId ||
    initial.active.id !== input.editedId ||
    initial.active.selectedFinalMediaAssetId !== input.selectedMediaAssetId
  ) {
    throw new Error("revision media pair was not preserved");
  }
  await assertActiveRevision(input.draftId, input.editedId, 2, 2);

  const unchanged = await executeRevision({
    actorId: actor,
    platformDraftId: input.draftId,
    commandKind: "submit_content",
    source: { kind: "draft_revision", id: input.editedId },
    idempotencyKey: "snapshot-normalized-no-op",
    requestHash: "snapshot-normalized-no-op",
    expectedActive: { id: input.editedId, version: 2 },
    content: {
      contentLocale: initial.active.contentLocale,
      headline: `  ${initial.active.headline}  `,
      body: `\n${initial.active.body}\n`,
      hashtags: initial.active.hashtags.map((tag) => ` ${tag} `),
    },
  });
  assertStatus(unchanged.status, "no_op", "normalized unchanged save");
  await assertActiveRevision(input.draftId, input.editedId, 2, 2);

  const fromHistory = await executeRevision({
    actorId: actor,
    platformDraftId: input.draftId,
    commandKind: "submit_content",
    source: { kind: "draft_revision", id: input.originalId },
    content: {
      contentLocale: original.contentLocale,
      headline: original.headline,
      body: "New saved copy from a historical revision",
      hashtags: original.hashtags,
    },
    expectedActive: { id: input.editedId, version: 2 },
    idempotencyKey: "snapshot-save-from-history",
    requestHash: "snapshot-save-from-history",
  });
  if (
    fromHistory.status !== "appended" ||
    fromHistory.revision.revisionNumber !== 3
  ) {
    throw new Error(
      "editing historical source did not append the next revision",
    );
  }
  await assertActiveRevision(input.draftId, fromHistory.revision.id, 3, 3);

  const replay = await executeRevision(input.replayInput);
  if (replay.status !== "replayed" || replay.revision.id !== input.originalId) {
    throw new Error("old receipt did not preserve its immutable result");
  }

  await client.query("begin");
  try {
    await expectConstraint(
      "immutable media snapshot",
      "update draft_revision set selected_final_media_asset_id = null where workspace_id = $1 and id = $2",
      [workspaceId, input.originalId],
      "ck_draft_revision_generated_media_transition",
    );
    await expectConstraint(
      "immutable copy snapshot",
      "update draft_revision set body = 'changed' where workspace_id = $1 and id = $2",
      [workspaceId, input.originalId],
      "ck_draft_revision_copy_immutable",
    );
    await expectConstraint(
      "active revision belongs to draft",
      "update platform_draft set active_revision_id = $1 where workspace_id = $2 and id = $3",
      [input.foreignRevisionId, workspaceId, input.draftId],
      "fk_platform_draft_active_revision",
    );
  } finally {
    await client.query("rollback");
  }

  await proveVisibleCopyVariantSources({
    draftId: input.draftId,
    activeRevisionId: fromHistory.revision.id,
    activeRevisionVersion: 3,
    currentVariantId: input.variantId,
    currentContent: {
      contentLocale: fromHistory.revision.contentLocale,
      headline: fromHistory.revision.headline,
      body: fromHistory.revision.body,
      hashtags: fromHistory.revision.hashtags,
    },
  });
  observed.push(
    "immutable-copy-media-pair-source-edit-appends-next-revision",
    "normalized-unchanged-content-no-op",
    "copy-variant-source-current-base-retry-and-provenance-only-superseded",
  );
}

async function proveVisibleCopyVariantSources(input: {
  draftId: string;
  activeRevisionId: string;
  activeRevisionVersion: number;
  currentVariantId: string;
  currentContent: {
    contentLocale: ContentLocale;
    headline: string;
    body: string;
    hashtags: string[];
  };
}) {
  const baseline = await startCopyOperation(
    database.db,
    workspaceId,
    copyInput(
      input.draftId,
      "regenerate",
      "visible-source-baseline",
      "visible-source-baseline",
    ),
  );
  if (baseline.status !== "created") {
    throw new Error(`baseline generation settled as ${baseline.status}`);
  }
  const baselineVariantId = await settleGenerationWithVariant(
    baseline.operationId,
    "baseline",
    input.currentContent,
  );
  const baselineNoOp = await executeRevision({
    actorId: actor,
    platformDraftId: input.draftId,
    commandKind: "submit_content",
    source: {
      kind: "copy_variant",
      id: baselineVariantId,
      contentLocale: input.currentContent.contentLocale,
    },
    content: input.currentContent,
    expectedActive: {
      id: input.activeRevisionId,
      version: input.activeRevisionVersion,
    },
    idempotencyKey: "visible-source-baseline-no-op",
    requestHash: "visible-source-baseline-no-op",
  });
  if (
    baselineNoOp.status !== "no_op" ||
    baselineNoOp.revision.id !== input.activeRevisionId
  ) {
    throw new Error("equivalent current source did not preserve the revision");
  }

  const replacement = await startCopyOperation(
    database.db,
    workspaceId,
    copyInput(
      input.draftId,
      "regenerate",
      "visible-source-replacement",
      "visible-source-replacement",
    ),
  );
  if (replacement.status !== "created") {
    throw new Error(`replacement generation settled as ${replacement.status}`);
  }
  await client.query(
    `update copy_generation
        set limited = true,
            limited_reason = 'fetch_failed',
            source_item_enrichment_id = null,
            page_content_hash = null
      where workspace_id = $1 and operation_id = $2`,
    [workspaceId, replacement.operationId],
  );

  const whileReplacementRuns = await executeRevision({
    actorId: actor,
    platformDraftId: input.draftId,
    commandKind: "submit_content",
    source: {
      kind: "copy_variant",
      id: baselineVariantId,
      contentLocale: input.currentContent.contentLocale,
    },
    content: input.currentContent,
    expectedActive: {
      id: input.activeRevisionId,
      version: input.activeRevisionVersion,
    },
    idempotencyKey: "visible-source-in-progress",
    requestHash: "visible-source-in-progress",
  });
  if (
    whileReplacementRuns.status !== "no_op" ||
    whileReplacementRuns.revision.id !== input.activeRevisionId
  ) {
    throw new Error("in-progress replacement hid the last successful set");
  }

  const replacementVariantId = await settleGenerationWithVariant(
    replacement.operationId,
    "replacement",
    input.currentContent,
  );
  const retained = await client.query<{ present: boolean }>(
    "select exists(select 1 from copy_variant where workspace_id = $1 and id = $2) as present",
    [workspaceId, input.currentVariantId],
  );
  if (!retained.rows[0]?.present) {
    throw new Error("referenced superseded variation lost its provenance row");
  }

  const superseded = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    {
      actorId: actor,
      platformDraftId: input.draftId,
      commandKind: "submit_content",
      source: {
        kind: "copy_variant",
        id: baselineVariantId,
        contentLocale: input.currentContent.contentLocale,
      },
      content: input.currentContent,
      expectedActive: {
        id: input.activeRevisionId,
        version: input.activeRevisionVersion,
      },
      idempotencyKey: "visible-source-superseded",
      requestHash: "visible-source-superseded",
    },
  );
  assertStatus(
    superseded.status,
    "not_found",
    "superseded provenance-only variant",
  );

  const replacementRevision = await executeRevision({
    actorId: actor,
    platformDraftId: input.draftId,
    commandKind: "submit_content",
    source: {
      kind: "copy_variant",
      id: replacementVariantId,
      contentLocale: input.currentContent.contentLocale,
    },
    content: input.currentContent,
    expectedActive: {
      id: input.activeRevisionId,
      version: input.activeRevisionVersion,
    },
    idempotencyKey: "visible-source-current-base",
    requestHash: "visible-source-current-base",
  });
  assertStatus(
    replacementRevision.status,
    "appended",
    "same material with changed source provenance",
  );

  const retry = await startCopyOperation(
    database.db,
    workspaceId,
    copyInput(
      input.draftId,
      "retry_failed",
      "visible-source-retry",
      "visible-source-retry",
    ),
  );
  if (retry.status !== "created") {
    throw new Error(`retry generation settled as ${retry.status}`);
  }
  const retryVariantId = await settleGenerationWithVariant(
    retry.operationId,
    "retry",
  );
  const retryRevision = await executeRevision({
    actorId: actor,
    platformDraftId: input.draftId,
    commandKind: "submit_content",
    source: { kind: "copy_variant", id: retryVariantId, contentLocale: "en" },
    content: generationContent("retry"),
    expectedActive: {
      id: replacementRevision.revision.id,
      version: input.activeRevisionVersion + 1,
    },
    idempotencyKey: "visible-source-current-retry",
    requestHash: "visible-source-current-retry",
  });
  assertStatus(
    retryRevision.status,
    "appended",
    "current retry variant source",
  );
}

async function settleGenerationWithVariant(
  operationId: string,
  suffix: string,
  selectedContent: {
    contentLocale: ContentLocale;
    headline: string;
    body: string;
    hashtags: string[];
  } = generationContent(suffix),
) {
  const units = await client.query<{ id: string }>(
    `select id
       from copy_generation_unit
      where workspace_id = $1 and copy_generation_id = $2
      order by created_at, id`,
    [workspaceId, operationId],
  );
  const first = units.rows[0];
  if (!first) throw new Error(`${suffix} generation has no unit`);
  const attempts = await client.query<{ lastAttempt: number }>(
    `select coalesce(max(attempt_number), 0)::int as "lastAttempt"
       from operation_attempt
      where workspace_id = $1 and operation_id = $2`,
    [workspaceId, operationId],
  );
  const lastAttempt = attempts.rows[0]?.lastAttempt ?? 0;

  for (const [index, unit] of units.rows.entries()) {
    const attemptId = randomUUID();
    const succeeded = index === 0;
    await client.query(
      `insert into operation_attempt
        (id, workspace_id, operation_id, attempt_number, outcome, failure_code, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, now(), now())`,
      [
        attemptId,
        workspaceId,
        operationId,
        lastAttempt + index + 1,
        succeeded ? "succeeded" : "failed_terminal",
        succeeded ? null : "provider_rejected",
      ],
    );
    await client.query(
      `update copy_generation_unit
          set status = $1, operation_attempt_id = $2, updated_at = now()
        where workspace_id = $3 and id = $4`,
      [succeeded ? "succeeded" : "failed", attemptId, workspaceId, unit.id],
    );
  }

  const variantId = randomUUID();
  await client.query(
    `insert into copy_variant
      (id, workspace_id, copy_generation_unit_id, content_locale, headline, body, hashtags, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [
      variantId,
      workspaceId,
      first.id,
      selectedContent.contentLocale,
      selectedContent.headline,
      selectedContent.body,
      selectedContent.hashtags,
    ],
  );
  const settled = await settleCopyGeneration(
    database.db,
    workspaceId,
    operationId,
  );
  if (settled?.lifecycle !== "succeeded") {
    throw new Error(`${suffix} generation did not succeed`);
  }
  return variantId;
}

function generationContent(suffix: string) {
  return {
    contentLocale: "en" as const,
    headline: `Probe ${suffix} headline`,
    body: `Probe ${suffix} body`,
    hashtags: ["#probe", `#${suffix}`],
  };
}

async function executeRevision(input: ExecuteDraftRevisionCommandInput) {
  const result = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    input,
  );
  if (!("revision" in result)) {
    throw new Error(`${input.idempotencyKey} settled as ${result.status}`);
  }
  return result;
}

async function assertActiveRevision(
  platformDraftId: string,
  revisionId: string,
  version: number,
  count: number,
) {
  const result = await client.query<{
    activeRevisionId: string;
    revisionVersion: number;
    laneVersion: number;
    revisionCount: number;
  }>(
    `select active_revision_id as "activeRevisionId", revision_version as "revisionVersion", version as "laneVersion",
       (select count(*)::int from draft_revision where workspace_id = $1 and platform_draft_id = $2) as "revisionCount"
     from platform_draft where workspace_id = $1 and id = $2`,
    [workspaceId, platformDraftId],
  );
  const row = result.rows[0];
  if (
    row?.activeRevisionId !== revisionId ||
    row.revisionVersion !== version ||
    row.laneVersion !== 1 ||
    row.revisionCount !== count
  ) {
    throw new Error(`active snapshot state differs: ${JSON.stringify(row)}`);
  }
}

async function revisionSubmitInput(
  platformDraftId: string,
  copyVariantId: string,
  idempotencyKey: string,
  requestHash: string,
  active: { id: string; version: number } | null,
): Promise<ExecuteDraftRevisionCommandInput> {
  const variant = await client.query<{
    contentLocale: ContentLocale;
    headline: string;
    body: string;
    hashtags: string[];
  }>(
    `select content_locale as "contentLocale", headline, body, hashtags
       from copy_variant
      where workspace_id = $1 and id = $2`,
    [workspaceId, copyVariantId],
  );
  const content = variant.rows[0];
  if (!content) throw new Error("revision source variation is missing");
  return {
    actorId: actor,
    platformDraftId,
    commandKind: "submit_content",
    source: {
      kind: "copy_variant",
      id: copyVariantId,
      contentLocale: content.contentLocale,
    },
    content,
    idempotencyKey,
    requestHash,
    expectedActive: active ?? { id: null, version: 0 },
  };
}

async function seedSucceededVariant(
  platformDraftId: string,
  suffix: string,
  content?: {
    contentLocale: ContentLocale;
    headline: string;
    body: string;
    hashtags: string[];
  },
) {
  await settleDraftOperations(platformDraftId);
  const unit = await client.query<{
    operationId: string;
    unitId: string;
  }>(
    `select generation.operation_id as "operationId", unit.id as "unitId"
       from copy_generation generation
       join copy_generation_unit unit on unit.copy_generation_id = generation.operation_id
      where generation.workspace_id = $1 and generation.platform_draft_id = $2 and unit.status = 'pending'
      order by generation.created_at desc, generation.operation_id desc, unit.created_at, unit.id
      limit 1`,
    [workspaceId, platformDraftId],
  );
  const row = unit.rows[0];
  if (!row) throw new Error(`${suffix} has no pending copy unit`);
  return settleGenerationWithVariant(
    row.operationId,
    suffix,
    content ?? {
      contentLocale: "en",
      headline: `Probe ${suffix} headline`,
      body: `Probe ${suffix} body`,
      hashtags: ["#probe", "#platform"],
    },
  );
}

async function assertRevisionRaceCounts(
  firstDraftId: string,
  secondDraftId: string,
  idempotencyKey: string,
) {
  const result = await client.query<{
    receipts: number;
    revisions: number;
    activeDrafts: number;
    activeVersions: number;
  }>(
    `select
       (select count(*)::int from draft_revision_command_receipt where workspace_id = $1 and actor_id = $2 and command_kind = 'submit_content' and idempotency_key = $3) as receipts,
       (select count(*)::int from draft_revision where workspace_id = $1 and platform_draft_id in ($4, $5)) as revisions,
       (select count(*)::int from platform_draft where workspace_id = $1 and id in ($4, $5) and active_revision_id is not null) as "activeDrafts",
       (select sum(revision_version)::int from platform_draft where workspace_id = $1 and id in ($4, $5)) as "activeVersions"`,
    [workspaceId, actor, idempotencyKey, firstDraftId, secondDraftId],
  );
  const row = result.rows[0];
  if (
    row?.receipts !== 1 ||
    row.revisions !== 1 ||
    row.activeDrafts !== 1 ||
    row.activeVersions !== 1
  ) {
    throw new Error(`revision race leaked state: ${JSON.stringify(row)}`);
  }
}

async function proveFreshTransactionWinnerRead(
  input: ExecuteDraftRevisionCommandInput,
) {
  await client.query("begin");
  let conflict: unknown;
  try {
    await client.query(
      `insert into draft_revision_command_receipt
        (id, workspace_id, actor_id, platform_draft_id, command_kind, idempotency_key, request_hash, resulting_draft_revision_id, appended_revision, created_at)
       select $1, workspace_id, actor_id, platform_draft_id, command_kind, idempotency_key, request_hash, resulting_draft_revision_id, appended_revision, now()
         from draft_revision_command_receipt
        where workspace_id = $2 and actor_id = $3 and command_kind = 'submit_content' and idempotency_key = $4`,
      [randomUUID(), workspaceId, actor, input.idempotencyKey],
    );
    throw new Error("forced receipt conflict did not fail");
  } catch (error) {
    conflict = error;
  }
  try {
    await client.query("select 1");
    throw new Error("forced receipt conflict did not abort outer transaction");
  } catch (error) {
    if (!(error instanceof pg.DatabaseError) || error.code !== "25P02") {
      throw error;
    }
  } finally {
    await client.query("rollback");
  }
  const replay = await readDraftRevisionReceiptInFreshTransaction(
    database.db,
    workspaceId,
    input,
    conflict,
  );
  assertStatus(replay.status, "replayed", "fresh-transaction winner read");
}

function assertStatus(actual: string, expected: string, label: string) {
  if (actual !== expected)
    throw new Error(`${label}: ${actual}, expected ${expected}`);
}

function assertDraft(
  left: Awaited<ReturnType<typeof routePlatformDraft>>,
  right: Awaited<ReturnType<typeof routePlatformDraft>>,
  label: string,
) {
  if (
    !("draft" in left) ||
    !("draft" in right) ||
    left.draft.id !== right.draft.id
  ) {
    throw new Error(`${label} did not return the authoritative draft`);
  }
}

function requireDraftId(
  result: Awaited<ReturnType<typeof routePlatformDraft>>,
  label: string,
) {
  if (!("draft" in result)) throw new Error(`${label} has no draft`);
  return result.draft.id;
}

async function assertFreshRaceCounts(draftId: string) {
  const result = await client.query<{
    generations: number;
    units: number;
    outbox: number;
    terminalReceipts: number;
  }>(
    `select
       (select count(*)::int from copy_generation where workspace_id = $1 and platform_draft_id = $2) as generations,
       (select count(*)::int from copy_generation_unit unit join copy_generation generation on generation.operation_id = unit.copy_generation_id where generation.workspace_id = $1 and generation.platform_draft_id = $2) as units,
       (select count(*)::int from outbox_event event join copy_generation generation on generation.operation_id = event.operation_id where generation.workspace_id = $1 and generation.platform_draft_id = $2) as outbox,
       (select count(*)::int from operation where workspace_id = $1 and command_type = 'copy-generation:route' and lifecycle = 'succeeded' and idempotency_key in ('fresh-a', 'fresh-b')) as "terminalReceipts"`,
    [workspaceId, draftId],
  );
  const row = result.rows[0];
  if (
    row?.generations !== 1 ||
    row.units !== 2 ||
    row.outbox !== 1 ||
    row.terminalReceipts !== 1
  ) {
    throw new Error(`fresh-key counts drifted: ${JSON.stringify(row)}`);
  }
}

async function proveMarketOrigin() {
  try {
    await database.db.transaction(async (tx) => {
      const ids = {
        analysis: randomUUID(),
        analysisOperation: randomUUID(),
        chartAsset: randomUUID(),
        chartOperation: randomUUID(),
        chartRender: randomUUID(),
        finalAsset: randomUUID(),
        generation: randomUUID(),
        generationOperation: randomUUID(),
        handoff: randomUUID(),
        instrument: randomUUID(),
        snapshot: randomUUID(),
        snapshotOperation: randomUUID(),
      };
      await insertMarketFixture(tx, ids);

      const origin = {
        kind: "market_analysis_handoff" as const,
        marketAnalysisHandoffId: ids.handoff,
      };
      if (runCardOriginReferenceSchema.safeParse(origin).success) {
        throw new Error("editorial three-origin guard accepted market origin");
      }
      const created = await prepareMarketPlatform(tx, workspaceId, {
        actorId: actor,
        analysisId: ids.analysis,
        platform: "x",
        modelOptionKey: "probe-model",
        idempotencyKey: "market-route",
        requestHash: "market-route-hash",
        requestId: null,
        variantKeys: ["first", "second", "third"],
        customerTemplateFingerprint: "current-policy-template",
        brandPolicyFingerprint: "current-policy-brand",
        promptVersion: "probe-prompt",
        configurationVersion: "probe-configuration",
      });
      assertStatus(created.status, "created", "market route");
      if (!("draft" in created) || created.draft.lanePosition !== null) {
        throw new Error("market route allocated a lane position");
      }
      const replayed = await prepareMarketPlatform(tx, workspaceId, {
        actorId: actor,
        analysisId: ids.analysis,
        platform: "x",
        modelOptionKey: "probe-model",
        idempotencyKey: "market-route",
        requestHash: "market-route-hash",
        requestId: null,
        variantKeys: ["first", "second", "third"],
        customerTemplateFingerprint: "current-policy-template",
        brandPolicyFingerprint: "current-policy-brand",
        promptVersion: "probe-prompt",
        configurationVersion: "probe-configuration",
      });
      assertStatus(replayed.status, "replayed", "market route replay");
      if (!("draft" in replayed) || replayed.draft.id !== created.draft.id) {
        throw new Error("market route replay lost its authoritative draft");
      }

      const operationResult = await tx.execute<{ operationId: string }>(sql`
        select generation.operation_id as "operationId"
          from copy_generation generation
         where generation.workspace_id = ${workspaceId}::uuid
           and generation.platform_draft_id = ${created.draft.id}::uuid
      `);
      const operationId = operationResult.rows[0]?.operationId;
      if (!operationId) throw new Error("market route has no copy generation");

      const source = await prepareCopyGenerationSource(
        tx,
        workspaceId,
        operationId,
        2_000,
      );
      if (source.status !== "bound" || source.kind !== "market") {
        throw new Error(`market copy source settled as ${source.status}`);
      }
      const bound = await loadBoundCopyGenerationSourceInput(
        tx,
        workspaceId,
        operationId,
      );
      if (
        bound?.kind !== "market" ||
        bound.handoffId !== ids.handoff ||
        bound.headline !== "Market headline"
      ) {
        throw new Error("market copy source did not bind immutable handoff");
      }
      const execution = await findCopyExecutionContext(
        tx,
        workspaceId,
        operationId,
      );
      if (
        execution?.executionScope.kind !== "market_analysis" ||
        execution.executionScope.marketAnalysisId !== ids.analysis
      ) {
        throw new Error("market copy execution scope was not discriminated");
      }

      const projection = await tx.execute<{
        exactCount: number;
        laneCount: number;
        savedCount: number;
      }>(sql`
        select
          count(*) filter (where draft.id = ${created.draft.id}::uuid)::int as "exactCount",
          count(*) filter (
            where draft.id = ${created.draft.id}::uuid
              and draft.market_analysis_handoff_id is null
          )::int as "laneCount",
          count(*) filter (
            where draft.id = ${created.draft.id}::uuid
              and handoff.market_analysis_id = ${ids.analysis}::uuid
          )::int as "savedCount"
        from platform_draft draft
        left join market_analysis_handoff handoff
          on handoff.workspace_id = draft.workspace_id
          and handoff.id = draft.market_analysis_handoff_id
        where draft.workspace_id = ${workspaceId}::uuid
      `);
      const projected = projection.rows[0];
      if (
        projected?.exactCount !== 1 ||
        projected.savedCount !== 1 ||
        projected.laneCount !== 0
      ) {
        throw new Error(
          `market query projection drifted: ${JSON.stringify(projected)}`,
        );
      }

      const constraints = await tx.execute<{
        definition: string;
        name: string;
      }>(
        sql`
          select conname as name, pg_get_constraintdef(oid) as definition
            from pg_constraint
           where conrelid = 'platform_draft'::regclass
             and conname in (
               'ck_platform_draft_exactly_one_origin',
               'ck_platform_draft_lane_position_applicability'
             )
           order by conname
        `,
      );
      const constraintText = constraints.rows
        .map((row) => `${row.name}:${row.definition}`)
        .join("\n");
      if (
        !constraintText.includes("market_analysis_handoff_id") ||
        !constraintText.includes("lane_position")
      ) {
        throw new Error("fourth-origin constraints are not installed");
      }

      const chartMedia = await findServableMedia(
        tx,
        workspaceId,
        ids.chartAsset,
      );
      const finalMedia = await findServableMedia(
        tx,
        workspaceId,
        ids.finalAsset,
      );
      if (!chartMedia || !finalMedia) {
        throw new Error("market media is not servable");
      }
      const ownedChart = await canReadOwnedMarketMedia(
        tx,
        workspaceId,
        actor,
        ids.chartAsset,
      );
      if (
        ownedChart?.role !== "chart" ||
        !(await canReadOwnedMarketMedia(
          tx,
          workspaceId,
          actor,
          ids.finalAsset,
        )) ||
        (await canReadOwnedMarketMedia(
          tx,
          workspaceId,
          "not-the-owner",
          ids.finalAsset,
        ))
      ) {
        throw new Error("market media ownership authorization drifted");
      }

      const variantId = await settleMarketCopyVariant(tx, operationId);
      await proveMarketCopyRetryPreconditions(tx, {
        analysisId: ids.analysis,
        platformDraftId: created.draft.id,
      });
      const revision = await executeDraftRevisionCommand(tx, workspaceId, {
        actorId: actor,
        platformDraftId: created.draft.id,
        commandKind: "submit_content",
        source: {
          kind: "copy_variant",
          id: variantId,
          contentLocale: "en",
        },
        content: {
          contentLocale: "en",
          headline: "Market caption headline",
          body: "Market caption body",
          hashtags: ["#market"],
        },
        idempotencyKey: "market-first-revision",
        requestHash: "market-first-revision-hash",
        expectedActive: { id: null, version: 0 },
      });
      if (
        revision.status !== "appended" ||
        revision.revision.selectedFinalMediaAssetId !== ids.finalAsset
      ) {
        throw new Error("market first revision did not seed handoff final");
      }

      observed.push(
        "fourth-origin-xor-null-lane-authority-current-policy-replay",
        "market-in-progress-handoff-copy-bind-execution-scope-first-revision-final",
        "market-copy-recovery-version-scope-replay-inflight-pinned-complete",
        "market-exact-saved-visible-lane-excluded",
        "market-final-owner-servable-nonowner-hidden",
        "editorial-route-market-rejected",
      );
      throw marketRollback;
    });
  } catch (error) {
    if (error !== marketRollback) throw error;
  }
}

async function proveMarketCopyRetryPreconditions(
  tx: Transaction,
  input: { analysisId: string; platformDraftId: string },
) {
  const versionResult = await tx.execute<{ version: number }>(sql`
    select version
      from market_analysis
     where workspace_id = ${workspaceId}::uuid
       and id = ${input.analysisId}::uuid
  `);
  const version = versionResult.rows[0]?.version;
  if (!version) throw new Error("market retry fixture has no analysis version");

  const baseRetryInput = copyInput(
    input.platformDraftId,
    "retry_failed",
    "market-caption-retry",
    "market-caption-retry-hash",
  );
  if (baseRetryInput.mode !== "retry_failed") {
    throw new Error("market caption retry fixture mode drifted");
  }
  const {
    mode: _retryMode,
    requestedContentLocale: _requestedContentLocale,
    ...recoveryBase
  } = baseRetryInput;
  const retryInput: StartCopyOperationInput = {
    ...recoveryBase,
    copyPolicy: {
      ...recoveryBase.copyPolicy,
      platforms: recoveryBase.copyPolicy.platforms.map((platform) => ({
        ...platform,
        variantKeys: ["first", "second", "third"],
      })),
    },
    marketAnalysis: {
      expectedVersion: version,
      id: input.analysisId,
    },
    mode: "recover_incomplete",
  };
  assertStatus(
    (
      await startCopyOperation(tx, workspaceId, {
        ...retryInput,
        idempotencyKey: "market-caption-retry-stale",
        marketAnalysis: {
          expectedVersion: version + 1,
          id: input.analysisId,
        },
        requestHash: "market-caption-retry-stale-hash",
      })
    ).status,
    "version_conflict",
    "market caption retry stale version",
  );
  assertStatus(
    (
      await startCopyOperation(tx, workspaceId, {
        ...retryInput,
        idempotencyKey: "market-caption-retry-wrong-analysis",
        marketAnalysis: {
          expectedVersion: version,
          id: randomUUID(),
        },
        requestHash: "market-caption-retry-wrong-analysis-hash",
      })
    ).status,
    "not_found",
    "market caption retry wrong analysis",
  );

  const created = await startCopyOperation(tx, workspaceId, retryInput);
  assertStatus(created.status, "created", "market caption retry");
  assertStatus(
    (await startCopyOperation(tx, workspaceId, retryInput)).status,
    "replayed",
    "market caption retry replay",
  );
  assertStatus(
    (
      await startCopyOperation(tx, workspaceId, {
        ...retryInput,
        idempotencyKey: "market-caption-retry-second",
        requestHash: "market-caption-retry-second-hash",
      })
    ).status,
    "operation_in_progress",
    "market caption retry in-flight guard",
  );
  if (!("operationId" in created)) {
    throw new Error("market caption recovery has no operation");
  }
  await settleMarketCaptionRecovery(tx, created.operationId);
  const recoveredGeneration = await tx.execute<{
    modelOptionKey: string;
    requestedContentLocale: string;
  }>(sql`
    select model_option_key as "modelOptionKey",
           requested_content_locale as "requestedContentLocale"
      from copy_generation
     where workspace_id = ${workspaceId}::uuid
       and operation_id = ${created.operationId}::uuid
  `);
  if (
    recoveredGeneration.rows[0]?.modelOptionKey !== "probe-model" ||
    recoveredGeneration.rows[0]?.requestedContentLocale !== "en"
  ) {
    throw new Error("market recovery did not pin persisted model and locale");
  }
  assertStatus(
    (
      await startCopyOperation(tx, workspaceId, {
        ...retryInput,
        idempotencyKey: "market-caption-retry-complete",
        requestHash: "market-caption-retry-complete-hash",
      })
    ).status,
    "already_complete",
    "market caption retry complete guard",
  );
}

async function settleMarketCaptionRecovery(
  tx: Transaction,
  operationId: string,
) {
  const unitResult = await tx.execute<{ id: string; variantKey: string }>(sql`
    select id, variant_key as "variantKey"
      from copy_generation_unit
     where workspace_id = ${workspaceId}::uuid
       and copy_generation_id = ${operationId}::uuid
  `);
  if (unitResult.rows.length !== 2) {
    throw new Error("market recovery did not create both missing units");
  }
  for (const [index, unit] of unitResult.rows.entries()) {
    const attemptId = randomUUID();
    await tx.execute(sql`
      insert into operation_attempt
        (id, workspace_id, operation_id, attempt_number, outcome)
      values (${attemptId}::uuid, ${workspaceId}::uuid, ${operationId}::uuid, ${index + 1}, 'succeeded')
    `);
    await tx.execute(sql`
      update copy_generation_unit
         set status = 'succeeded', operation_attempt_id = ${attemptId}::uuid
       where workspace_id = ${workspaceId}::uuid and id = ${unit.id}::uuid
    `);
    await tx.execute(sql`
      insert into copy_variant
        (id, workspace_id, copy_generation_unit_id, content_locale, headline, body, hashtags)
      values
        (${randomUUID()}::uuid, ${workspaceId}::uuid, ${unit.id}::uuid, 'en',
         ${`Recovered ${unit.variantKey}`}, 'Recovered market caption', array['#market']::text[])
    `);
  }
  const settled = await settleCopyGeneration(tx, workspaceId, operationId);
  if (settled?.lifecycle !== "succeeded") {
    throw new Error("market caption recovery did not settle");
  }
}

async function insertMarketFixture(
  tx: Transaction,
  ids: {
    analysis: string;
    analysisOperation: string;
    chartAsset: string;
    chartOperation: string;
    chartRender: string;
    finalAsset: string;
    generation: string;
    generationOperation: string;
    handoff: string;
    instrument: string;
    snapshot: string;
    snapshotOperation: string;
  },
) {
  const normalizedRequest = {
    period: "7d",
    scale: "relative",
    series: [
      {
        descriptorIdentity: "controlled:probe-market",
        role: "primary",
        displayName: "Probe Market",
        symbol: "PMK",
        controlledInstrumentId: ids.instrument,
        providerMappings: [
          {
            kind: "coinmarketcap_coin",
            provider: "coinmarketcap",
            coinId: 1,
            fallback: false,
          },
        ],
      },
    ],
  };
  await tx.execute(sql`
    insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash, lifecycle, attempt_seq, version)
    values
      (${ids.analysisOperation}::uuid, ${workspaceId}::uuid, ${actor}, 'market-analysis:create', 'market-create', 'market-create-hash', 'succeeded', 0, 1),
      (${ids.snapshotOperation}::uuid, ${workspaceId}::uuid, ${actor}, 'market-verification:probe', 'market-snapshot', 'market-snapshot-hash', 'succeeded', 0, 1),
      (${ids.chartOperation}::uuid, ${workspaceId}::uuid, ${actor}, 'market-chart-render:probe', 'market-chart', 'market-chart-hash', 'succeeded', 0, 1),
      (${ids.generationOperation}::uuid, ${workspaceId}::uuid, ${actor}, 'market-generation:analysis', 'market-generation', 'market-generation-hash', 'succeeded', 0, 1)
  `);
  await tx.execute(sql`
    insert into market_instrument
      (id, workspace_id, key, name, symbol, enabled, provider_mappings)
    values
      (${ids.instrument}::uuid, ${workspaceId}::uuid, 'probe-market', 'Probe Market', 'PMK', true, ${JSON.stringify(normalizedRequest.series[0]?.providerMappings)}::jsonb)
  `);
  await tx.execute(sql`
    insert into media_asset
      (id, workspace_id, kind, object_key, mime_type, declared_bytes, actual_bytes, checksum, width, height, lifecycle, verified_at)
    values
      (${ids.chartAsset}::uuid, ${workspaceId}::uuid, 'market_chart_render', ${`${workspaceId}/platform-draft-probe/${ids.chartAsset}`}, 'image/png', 100, 100, 'market-chart-checksum', 1080, 1350, 'verified', now()),
      (${ids.finalAsset}::uuid, ${workspaceId}::uuid, ${MARKET_GENERATION_FINAL_MEDIA_KIND}, ${`${workspaceId}/platform-draft-probe/${ids.finalAsset}`}, 'image/png', 100, 100, 'market-final-checksum', 1080, 1350, 'verified', now())
  `);
  await tx.execute(sql`
    insert into market_analysis
      (id, workspace_id, operation_id, media_brand_id, visual_owner_instrument_id, content_locale,
       normalized_request, request_fingerprint, chart_approval_fingerprint, chart_approved_at,
       chart_approved_by, template_fingerprint, catalog_fingerprint, instrument_profile_fingerprint,
       story_headline, story_supporting_text, story_approval_fingerprint, story_approved_at,
       story_approved_by, design_family_key, design_variant_key, image_option_key,
       design_approval_fingerprint, design_approved_at, design_approved_by,
       current_final_media_asset_id, final_approval_fingerprint,
       final_approved_at, final_approved_by)
    values
      (${ids.analysis}::uuid, ${workspaceId}::uuid, ${ids.analysisOperation}::uuid, ${brandId}::uuid,
       ${ids.instrument}::uuid, 'en', ${JSON.stringify(normalizedRequest)}::jsonb, 'market-request-fingerprint',
       'market-chart-fingerprint', now(), ${actor}, 'historical-template', 'historical-catalog',
       'historical-profile', 'Market headline', 'Verified supporting text', 'market-story-fingerprint',
       now(), ${actor}, 'growth', 'growth-a', 'probe-option', 'market-design-fingerprint', now(),
       ${actor}, ${ids.finalAsset}::uuid, 'market-final-fingerprint', now(), ${actor})
  `);
  await tx.execute(sql`
    insert into market_snapshot
      (id, workspace_id, market_analysis_id, operation_id, verification_intent_id,
       verification_intent_version, normalized_request, request_fingerprint, template_fingerprint,
       period, scale, fetch_completed_at, status, warnings)
    values
      (${ids.snapshot}::uuid, ${workspaceId}::uuid, ${ids.analysis}::uuid, ${ids.snapshotOperation}::uuid,
       ${ids.snapshotOperation}::uuid, 1, ${JSON.stringify(normalizedRequest)}::jsonb,
       'market-request-fingerprint', 'historical-template', '7d', 'relative', now(), 'verified', '[]'::jsonb)
  `);
  await tx.execute(sql`
    insert into market_chart_render
      (id, workspace_id, market_analysis_id, operation_id, expected_chart_fingerprint, render_contract_version)
    values
      (${ids.chartRender}::uuid, ${workspaceId}::uuid, ${ids.analysis}::uuid, ${ids.chartOperation}::uuid,
       'market-chart-fingerprint', 'probe-v1')
  `);
  await tx.execute(sql`
    update market_analysis
       set current_snapshot_id = ${ids.snapshot}::uuid,
           current_chart_render_id = ${ids.chartRender}::uuid
     where id = ${ids.analysis}::uuid
  `);
  await tx.execute(sql`
    update market_chart_render
       set media_asset_id = ${ids.chartAsset}::uuid, verified_at = now()
     where id = ${ids.chartRender}::uuid
  `);
  await tx.execute(sql`
    insert into market_generation
      (id, workspace_id, operation_id, market_analysis_id, intent_id, intent_version,
       expected_design_fingerprint, image_option_key, reference_sample_key,
       reference_sample_checksum, footer_lockup_key, footer_lockup_checksum,
       chart_media_asset_id, chart_media_checksum, output_width, output_height,
       final_media_asset_id)
    values
      (${ids.generation}::uuid, ${workspaceId}::uuid, ${ids.generationOperation}::uuid,
       ${ids.analysis}::uuid, ${ids.generationOperation}::uuid, 1, 'market-design-fingerprint',
       'probe-option', 'historical-sample-path', 'historical-sample', 'historical-lockup-path',
       'historical-lockup', ${ids.chartAsset}::uuid, 'market-chart-checksum', 1080, 1350,
       ${ids.finalAsset}::uuid)
  `);
  await tx.execute(sql`
    update market_analysis
       set current_generation_id = ${ids.generation}::uuid
     where id = ${ids.analysis}::uuid
  `);
  await tx.execute(sql`
    insert into market_analysis_handoff
      (id, workspace_id, market_analysis_id, approved_final_fingerprint, market_snapshot_id,
       media_brand_id, visual_owner_instrument_id, design_family_key, design_variant_key,
       content_locale, story_headline, story_supporting_text, verified_facts, template_fingerprint,
       catalog_fingerprint, instrument_profile_fingerprint, brand_policy_fingerprint,
       reference_sample_checksum, footer_lockup_checksum, image_option_key, market_chart_render_id,
       chart_media_asset_id, chart_media_checksum, final_media_asset_id, final_media_checksum,
       chart_approval_fingerprint, story_approval_fingerprint, design_approval_fingerprint)
    values
      (${ids.handoff}::uuid, ${workspaceId}::uuid, ${ids.analysis}::uuid, 'market-final-fingerprint',
       ${ids.snapshot}::uuid, ${brandId}::uuid, ${ids.instrument}::uuid, 'growth', 'growth-a', 'en',
       'Market headline', 'Verified supporting text', ${JSON.stringify({ symbols: ["PMK"], period: "7d", scale: "relative" })}::jsonb,
       'historical-template', 'historical-catalog', 'historical-profile', 'historical-brand-policy',
       'historical-sample', 'historical-lockup', 'probe-option', ${ids.chartRender}::uuid,
       ${ids.chartAsset}::uuid, 'market-chart-checksum', ${ids.finalAsset}::uuid,
       'market-final-checksum', 'market-chart-fingerprint', 'market-story-fingerprint',
       'market-design-fingerprint')
  `);
}

async function settleMarketCopyVariant(tx: Transaction, operationId: string) {
  const unitResult = await tx.execute<{ id: string }>(sql`
    select id
      from copy_generation_unit
     where workspace_id = ${workspaceId}::uuid
       and copy_generation_id = ${operationId}::uuid
     order by created_at, id
     limit 1
  `);
  const unitId = unitResult.rows[0]?.id;
  if (!unitId) throw new Error("market generation has no copy unit");
  const missingUnitResult = await tx.execute<{ id: string }>(sql`
    select id
      from copy_generation_unit
     where workspace_id = ${workspaceId}::uuid
       and copy_generation_id = ${operationId}::uuid
       and id <> ${unitId}::uuid
     order by created_at, id
  `);
  if (missingUnitResult.rows.length !== 2) {
    throw new Error("market generation does not have two missing copy units");
  }
  const attemptId = randomUUID();
  const variantId = randomUUID();
  await tx.execute(sql`
    insert into operation_attempt
      (id, workspace_id, operation_id, attempt_number, outcome)
    values (${attemptId}::uuid, ${workspaceId}::uuid, ${operationId}::uuid, 1, 'succeeded')
  `);
  await tx.execute(sql`
    update copy_generation_unit
       set status = 'succeeded', operation_attempt_id = ${attemptId}::uuid
     where workspace_id = ${workspaceId}::uuid and id = ${unitId}::uuid
  `);
  await tx.execute(sql`
    update copy_generation_unit
       set status = 'cancelled'
     where workspace_id = ${workspaceId}::uuid
       and copy_generation_id = ${operationId}::uuid
       and id <> ${unitId}::uuid
  `);
  await tx.execute(sql`
    insert into copy_variant
      (id, workspace_id, copy_generation_unit_id, content_locale, headline, body, hashtags)
    values
      (${variantId}::uuid, ${workspaceId}::uuid, ${unitId}::uuid, 'en',
       'Market caption headline', 'Market caption body', array['#market']::text[])
  `);
  const settled = await settleCopyGeneration(tx, workspaceId, operationId);
  if (settled?.lifecycle !== "succeeded") {
    throw new Error("market copy generation did not settle");
  }
  return variantId;
}

async function proveXor() {
  await client.query("begin");
  try {
    await expectConstraint(
      "zero-origin",
      `insert into platform_draft (id, workspace_id, media_brand_id, platform, lane_position, version) values ($1, $2, $3, 'x', 1, 1)`,
      [randomUUID(), workspaceId, brandId],
    );
    await expectConstraint(
      "two-origin",
      `insert into platform_draft (id, workspace_id, media_brand_id, platform, editorial_selection_id, promo_idea_id, lane_position, version) values ($1, $2, $3, 'x', $4, $5, 1, 1)`,
      [randomUUID(), workspaceId, brandId, selections[0], promoIdeaId],
    );
    observed.push("zero-two-origin-xor");
  } finally {
    await client.query("rollback");
  }
}

async function expectConstraint(
  label: string,
  query: string,
  values: unknown[],
  constraintName = "ck_platform_draft_exactly_one_origin",
) {
  await client.query("savepoint expected_failure");
  try {
    await client.query(query, values);
  } catch (error) {
    await client.query("rollback to savepoint expected_failure");
    if (
      error instanceof pg.DatabaseError &&
      error.constraint === constraintName
    )
      return;
    throw error;
  }
  await client.query("rollback to savepoint expected_failure");
  throw new Error(`${label} was accepted`);
}

async function insertFixture() {
  await client.query(
    `insert into "user" (id, name, email, email_verified, created_at, updated_at) values ($1, 'Platform Draft Probe', $2, true, now(), now())`,
    [actor, `${actor}@example.invalid`],
  );
  await client.query(
    "insert into workspace (id, name, customer_template_fingerprint, created_at, updated_at) values ($1, $2, 'probe-template', now(), now()), ($3, $4, 'probe-template', now(), now())",
    [
      workspaceId,
      `Platform Draft ${workspaceId}`,
      otherWorkspaceId,
      `Platform Draft ${otherWorkspaceId}`,
    ],
  );
  await client.query(
    `insert into media_brand (id, workspace_id, key, name, sort_order, created_at, updated_at) values ($1, $2, 'probe', 'Probe', 1, now(), now())`,
    [brandId, workspaceId],
  );
  await client.query(
    `insert into source (id, workspace_id, key, origin, endpoint, name, enabled, content_locale, article_fetch_mode, created_at, updated_at) values ($1, $2, 'probe', 'rss', 'https://example.invalid/feed', 'Probe', true, 'en', 'direct', now(), now())`,
    [sourceId, workspaceId],
  );
  for (const [index, itemId] of sourceItems.entries()) {
    await client.query(
      `insert into source_item (id, workspace_id, source_id, origin, external_id, title, url, attribution, content_locale, created_at, updated_at) values ($1, $2, $3, 'rss', $4, 'Probe', $5, 'Probe', 'en', now(), now())`,
      [
        itemId,
        workspaceId,
        sourceId,
        `probe-${index}`,
        `https://example.invalid/${index}`,
      ],
    );
    await client.query(
      `insert into source_item_revision (id, workspace_id, source_item_id, revision_number, title, summary, canonical_url, content_locale, content_hash, created_at, updated_at)
       values ($1, $2, $3, 1, 'Probe', 'Probe summary', $4, 'en', $5, now(), now())`,
      [
        sourceRevisions[index],
        workspaceId,
        itemId,
        `https://example.invalid/${index}`,
        `probe-content-${index}`,
      ],
    );
  }
  await client.query(
    `insert into operation (id, workspace_id, actor, command_type, idempotency_key, request_hash, lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
     values
       ($1, $2, $3, 'probe-analysis', 'analysis', 'analysis', 'succeeded', now(), 0, 1, now(), now()),
       ($4, $2, $3, 'probe-analysis', 'promo-analysis', 'promo-analysis', 'succeeded', now(), 0, 1, now(), now())`,
    [analysisOperationId, workspaceId, actor, promoOperationId],
  );
  await client.query(
    `insert into analysis_run (id, workspace_id, kind, operation_id, configuration, template_fingerprint, semantic_status, started_at, created_at, updated_at)
     values
       ($1, $2, 'news', $3, $4::jsonb, 'probe-template', 'skipped', now(), now(), now()),
       ($5, $2, 'promo', $6, $7::jsonb, 'probe-template', 'skipped', now(), now(), now())`,
    [
      analysisRunId,
      workspaceId,
      analysisOperationId,
      JSON.stringify({
        kind: "news",
        brands: ["probe"],
        models: ["probe-model"],
        platforms: ["telegram", "x"],
        sourceIds: [sourceId],
        windowHours: 24,
        enrichmentEnabled: true,
        telegramOnly: false,
        orderingMode: "views",
        topN: 10,
        topics: [],
      }),
      promoRunId,
      promoOperationId,
      JSON.stringify({
        kind: "promo",
        models: ["probe-model"],
        platforms: ["instagram"],
        promo: { brands: ["probe"], prompts: { probe: "Probe" } },
      }),
    ],
  );
  for (const [index, itemId] of sourceItems.entries()) {
    await client.query(
      `insert into analysis_run_item (id, workspace_id, analysis_run_id, source_item_id, source_item_revision_id, eligibility, created_at, updated_at)
       values ($1, $2, $3, $4, $5, 'candidate', now(), now())`,
      [
        randomUUID(),
        workspaceId,
        analysisRunId,
        itemId,
        sourceRevisions[index],
      ],
    );
  }
  await client.query(
    `insert into analysis_model_unit (id, workspace_id, analysis_run_id, media_brand_id, model_option_key, task_key, status, created_at, updated_at)
     values
       ($1, $2, $3, $4, 'probe-model', 'probe', 'succeeded', now(), now()),
       ($5, $2, $6, $4, 'probe-model', 'probe', 'succeeded', now(), now())`,
    [
      analysisUnitId,
      workspaceId,
      analysisRunId,
      brandId,
      promoUnitId,
      promoRunId,
    ],
  );
  for (const [index, selectionId] of selections.entries()) {
    await client.query(
      `insert into editorial_selection (id, workspace_id, analysis_model_unit_id, rank, source_item_id, suggested_platform, created_at, updated_at) values ($1, $2, $3, $4, $5, 'x', now(), now())`,
      [selectionId, workspaceId, analysisUnitId, index + 1, sourceItems[index]],
    );
  }
  await client.query(
    `insert into filter_result (id, workspace_id, analysis_run_id, source_item_id, media_brand_id, disposition, created_at, updated_at) values ($1, $2, $3, $4, $5, 'telegram_lane', now(), now()), ($6, $2, $3, $7, $5, 'low_score', now(), now())`,
    [
      filterResultId,
      workspaceId,
      analysisRunId,
      sourceItems[6],
      brandId,
      invalidFilterResultId,
      sourceItems[7],
    ],
  );
  await client.query(
    `insert into promo_idea (id, workspace_id, analysis_model_unit_id, rank, title, description, angle, created_at, updated_at) values ($1, $2, $3, 1, 'Probe', 'Probe', 'Probe', now(), now())`,
    [promoIdeaId, workspaceId, promoUnitId],
  );
}

async function cleanup() {
  await client.query(
    "update platform_draft set active_revision_id = null where workspace_id = $1",
    [workspaceId],
  );
  for (const table of [
    "draft_revision_command_receipt",
    "draft_revision",
    "copy_variant",
    "outbox_event",
    "copy_generation_unit",
    "copy_generation",
    "platform_draft",
    "editorial_selection",
    "promo_idea",
    "filter_result",
    "analysis_model_unit",
    "analysis_run_item",
    "analysis_run",
    "source_item_revision",
    "source_item",
    "source",
    "media_asset",
    "media_brand",
    "operation_attempt",
    "operation",
  ]) {
    await client.query(`delete from ${table} where workspace_id = $1`, [
      workspaceId,
    ]);
  }
  await client.query("delete from workspace where id in ($1, $2)", [
    workspaceId,
    otherWorkspaceId,
  ]);
  await client.query('delete from "user" where id = $1', [actor]);
}

async function cleanupStaleFixtures() {
  const staleWorkspace =
    "select id from workspace where name like 'Platform Draft %'";
  await client.query(
    `update platform_draft set active_revision_id = null where workspace_id in (${staleWorkspace})`,
  );
  for (const table of [
    "draft_revision_command_receipt",
    "draft_revision",
    "copy_variant",
    "outbox_event",
    "copy_generation_unit",
    "copy_generation",
    "platform_draft",
    "editorial_selection",
    "promo_idea",
    "filter_result",
    "analysis_model_unit",
    "analysis_run_item",
    "analysis_run",
    "source_item_revision",
    "source_item",
    "source",
    "media_asset",
    "media_brand",
    "operation_attempt",
    "operation",
  ]) {
    await client.query(
      `delete from ${table} where workspace_id in (${staleWorkspace})`,
    );
  }
  await client.query(`delete from workspace where id in (${staleWorkspace})`);
  await client.query(
    "delete from \"user\" where id like 'platform-draft-probe-%'",
  );
}
