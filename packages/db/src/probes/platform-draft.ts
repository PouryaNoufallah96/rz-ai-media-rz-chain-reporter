import { randomUUID } from "node:crypto";
import type {
  CardOriginReference,
  Platform,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import pg from "pg";

import { createDb } from "../index";
import {
  type StartCopyOperationInput,
  startCopyOperation,
} from "../repositories/copy-generation";
import {
  type ExecuteDraftRevisionCommandInput,
  executeDraftRevisionCommand,
  readDraftRevisionReceiptInFreshTransaction,
} from "../repositories/draft-revision";
import { routePlatformDraft } from "../repositories/platform-draft";

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
  observed.push("news-selected-platform-admission-no-effects");

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
  mode: StartCopyOperationInput["mode"],
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
    brandPolicyFingerprint: "probe-brand-policy",
    configurationVersion: "probe-configuration",
    customerTemplateFingerprint: "probe-template",
    promptVersion: "probe-prompt",
  };
  if (mode === "retry_failed") {
    return {
      ...base,
      ...versionIdentity,
      mode,
    };
  }
  return {
    ...base,
    ...versionIdentity,
    mode,
    requestedContentLocale: "en",
    modelOptionKey: "probe-model",
    variantKeys: ["first", "second"],
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
  await client.query(
    `update copy_generation
        set customer_template_fingerprint = 'obsolete-probe-template'
      where workspace_id = $1
        and operation_id = (
          select operation_id
            from copy_generation
           where workspace_id = $1 and platform_draft_id = $2
           order by created_at desc, operation_id desc
           limit 1
        )`,
    [workspaceId, platformDraftId],
  );
  const staleRetryKey = "retry-failed-template-drift";
  const staleRetry = await startCopyOperation(
    database.db,
    workspaceId,
    copyInput(
      platformDraftId,
      "retry_failed",
      staleRetryKey,
      `${staleRetryKey}-hash`,
    ),
  );
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

  const apply = revisionApplyInput(
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
    expectedLatest: {
      id: appended.revision.id,
      revisionNumber: appended.revision.revisionNumber,
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

  const editInput: ExecuteDraftRevisionCommandInput = {
    ...noOpInput,
    idempotencyKey: "revision-edit",
    requestHash: "revision-edit-hash",
    content: { ...noOpInput.content, body: "Probe editorial body edited" },
  };
  const edited = await executeDraftRevisionCommand(
    database.db,
    workspaceId,
    editInput,
  );
  assertStatus(edited.status, "appended", "revision direct edit");
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
    revisionApplyInput(
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
  const expectedLatest = {
    id: telegramFirst.revision.id,
    revisionNumber: telegramFirst.revision.revisionNumber,
  };
  const concurrentEdits = await Promise.all([
    executeDraftRevisionCommand(database.db, workspaceId, {
      actorId: actor,
      platformDraftId: input.telegramDraftId,
      commandKind: "submit_content",
      idempotencyKey: "telegram-edit-a",
      requestHash: "telegram-edit-a-hash",
      expectedLatest,
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
      expectedLatest,
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

  const firstRace = revisionApplyInput(
    input.firstRaceDraftId,
    firstRaceVariantId,
    "nested-savepoint-race",
    "nested-savepoint-race-hash",
    null,
  );
  const secondRace = revisionApplyInput(
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
  observed.push("revision-append-no-op-replay-conflict-savepoint-fresh-read");
}

function revisionApplyInput(
  platformDraftId: string,
  copyVariantId: string,
  idempotencyKey: string,
  requestHash: string,
  latest: { id: string; revisionNumber: number } | null,
): ExecuteDraftRevisionCommandInput {
  return {
    actorId: actor,
    platformDraftId,
    commandKind: "apply_copy_variant",
    copyVariantId,
    idempotencyKey,
    requestHash,
    expectedLatest: latest ?? { id: null, revisionNumber: null },
  };
}

async function seedSucceededVariant(platformDraftId: string, suffix: string) {
  await settleDraftOperations(platformDraftId);
  const unit = await client.query<{
    operationId: string;
    unitId: string;
  }>(
    `select generation.operation_id as "operationId", unit.id as "unitId"
       from copy_generation generation
       join copy_generation_unit unit on unit.copy_generation_id = generation.operation_id
      where generation.workspace_id = $1 and generation.platform_draft_id = $2 and unit.status = 'pending'
      order by generation.created_at, generation.operation_id, unit.created_at, unit.id
      limit 1`,
    [workspaceId, platformDraftId],
  );
  const row = unit.rows[0];
  if (!row) throw new Error(`${suffix} has no pending copy unit`);
  const attemptId = randomUUID();
  await client.query(
    `insert into operation_attempt (id, workspace_id, operation_id, attempt_number, outcome, created_at, updated_at)
     values ($1, $2, $3, 1, 'succeeded', now(), now())`,
    [attemptId, workspaceId, row.operationId],
  );
  await client.query(
    `update copy_generation_unit set status = 'succeeded', operation_attempt_id = $1, updated_at = now() where workspace_id = $2 and id = $3`,
    [attemptId, workspaceId, row.unitId],
  );
  const variantId = randomUUID();
  await client.query(
    `insert into copy_variant (id, workspace_id, copy_generation_unit_id, content_locale, headline, body, hashtags, created_at)
     values ($1, $2, $3, 'en', $4, $5, array['#probe', '#platform'], now())`,
    [
      variantId,
      workspaceId,
      row.unitId,
      `Probe ${suffix} headline`,
      `Probe ${suffix} body`,
    ],
  );
  return variantId;
}

async function assertRevisionRaceCounts(
  firstDraftId: string,
  secondDraftId: string,
  idempotencyKey: string,
) {
  const result = await client.query<{
    receipts: number;
    revisions: number;
  }>(
    `select
       (select count(*)::int from draft_revision_command_receipt where workspace_id = $1 and actor_id = $2 and command_kind = 'apply_copy_variant' and idempotency_key = $3) as receipts,
       (select count(*)::int from draft_revision where workspace_id = $1 and platform_draft_id in ($4, $5)) as revisions`,
    [workspaceId, actor, idempotencyKey, firstDraftId, secondDraftId],
  );
  const row = result.rows[0];
  if (row?.receipts !== 1 || row.revisions !== 1) {
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
        where workspace_id = $2 and actor_id = $3 and command_kind = 'apply_copy_variant' and idempotency_key = $4`,
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
) {
  await client.query("savepoint expected_failure");
  try {
    await client.query(query, values);
  } catch (error) {
    await client.query("rollback to savepoint expected_failure");
    if (
      error instanceof pg.DatabaseError &&
      error.constraint === "ck_platform_draft_exactly_one_origin"
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
