import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
  presentationTranslationRequestedPayloadSchema,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, eq, inArray } from "drizzle-orm";
import { DatabaseError } from "pg";

import type { Transaction } from "../executor";
import { createDb } from "../index";
import { insertPendingUsage } from "../repositories/ai-usage-event";
import {
  allocateEditorialPresentationTranslationAttempt,
  claimEditorialPresentationTranslation,
  completeEditorialPresentationTranslation,
  failEditorialPresentationTranslation,
  listStaleEditorialPresentationTranslations,
  loadEditorialPresentationTranslationRequest,
  readEditorialPresentationTranslationStatuses,
  settleStaleEditorialPresentationTranslation,
  startEditorialPresentationTranslation,
} from "../repositories/editorial-presentation-localization-request";
import {
  claimOutboxEvents,
  markOutboxFailed,
} from "../repositories/outbox-relay";
import { aiUsageEvent } from "../schema/ai-usage-event";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { analysisRunItem } from "../schema/analysis-run-item";
import { user } from "../schema/auth";
import { editorialPresentationLocalization } from "../schema/editorial-presentation-localization";
import { editorialPresentationLocalizationRequest } from "../schema/editorial-presentation-localization-request";
import { editorialSelection } from "../schema/editorial-selection";
import { filterResult } from "../schema/filter-result";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { promoIdea } from "../schema/promo-idea";
import { source } from "../schema/source";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 4 });
const ids = {
  workspace: randomUUID(),
  source: randomUUID(),
  firstSourceItem: randomUUID(),
  secondSourceItem: randomUUID(),
  pinnedSourceRevision: randomUUID(),
  newerSourceRevision: randomUUID(),
  secondSourceRevision: randomUUID(),
  mediaBrand: randomUUID(),
  newsOperation: randomUUID(),
  promoOperation: randomUUID(),
  newsRun: randomUUID(),
  promoRun: randomUUID(),
  newsUnit: randomUUID(),
  promoUnit: randomUUID(),
  selection: randomUUID(),
  telegramFilter: randomUUID(),
  invalidTelegramFilter: randomUUID(),
  promoIdea: randomUUID(),
};
const owner = `presentation-translation-owner-${randomUUID()}`;
const intruder = `presentation-translation-intruder-${randomUUID()}`;

try {
  await database.db.transaction(insertFixture);
  await verifyRequestConstraints();

  const native = await start({
    idempotencyKey: "native-selection",
    origin: {
      kind: "editorial_selection",
      editorialSelectionId: ids.selection,
    },
    presentationLocale: "en",
    requestHash: "native-selection",
  });
  assert.equal(native.status, "already_available");

  const wrongOwner = await start(
    {
      idempotencyKey: "wrong-owner",
      origin: {
        kind: "editorial_selection",
        editorialSelectionId: ids.selection,
      },
      presentationLocale: "fa",
      requestHash: "wrong-owner",
    },
    intruder,
  );
  assert.equal(wrongOwner.status, "not_found");

  const invalidOrigin = await start({
    idempotencyKey: "invalid-telegram",
    origin: {
      kind: "telegram_filter_result",
      telegramFilterResultId: ids.invalidTelegramFilter,
    },
    presentationLocale: "fa",
    requestHash: "invalid-telegram",
  });
  assert.equal(invalidOrigin.status, "invalid_origin");

  const created = await start({
    idempotencyKey: "selection-fa",
    origin: {
      kind: "editorial_selection",
      editorialSelectionId: ids.selection,
    },
    presentationLocale: "fa",
    requestHash: "selection-fa",
  });
  assert.equal(created.status, "created");
  const selectionOperationId = created.operationId;

  const replayed = await start({
    idempotencyKey: "selection-fa",
    origin: {
      kind: "editorial_selection",
      editorialSelectionId: ids.selection,
    },
    presentationLocale: "fa",
    requestHash: "selection-fa",
  });
  assert.equal(replayed.status, "replayed");
  assert.equal(replayed.operationId, selectionOperationId);

  const mismatch = await start({
    idempotencyKey: "selection-fa",
    origin: {
      kind: "editorial_selection",
      editorialSelectionId: ids.selection,
    },
    presentationLocale: "fa",
    requestHash: "selection-fa-changed",
  });
  assert.equal(mismatch.status, "idempotency_mismatch");

  const [requestRow] = await database.db
    .select()
    .from(editorialPresentationLocalizationRequest)
    .where(
      and(
        eq(editorialPresentationLocalizationRequest.workspaceId, ids.workspace),
        eq(
          editorialPresentationLocalizationRequest.operationId,
          selectionOperationId,
        ),
      ),
    );
  assert.equal(requestRow?.editorialSelectionId, ids.selection);
  const [eventRow] = await database.db
    .select()
    .from(outboxEvent)
    .where(eq(outboxEvent.operationId, selectionOperationId));
  assert.equal(
    eventRow?.eventType,
    OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
  );
  assert.deepEqual(
    presentationTranslationRequestedPayloadSchema.parse(eventRow?.payload),
    {
      schemaVersion: 1,
      workspaceId: ids.workspace,
      operationId: selectionOperationId,
    },
  );

  const selectionContext = await loadEditorialPresentationTranslationRequest(
    database.db,
    ids.workspace,
    selectionOperationId,
  );
  assert.equal(selectionContext.status, "ready");
  assert.equal(selectionContext.analysisRunId, ids.newsRun);
  assert.equal(selectionContext.card.kind, "editorial_selection");
  assert.equal(
    selectionContext.card.source.sourceItemRevisionId,
    ids.pinnedSourceRevision,
  );
  assert.equal(selectionContext.card.source.title, "Pinned English title");
  assert.deepEqual(
    selectionContext.missingSubjects.map((subject) => subject.kind),
    ["source_item_revision", "editorial_selection"],
  );

  const telegram = await start({
    idempotencyKey: "telegram-fa",
    origin: {
      kind: "telegram_filter_result",
      telegramFilterResultId: ids.telegramFilter,
    },
    presentationLocale: "fa",
    requestHash: "telegram-fa",
  });
  assert.equal(telegram.status, "created");
  const telegramContext = await loadEditorialPresentationTranslationRequest(
    database.db,
    ids.workspace,
    telegram.operationId,
  );
  assert.equal(telegramContext.status, "ready");
  assert.deepEqual(
    telegramContext.missingSubjects.map((subject) => subject.kind),
    ["source_item_revision"],
  );

  const now = new Date();
  const claimed = await claimEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      operationId: selectionOperationId,
      claimedBy: "presentation-translation-probe",
      now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    },
  );
  assert.equal(claimed.status, "claimed");
  const claimFence = {
    claimedBy: "presentation-translation-probe",
    expectedVersion: claimed.operation.version,
  };
  const selectionAttemptId = randomUUID();
  const allocated = await allocateEditorialPresentationTranslationAttempt(
    database.db,
    ids.workspace,
    selectionOperationId,
    selectionAttemptId,
    claimFence,
  );
  assert.equal(allocated.status, "allocated");
  assert.equal(allocated.reused, false);
  const replayedAllocation =
    await allocateEditorialPresentationTranslationAttempt(
      database.db,
      ids.workspace,
      selectionOperationId,
      selectionAttemptId,
      claimFence,
    );
  assert.equal(replayedAllocation.status, "allocated");
  assert.equal(replayedAllocation.reused, true);
  assert.equal(replayedAllocation.attempt.id, allocated.attempt.id);
  assert.equal(replayedAllocation.attempt.attemptNumber, 1);

  await database.db.insert(editorialPresentationLocalization).values({
    id: randomUUID(),
    workspaceId: ids.workspace,
    sourceItemRevisionId: ids.pinnedSourceRevision,
    presentationLocale: "fa",
    operationAttemptId: allocated.attempt.id,
    title: "عنوان فارسی موجود",
    summary: "خلاصه فارسی موجود",
  });
  const selectionOnlyContext =
    await loadEditorialPresentationTranslationRequest(
      database.db,
      ids.workspace,
      selectionOperationId,
    );
  assert.equal(selectionOnlyContext.status, "ready");
  assert.deepEqual(
    selectionOnlyContext.missingSubjects.map((subject) => subject.kind),
    ["editorial_selection"],
  );
  await database.db
    .delete(editorialPresentationLocalization)
    .where(
      and(
        eq(editorialPresentationLocalization.workspaceId, ids.workspace),
        eq(
          editorialPresentationLocalization.sourceItemRevisionId,
          ids.pinnedSourceRevision,
        ),
        eq(editorialPresentationLocalization.presentationLocale, "fa"),
      ),
    );

  await database.db.insert(editorialPresentationLocalization).values({
    id: randomUUID(),
    workspaceId: ids.workspace,
    editorialSelectionId: ids.selection,
    presentationLocale: "fa",
    operationAttemptId: allocated.attempt.id,
    reasoning: "دلیل فارسی موجود",
  });
  const sourceOnlyContext = await loadEditorialPresentationTranslationRequest(
    database.db,
    ids.workspace,
    selectionOperationId,
  );
  assert.equal(sourceOnlyContext.status, "ready");
  assert.deepEqual(
    sourceOnlyContext.missingSubjects.map((subject) => subject.kind),
    ["source_item_revision"],
  );
  await database.db
    .delete(editorialPresentationLocalization)
    .where(
      and(
        eq(editorialPresentationLocalization.workspaceId, ids.workspace),
        eq(
          editorialPresentationLocalization.editorialSelectionId,
          ids.selection,
        ),
        eq(editorialPresentationLocalization.presentationLocale, "fa"),
      ),
    );

  const completed = await completeEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      operationId: selectionOperationId,
      operationAttemptId: allocated.attempt.id,
      claimFence,
      localizations: [
        {
          kind: "source_item_revision",
          sourceItemRevisionId: ids.pinnedSourceRevision,
          title: "عنوان فارسی",
          summary: "خلاصه فارسی",
        },
        {
          kind: "editorial_selection",
          editorialSelectionId: ids.selection,
          reasoning: "دلیل فارسی",
        },
      ],
    },
  );
  assert.equal(completed.status, "persisted");
  const settledAllocation =
    await allocateEditorialPresentationTranslationAttempt(
      database.db,
      ids.workspace,
      selectionOperationId,
      selectionAttemptId,
      claimFence,
    );
  assert.equal(settledAllocation.status, "claim_lost");
  const selectionAttempts = await database.db
    .select({ id: operationAttempt.id })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, ids.workspace),
        eq(operationAttempt.operationId, selectionOperationId),
      ),
    );
  assert.deepEqual(selectionAttempts, [{ id: selectionAttemptId }]);

  const telegramClaimed = await claimEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      operationId: telegram.operationId,
      claimedBy: "presentation-translation-collision-probe",
      now: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  );
  assert.equal(telegramClaimed.status, "claimed");
  const foreignPendingAttemptId = randomUUID();
  await database.db.insert(operationAttempt).values({
    id: foreignPendingAttemptId,
    workspaceId: ids.workspace,
    operationId: selectionOperationId,
    attemptNumber: 2,
  });
  const foreignAttemptSettlement = await failEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      claimFence: {
        claimedBy: "presentation-translation-collision-probe",
        expectedVersion: telegramClaimed.operation.version,
      },
      failureCode: "INTERNAL_SERVER_ERROR",
      operationAttemptId: foreignPendingAttemptId,
      operationId: telegram.operationId,
      outcome: "failed_terminal",
    },
  );
  assert.equal(foreignAttemptSettlement.status, "invalid_output");
  const [foreignAttempt] = await database.db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(eq(operationAttempt.id, foreignPendingAttemptId));
  assert.equal(foreignAttempt?.outcome, null);
  const conflictingAllocation =
    await allocateEditorialPresentationTranslationAttempt(
      database.db,
      ids.workspace,
      telegram.operationId,
      selectionAttemptId,
      {
        claimedBy: "presentation-translation-collision-probe",
        expectedVersion: telegramClaimed.operation.version,
      },
    );
  assert.equal(conflictingAllocation.status, "attempt_id_conflict");
  const interruptedAttemptId = randomUUID();
  const interruptedAllocation =
    await allocateEditorialPresentationTranslationAttempt(
      database.db,
      ids.workspace,
      telegram.operationId,
      interruptedAttemptId,
      {
        claimedBy: "presentation-translation-collision-probe",
        expectedVersion: telegramClaimed.operation.version,
      },
    );
  assert.equal(interruptedAllocation.status, "allocated");
  const pendingUsage = await insertPendingUsage(database.db, ids.workspace, {
    apiKind: "chat",
    backend: "remote",
    invocationKey: "primary",
    operationAttemptId: interruptedAttemptId,
    operationId: telegram.operationId,
    providerGateway: "openrouter",
    requestedModel: "openai/gpt-4o-mini",
    taskKey: "text-translation",
  });
  assert.equal(pendingUsage.inserted, true);
  const staleNow = new Date(Date.now() + 120_000);
  const staleCandidates = await listStaleEditorialPresentationTranslations(
    database.db,
    ids.workspace,
    { limit: 10, now: staleNow },
  );
  const staleTelegram = staleCandidates.find(
    (candidate) => candidate.operationId === telegram.operationId,
  );
  assert(staleTelegram);
  const guardedOut = await settleStaleEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      claimedBy: staleTelegram.claimedBy,
      expectedVersion: staleTelegram.operationVersion + 1,
      now: staleNow,
      operationId: telegram.operationId,
    },
  );
  assert.equal(guardedOut.status, "claim_lost");
  const recoveredTelegramFailure =
    await settleStaleEditorialPresentationTranslation(
      database.db,
      ids.workspace,
      {
        claimedBy: staleTelegram.claimedBy,
        expectedVersion: staleTelegram.operationVersion,
        now: staleNow,
        operationId: telegram.operationId,
      },
    );
  assert.equal(recoveredTelegramFailure.status, "settled");
  assert.equal(recoveredTelegramFailure.lifecycle, "unknown");
  assert.deepEqual(
    await settleStaleEditorialPresentationTranslation(
      database.db,
      ids.workspace,
      {
        claimedBy: staleTelegram.claimedBy,
        expectedVersion: staleTelegram.operationVersion,
        now: staleNow,
        operationId: telegram.operationId,
      },
    ),
    recoveredTelegramFailure,
  );
  const [interruptedAttempt] = await database.db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(eq(operationAttempt.id, interruptedAttemptId));
  assert.equal(interruptedAttempt?.outcome, "ambiguous");
  const [interruptedUsage] = await database.db
    .select({ status: aiUsageEvent.status })
    .from(aiUsageEvent)
    .where(eq(aiUsageEvent.id, pendingUsage.event.id));
  assert.equal(interruptedUsage?.status, "unknown");

  const completeContext = await loadEditorialPresentationTranslationRequest(
    database.db,
    ids.workspace,
    selectionOperationId,
  );
  assert.equal(completeContext.status, "ready");
  assert.equal(completeContext.missingSubjects.length, 0);
  const alreadyLocalized = await start({
    idempotencyKey: "selection-fa-after-success",
    origin: {
      kind: "editorial_selection",
      editorialSelectionId: ids.selection,
    },
    presentationLocale: "fa",
    requestHash: "selection-fa-after-success",
  });
  assert.equal(alreadyLocalized.status, "already_available");

  const promoNative = await start({
    idempotencyKey: "promo-en",
    origin: { kind: "promo_idea", promoIdeaId: ids.promoIdea },
    presentationLocale: "en",
    requestHash: "promo-en",
  });
  assert.equal(promoNative.status, "already_available");

  const [firstConcurrent, secondConcurrent] = await Promise.all([
    start({
      idempotencyKey: "promo-fa-a",
      origin: { kind: "promo_idea", promoIdeaId: ids.promoIdea },
      presentationLocale: "fa",
      requestHash: "promo-fa-a",
    }),
    start({
      idempotencyKey: "promo-fa-b",
      origin: { kind: "promo_idea", promoIdeaId: ids.promoIdea },
      presentationLocale: "fa",
      requestHash: "promo-fa-b",
    }),
  ]);
  assert.deepEqual([firstConcurrent.status, secondConcurrent.status].sort(), [
    "created",
    "replayed",
  ]);
  assert.ok("operationId" in firstConcurrent);
  assert.ok("operationId" in secondConcurrent);
  assert.equal(firstConcurrent.operationId, secondConcurrent.operationId);
  const firstPromoOperationId = firstConcurrent.operationId;

  const promoContext = await loadEditorialPresentationTranslationRequest(
    database.db,
    ids.workspace,
    firstPromoOperationId,
  );
  assert.equal(promoContext.status, "ready");
  assert.equal(promoContext.analysisRunId, ids.promoRun);
  assert.deepEqual(
    promoContext.missingSubjects.map((subject) => subject.kind),
    ["promo_idea"],
  );

  const promoClaimed = await claimEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      operationId: firstPromoOperationId,
      claimedBy: "presentation-translation-known-failure-probe",
      now: new Date(),
      leaseExpiresAt: new Date(Date.now() + 60_000),
    },
  );
  assert.equal(promoClaimed.status, "claimed");
  const promoAttemptId = randomUUID();
  const promoAttempt = await allocateEditorialPresentationTranslationAttempt(
    database.db,
    ids.workspace,
    firstPromoOperationId,
    promoAttemptId,
    {
      claimedBy: "presentation-translation-known-failure-probe",
      expectedVersion: promoClaimed.operation.version,
    },
  );
  assert.equal(promoAttempt.status, "allocated");
  const failed = await failEditorialPresentationTranslation(
    database.db,
    ids.workspace,
    {
      operationId: firstPromoOperationId,
      operationAttemptId: promoAttempt.attempt.id,
      claimFence: {
        claimedBy: "presentation-translation-known-failure-probe",
        expectedVersion: promoClaimed.operation.version,
      },
      failureCode: "STRUCTURED_OUTPUT_INVALID",
      outcome: "failed_terminal",
    },
  );
  assert.equal(failed.status, "settled");
  assert.equal(failed.lifecycle, "failed");
  const [failedAttempt] = await database.db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(eq(operationAttempt.id, promoAttemptId));
  assert.deepEqual(failedAttempt, {
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    outcome: "failed_terminal",
  });

  const retry = await start({
    idempotencyKey: "promo-fa-retry",
    origin: { kind: "promo_idea", promoIdeaId: ids.promoIdea },
    presentationLocale: "fa",
    requestHash: "promo-fa-retry",
  });
  assert.equal(retry.status, "created");
  assert.notEqual(retry.operationId, firstPromoOperationId);

  const promoOrigin = {
    kind: "promo_idea" as const,
    promoIdeaId: ids.promoIdea,
  };
  assert.deepEqual(
    await readEditorialPresentationTranslationStatuses(
      database.db,
      ids.workspace,
      owner,
      [promoOrigin],
      "fa",
    ),
    [
      {
        dispatchState: "undispatched",
        lifecycle: "queued",
        operationId: retry.operationId,
        origin: promoOrigin,
      },
    ],
  );

  const relayClaimedBy = "presentation-translation-exhaustion-probe";
  const relayNow = new Date(Date.now() + 1_000);
  const claimedEvents = await claimOutboxEvents(database.db, ids.workspace, {
    claimedBy: relayClaimedBy,
    leaseDurationMs: 60_000,
    limit: 100,
    now: relayNow,
  });
  const retryEvent = claimedEvents.find(
    (event) => event.operationId === retry.operationId,
  );
  assert(retryEvent);
  const exhausted = await markOutboxFailed(database.db, ids.workspace, {
    id: retryEvent.id,
    claimedBy: relayClaimedBy,
    errorCode: "SEND_FAILED",
    nextAttemptAt: relayNow,
    exhausted: true,
    failedAt: relayNow,
  });
  assert.equal(exhausted.status, "updated");
  assert.deepEqual(
    await readEditorialPresentationTranslationStatuses(
      database.db,
      ids.workspace,
      owner,
      [promoOrigin],
      "fa",
    ),
    [
      {
        dispatchState: "exhausted",
        lifecycle: "queued",
        operationId: retry.operationId,
        origin: promoOrigin,
      },
    ],
  );

  const exhaustedRetry = await start({
    idempotencyKey: "promo-fa-exhausted-retry",
    origin: promoOrigin,
    presentationLocale: "fa",
    requestHash: "promo-fa-exhausted-retry",
  });
  assert.equal(exhaustedRetry.status, "replayed");
  assert.equal(exhaustedRetry.operationId, retry.operationId);
  assert.deepEqual(
    await readEditorialPresentationTranslationStatuses(
      database.db,
      ids.workspace,
      owner,
      [promoOrigin],
      "fa",
    ),
    [
      {
        dispatchState: "delayed",
        lifecycle: "queued",
        operationId: retry.operationId,
        origin: promoOrigin,
      },
    ],
  );
  const [rearmedEvent] = await database.db
    .select({ exhaustedAt: outboxEvent.exhaustedAt, id: outboxEvent.id })
    .from(outboxEvent)
    .where(eq(outboxEvent.operationId, retry.operationId));
  assert.equal(rearmedEvent?.id, retryEvent.id);
  assert.equal(rearmedEvent?.exhaustedAt, null);

  const promoRequests = await database.db
    .select({
      operationId: editorialPresentationLocalizationRequest.operationId,
    })
    .from(editorialPresentationLocalizationRequest)
    .where(
      and(
        eq(editorialPresentationLocalizationRequest.workspaceId, ids.workspace),
        eq(editorialPresentationLocalizationRequest.promoIdeaId, ids.promoIdea),
        eq(editorialPresentationLocalizationRequest.presentationLocale, "fa"),
      ),
    );
  assert.equal(promoRequests.length, 2);

  console.log(
    JSON.stringify({
      alreadyAvailable: true,
      ambiguousFailureSettlement: true,
      authoritativePinnedRevision: true,
      atomicCompletion: true,
      attemptOwnership: true,
      attemptIdCollisionRejected: true,
      constraintCoverage: 2,
      dispatchStatusProjection: true,
      durableEvent: true,
      exhaustedDispatchRearm: true,
      failedRetry: true,
      knownFailureSettlement: true,
      deterministicAttemptReplay: true,
      idempotentReplay: true,
      nonterminalDedupe: true,
      ownership: true,
      partialLocalizationReload: true,
      staleSettlementGuarded: true,
      staleSettlementIdempotent: true,
      requestOrigins: 3,
    }),
  );
} finally {
  await cleanup();
  await database.close();
}

function start(
  input: Omit<
    Parameters<typeof startEditorialPresentationTranslation>[2],
    "actor" | "requestId"
  >,
  actor = owner,
) {
  return startEditorialPresentationTranslation(database.db, ids.workspace, {
    ...input,
    actor,
    requestId: randomUUID(),
  });
}

async function verifyRequestConstraints() {
  await expectConstraint(
    "ck_presentation_translation_request_exactly_one_origin",
    async (tx) => {
      const operationId = await insertProbeOperation(tx, "invalid-shape");
      await tx.insert(editorialPresentationLocalizationRequest).values({
        operationId,
        workspaceId: ids.workspace,
        editorialSelectionId: ids.selection,
        promoIdeaId: ids.promoIdea,
        presentationLocale: "fa",
      });
    },
  );
  await expectConstraint(
    "fk_presentation_translation_request_selection_id",
    async (tx) => {
      const operationId = await insertProbeOperation(tx, "missing-origin");
      await tx.insert(editorialPresentationLocalizationRequest).values({
        operationId,
        workspaceId: ids.workspace,
        editorialSelectionId: randomUUID(),
        presentationLocale: "fa",
      });
    },
  );
}

async function expectConstraint(
  expected: string,
  action: (tx: Transaction) => Promise<void>,
) {
  await assert.rejects(
    database.db.transaction(action),
    (error: unknown) => constraintName(error) === expected,
  );
}

async function insertProbeOperation(tx: Transaction, key: string) {
  const operationId = randomUUID();
  await tx.insert(operation).values({
    id: operationId,
    workspaceId: ids.workspace,
    actor: owner,
    commandType: `presentation-translation-constraint:${key}`,
    idempotencyKey: key,
    requestHash: key,
    lifecycle: "queued",
  });
  return operationId;
}

function constraintName(error: unknown) {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof DatabaseError) return current.constraint;
    current = current.cause;
  }
  return undefined;
}

async function insertFixture(tx: Transaction) {
  await tx.insert(user).values([
    {
      id: owner,
      email: `${owner}@example.test`,
      name: "Presentation Translation Owner",
    },
    {
      id: intruder,
      email: `${intruder}@example.test`,
      name: "Presentation Translation Intruder",
    },
  ]);
  await tx.insert(workspace).values({
    id: ids.workspace,
    name: `Presentation Translation Probe ${ids.workspace}`,
  });
  await tx.insert(source).values({
    id: ids.source,
    workspaceId: ids.workspace,
    articleFetchMode: "direct",
    contentLocale: "en",
    endpoint: "https://presentation-translation.example.test/rss",
    key: `presentation-translation-${ids.source}`,
    name: "Presentation Translation Probe",
    origin: "rss",
  });
  await tx.insert(sourceItem).values([
    {
      id: ids.firstSourceItem,
      workspaceId: ids.workspace,
      attribution: "Presentation Translation Probe",
      contentLocale: "en",
      externalId: "presentation-translation-first",
      origin: "rss",
      sourceId: ids.source,
      title: "First source item",
      url: "https://presentation-translation.example.test/first",
    },
    {
      id: ids.secondSourceItem,
      workspaceId: ids.workspace,
      attribution: "Presentation Translation Probe",
      contentLocale: "en",
      externalId: "presentation-translation-second",
      origin: "rss",
      sourceId: ids.source,
      title: "Second source item",
      url: "https://presentation-translation.example.test/second",
    },
  ]);
  await tx.insert(sourceItemRevision).values([
    {
      id: ids.pinnedSourceRevision,
      workspaceId: ids.workspace,
      canonicalUrl: "https://presentation-translation.example.test/first",
      contentHash: "presentation-translation-pinned",
      contentLocale: "en",
      revisionNumber: 1,
      sourceItemId: ids.firstSourceItem,
      summary: "Pinned English summary",
      title: "Pinned English title",
    },
    {
      id: ids.newerSourceRevision,
      workspaceId: ids.workspace,
      canonicalUrl: "https://presentation-translation.example.test/first",
      contentHash: "presentation-translation-newer",
      contentLocale: "fa",
      revisionNumber: 2,
      sourceItemId: ids.firstSourceItem,
      summary: "خلاصه جدید",
      title: "عنوان جدید",
    },
    {
      id: ids.secondSourceRevision,
      workspaceId: ids.workspace,
      canonicalUrl: "https://presentation-translation.example.test/second",
      contentHash: "presentation-translation-second",
      contentLocale: "en",
      revisionNumber: 1,
      sourceItemId: ids.secondSourceItem,
      summary: "Second English summary",
      title: "Second English title",
    },
  ]);
  await tx.insert(mediaBrand).values({
    id: ids.mediaBrand,
    workspaceId: ids.workspace,
    key: `presentation-translation-${ids.mediaBrand}`,
    name: "Presentation Translation Probe",
    sortOrder: 1,
  });
  await tx.insert(operation).values([
    {
      id: ids.newsOperation,
      workspaceId: ids.workspace,
      actor: owner,
      commandType: "analysis-run:news",
      idempotencyKey: "presentation-translation-news",
      requestHash: "presentation-translation-news",
      lifecycle: "succeeded",
    },
    {
      id: ids.promoOperation,
      workspaceId: ids.workspace,
      actor: owner,
      commandType: "analysis-run:promo",
      idempotencyKey: "presentation-translation-promo",
      requestHash: "presentation-translation-promo",
      lifecycle: "succeeded",
    },
  ]);
  await tx.insert(analysisRun).values([
    {
      id: ids.newsRun,
      workspaceId: ids.workspace,
      kind: "news",
      operationId: ids.newsOperation,
      configuration: {
        kind: "news",
        brands: [`presentation-translation-${ids.mediaBrand}`],
        models: ["probe"],
        platforms: ["x"],
        sourceIds: [ids.source],
        windowHours: 24,
        enrichmentEnabled: false,
        telegramOnly: false,
        orderingMode: "latest",
        topN: 20,
        topics: [],
      },
      semanticStatus: "skipped",
      templateFingerprint: "presentation-translation-news",
    },
    {
      id: ids.promoRun,
      workspaceId: ids.workspace,
      kind: "promo",
      operationId: ids.promoOperation,
      configuration: {
        kind: "promo",
        models: ["probe"],
        platforms: ["x"],
        promo: {
          brands: [`presentation-translation-${ids.mediaBrand}`],
          prompts: {
            [`presentation-translation-${ids.mediaBrand}`]: "Probe promo",
          },
        },
      },
      semanticStatus: "skipped",
      templateFingerprint: "presentation-translation-promo",
    },
  ]);
  await tx.insert(analysisRunItem).values([
    {
      workspaceId: ids.workspace,
      analysisRunId: ids.newsRun,
      sourceItemId: ids.firstSourceItem,
      sourceItemRevisionId: ids.pinnedSourceRevision,
      eligibility: "candidate",
    },
    {
      workspaceId: ids.workspace,
      analysisRunId: ids.newsRun,
      sourceItemId: ids.secondSourceItem,
      sourceItemRevisionId: ids.secondSourceRevision,
      eligibility: "candidate",
    },
  ]);
  await tx.insert(analysisModelUnit).values([
    {
      id: ids.newsUnit,
      workspaceId: ids.workspace,
      analysisRunId: ids.newsRun,
      mediaBrandId: ids.mediaBrand,
      modelOptionKey: "probe",
      taskKey: "news-selection:probe",
      status: "succeeded",
    },
    {
      id: ids.promoUnit,
      workspaceId: ids.workspace,
      analysisRunId: ids.promoRun,
      mediaBrandId: ids.mediaBrand,
      modelOptionKey: "probe",
      taskKey: "promo-ideas:probe",
      status: "succeeded",
    },
  ]);
  await tx.insert(editorialSelection).values({
    id: ids.selection,
    workspaceId: ids.workspace,
    analysisModelUnitId: ids.newsUnit,
    rank: 1,
    reasoning: "Authoritative English reasoning",
    sourceItemId: ids.firstSourceItem,
    suggestedPlatform: "x",
  });
  await tx.insert(filterResult).values([
    {
      id: ids.telegramFilter,
      workspaceId: ids.workspace,
      analysisRunId: ids.newsRun,
      sourceItemId: ids.firstSourceItem,
      mediaBrandId: ids.mediaBrand,
      disposition: "telegram_lane",
    },
    {
      id: ids.invalidTelegramFilter,
      workspaceId: ids.workspace,
      analysisRunId: ids.newsRun,
      sourceItemId: ids.secondSourceItem,
      mediaBrandId: ids.mediaBrand,
      disposition: "shortlisted",
    },
  ]);
  await tx.insert(promoIdea).values({
    id: ids.promoIdea,
    workspaceId: ids.workspace,
    analysisModelUnitId: ids.promoUnit,
    rank: 1,
    title: "Authoritative promo title",
    description: "Authoritative promo description",
    angle: "Authoritative promo angle",
  });
}

async function cleanup() {
  await database.db.transaction(async (tx) => {
    await tx
      .delete(editorialPresentationLocalization)
      .where(eq(editorialPresentationLocalization.workspaceId, ids.workspace));
    await tx
      .delete(editorialPresentationLocalizationRequest)
      .where(
        eq(editorialPresentationLocalizationRequest.workspaceId, ids.workspace),
      );
    await tx
      .delete(outboxEvent)
      .where(eq(outboxEvent.workspaceId, ids.workspace));
    await tx
      .delete(aiUsageEvent)
      .where(eq(aiUsageEvent.workspaceId, ids.workspace));
    await tx
      .delete(operationAttempt)
      .where(eq(operationAttempt.workspaceId, ids.workspace));
    await tx
      .delete(editorialSelection)
      .where(eq(editorialSelection.workspaceId, ids.workspace));
    await tx
      .delete(filterResult)
      .where(eq(filterResult.workspaceId, ids.workspace));
    await tx.delete(promoIdea).where(eq(promoIdea.workspaceId, ids.workspace));
    await tx
      .delete(analysisRunItem)
      .where(eq(analysisRunItem.workspaceId, ids.workspace));
    await tx
      .delete(analysisModelUnit)
      .where(eq(analysisModelUnit.workspaceId, ids.workspace));
    await tx
      .delete(analysisRun)
      .where(eq(analysisRun.workspaceId, ids.workspace));
    await tx.delete(operation).where(eq(operation.workspaceId, ids.workspace));
    await tx
      .delete(sourceItemRevision)
      .where(eq(sourceItemRevision.workspaceId, ids.workspace));
    await tx
      .delete(sourceItem)
      .where(eq(sourceItem.workspaceId, ids.workspace));
    await tx.delete(source).where(eq(source.workspaceId, ids.workspace));
    await tx
      .delete(mediaBrand)
      .where(eq(mediaBrand.workspaceId, ids.workspace));
    await tx.delete(workspace).where(eq(workspace.id, ids.workspace));
    await tx.delete(user).where(inArray(user.id, [owner, intruder]));
  });
}
