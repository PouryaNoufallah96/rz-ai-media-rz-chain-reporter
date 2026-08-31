import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  copyVariantTranslationRequestedPayloadSchema,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { eq, inArray, sql } from "drizzle-orm";
import { DatabaseError } from "pg";

import type { Transaction } from "../executor";
import { createDb } from "../index";
import { settleCopyGeneration } from "../repositories/copy-generation";
import {
  allocateCopyVariantTranslationAttempt,
  claimCopyVariantTranslation,
  completeCopyVariantTranslation,
  failCopyVariantTranslation,
  listStaleCopyVariantTranslations,
  loadCopyVariantTranslationRequest,
  readCopyVariantLocalizations,
  readCopyVariantTranslationStatuses,
  settleStaleCopyVariantTranslation,
  startCopyVariantTranslation,
} from "../repositories/copy-variant-localization";
import { executeDraftRevisionCommand } from "../repositories/draft-revision";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { user } from "../schema/auth";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { copyVariantLocalization } from "../schema/copy-variant-localization";
import { copyVariantLocalizationRequest } from "../schema/copy-variant-localization-request";
import { draftRevision } from "../schema/draft-revision";
import { draftRevisionCommandReceipt } from "../schema/draft-revision-command-receipt";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { outboxEvent } from "../schema/outbox-event";
import { platformDraft } from "../schema/platform-draft";
import { promoIdea } from "../schema/promo-idea";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 3 });
const raceAdmissionApplication = `cv-admission-${randomUUID().slice(0, 8)}`;
const raceSettlementApplication = `cv-settlement-${randomUUID().slice(0, 8)}`;
const raceAdmissionDatabase = createDb(MIGRATION_DATABASE_URL, {
  application_name: raceAdmissionApplication,
  max: 1,
});
const raceSettlementDatabase = createDb(MIGRATION_DATABASE_URL, {
  application_name: raceSettlementApplication,
  max: 1,
});
const ids = {
  workspace: randomUUID(),
  mediaBrand: randomUUID(),
  analysisOperation: randomUUID(),
  analysisRun: randomUUID(),
  analysisUnit: randomUUID(),
  promoIdea: randomUUID(),
  platformDraft: randomUUID(),
  copyOperation: randomUUID(),
  copyAttempt: randomUUID(),
  copyAttemptTwo: randomUUID(),
  copyUnit: randomUUID(),
  copyUnitTwo: randomUUID(),
  copyVariant: randomUUID(),
  copyVariantTwo: randomUUID(),
};
const owner = `copy-variant-translation-owner-${randomUUID()}`;
const intruder = `copy-variant-translation-intruder-${randomUUID()}`;

try {
  await database.db.transaction(insertFixture);

  const native = await startCopyVariantTranslation(database.db, ids.workspace, {
    actor: owner,
    contentLocale: "en",
    copyVariantId: ids.copyVariant,
    idempotencyKey: "native",
    requestHash: "native",
    requestId: null,
  });
  assert.equal(native.status, "already_available");

  const unauthorized = await startCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      actor: intruder,
      contentLocale: "fa",
      copyVariantId: ids.copyVariant,
      idempotencyKey: "unauthorized",
      requestHash: "unauthorized",
      requestId: null,
    },
  );
  assert.equal(unauthorized.status, "not_found");

  const created = await startCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      actor: owner,
      contentLocale: "fa",
      copyVariantId: ids.copyVariant,
      idempotencyKey: "translate-fa",
      requestHash: "translate-fa",
      requestId: null,
    },
  );
  assert.equal(created.status, "created");
  const operationId = created.operationId;

  const concurrent = await startCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      actor: owner,
      contentLocale: "fa",
      copyVariantId: ids.copyVariant,
      idempotencyKey: "translate-fa-concurrent",
      requestHash: "translate-fa-concurrent",
      requestId: null,
    },
  );
  assert.equal(concurrent.status, "replayed");
  assert.equal(concurrent.operationId, operationId);

  const [event] = await database.db
    .select()
    .from(outboxEvent)
    .where(eq(outboxEvent.operationId, operationId));
  assert.equal(
    event?.eventType,
    OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
  );
  assert.deepEqual(
    copyVariantTranslationRequestedPayloadSchema.parse(event?.payload),
    {
      schemaVersion: 1,
      workspaceId: ids.workspace,
      operationId,
    },
  );

  const loaded = await loadCopyVariantTranslationRequest(
    database.db,
    ids.workspace,
    operationId,
  );
  assert.equal(loaded.status, "ready");
  assert.equal(loaded.analysisRunId, ids.analysisRun);
  assert.equal(loaded.contentLocale, "fa");
  assert.equal(loaded.source.copyVariantId, ids.copyVariant);
  assert.equal(loaded.source.mediaBrandKey, `copy-variant-${ids.mediaBrand}`);
  assert.equal(loaded.source.platformDraftId, ids.platformDraft);
  assert.equal(loaded.source.publishSource, null);

  const missingLocalizationRevision = await executeDraftRevisionCommand(
    database.db,
    ids.workspace,
    {
      actorId: owner,
      platformDraftId: ids.platformDraft,
      commandKind: "submit_content",
      source: {
        kind: "copy_variant",
        id: ids.copyVariant,
        contentLocale: "fa",
      },
      content: {
        contentLocale: "fa",
        headline: "ترجمه موجود نیست",
        body: "ترجمه موجود نیست",
        hashtags: ["#نمونه"],
      },
      expectedActive: { id: null, version: 0 },
      idempotencyKey: "missing-localization",
      requestHash: "missing-localization",
    },
  );
  assert.equal(missingLocalizationRevision.status, "not_found");

  const before = await readCopyVariantTranslationStatuses(
    database.db,
    ids.workspace,
    owner,
    [ids.copyVariant],
    "fa",
  );
  assert.equal(before.length, 1);
  assert.equal(before[0]?.lifecycle, "queued");

  const now = new Date();
  const claimedBy = "copy-variant-translation-probe";
  const claimed = await claimCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      operationId,
      claimedBy,
      now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    },
  );
  assert.equal(claimed.status, "claimed");
  const claimFence = {
    claimedBy,
    expectedVersion: claimed.operation.version,
  };
  const translationAttemptId = randomUUID();
  const allocated = await allocateCopyVariantTranslationAttempt(
    database.db,
    ids.workspace,
    operationId,
    translationAttemptId,
    claimFence,
  );
  assert.equal(allocated.status, "allocated");
  assert.equal(allocated.reused, false);

  const secondAttempt = await allocateCopyVariantTranslationAttempt(
    database.db,
    ids.workspace,
    operationId,
    randomUUID(),
    claimFence,
  );
  assert.equal(secondAttempt.status, "attempt_id_conflict");

  const invalid = await completeCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      operationId,
      operationAttemptId: translationAttemptId,
      claimFence,
      localization: { headline: " ", body: "بدنه", hashtags: ["#نمونه"] },
    },
  );
  assert.equal(invalid.status, "invalid_output");

  const completed = await completeCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      operationId,
      operationAttemptId: translationAttemptId,
      claimFence,
      localization: {
        headline: "عنوان فارسی",
        body: "بدنه فارسی",
        hashtags: ["#نمونه"],
      },
    },
  );
  assert.equal(completed.status, "persisted");

  const localizations = await readCopyVariantLocalizations(
    database.db,
    ids.workspace,
    [ids.copyVariant],
    "fa",
  );
  assert.equal(localizations.length, 1);
  assert.equal(localizations[0]?.operationAttemptId, translationAttemptId);
  assert.equal(localizations[0]?.headline, "عنوان فارسی");

  const localizedRevision = await executeDraftRevisionCommand(
    database.db,
    ids.workspace,
    {
      actorId: owner,
      platformDraftId: ids.platformDraft,
      commandKind: "submit_content",
      source: {
        kind: "copy_variant",
        id: ids.copyVariant,
        contentLocale: "fa",
      },
      content: {
        contentLocale: "fa",
        headline: "عنوان فارسی",
        body: "بدنه فارسی",
        hashtags: ["#نمونه"],
      },
      expectedActive: { id: null, version: 0 },
      idempotencyKey: "localized-revision",
      requestHash: "localized-revision",
    },
  );
  assert.equal(localizedRevision.status, "appended");
  assert.equal(localizedRevision.revision.contentLocale, "fa");
  assert.equal(
    localizedRevision.revision.originatingCopyVariantId,
    ids.copyVariant,
  );
  assert.equal(localizedRevision.revision.headline, "عنوان فارسی");

  const after = await readCopyVariantTranslationStatuses(
    database.db,
    ids.workspace,
    owner,
    [ids.copyVariant],
    "fa",
  );
  assert.equal(after[0]?.lifecycle, "succeeded");

  const alreadyTranslated = await startCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      actor: owner,
      contentLocale: "fa",
      copyVariantId: ids.copyVariant,
      idempotencyKey: "already-translated",
      requestHash: "already-translated",
      requestId: null,
    },
  );
  assert.equal(alreadyTranslated.status, "already_available");

  const failedStart = await startCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      actor: owner,
      contentLocale: "fa",
      copyVariantId: ids.copyVariantTwo,
      idempotencyKey: "translate-fa-failure",
      requestHash: "translate-fa-failure",
      requestId: null,
    },
  );
  assert.equal(failedStart.status, "created");
  const failureNow = new Date();
  const failureClaimedBy = "copy-variant-translation-failure-probe";
  const failureClaim = await claimCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      operationId: failedStart.operationId,
      claimedBy: failureClaimedBy,
      now: failureNow,
      leaseExpiresAt: new Date(failureNow.getTime() + 60_000),
    },
  );
  assert.equal(failureClaim.status, "claimed");
  const failureAttemptId = randomUUID();
  const failureClaimFence = {
    claimedBy: failureClaimedBy,
    expectedVersion: failureClaim.operation.version,
  };
  const failureAttempt = await allocateCopyVariantTranslationAttempt(
    database.db,
    ids.workspace,
    failedStart.operationId,
    failureAttemptId,
    failureClaimFence,
  );
  assert.equal(failureAttempt.status, "allocated");
  const failed = await failCopyVariantTranslation(database.db, ids.workspace, {
    claimFence: failureClaimFence,
    failureCode: "STRUCTURED_OUTPUT_INVALID",
    operationAttemptId: failureAttemptId,
    operationId: failedStart.operationId,
    outcome: "failed_terminal",
  });
  assert.equal(failed.status, "settled");
  assert.equal(failed.lifecycle, "failed");
  const failedLocalizations = await readCopyVariantLocalizations(
    database.db,
    ids.workspace,
    [ids.copyVariantTwo],
    "fa",
  );
  assert.equal(failedLocalizations.length, 0);
  const [failedAttemptRow] = await database.db
    .select({ failureCode: operationAttempt.failureCode })
    .from(operationAttempt)
    .where(eq(operationAttempt.id, failureAttemptId));
  assert.equal(failedAttemptRow?.failureCode, "STRUCTURED_OUTPUT_INVALID");

  const staleStart = await startCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      actor: owner,
      contentLocale: "fa",
      copyVariantId: ids.copyVariantTwo,
      idempotencyKey: "translate-fa-stale",
      requestHash: "translate-fa-stale",
      requestId: null,
    },
  );
  assert.equal(staleStart.status, "created");
  const staleClaimedBy = "copy-variant-translation-stale-probe";
  const staleClaim = await claimCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      claimedBy: staleClaimedBy,
      leaseExpiresAt: new Date(failureNow.getTime() + 60_000),
      now: failureNow,
      operationId: staleStart.operationId,
    },
  );
  assert.equal(staleClaim.status, "claimed");
  const staleAttemptId = randomUUID();
  const staleAttempt = await allocateCopyVariantTranslationAttempt(
    database.db,
    ids.workspace,
    staleStart.operationId,
    staleAttemptId,
    {
      claimedBy: staleClaimedBy,
      expectedVersion: staleClaim.operation.version,
    },
  );
  assert.equal(staleAttempt.status, "allocated");
  const staleNow = new Date(failureNow.getTime() + 120_000);
  const staleCandidates = await listStaleCopyVariantTranslations(
    database.db,
    ids.workspace,
    { limit: 10, now: staleNow },
  );
  const staleCandidate = staleCandidates.find(
    (candidate) => candidate.operationId === staleStart.operationId,
  );
  assert(staleCandidate);
  const guardedOut = await settleStaleCopyVariantTranslation(
    database.db,
    ids.workspace,
    {
      claimedBy: staleCandidate.claimedBy,
      expectedVersion: staleCandidate.operationVersion + 1,
      now: staleNow,
      operationId: staleStart.operationId,
    },
  );
  assert.equal(guardedOut.status, "claim_lost");
  const staleSettlementInput = {
    claimedBy: staleCandidate.claimedBy,
    expectedVersion: staleCandidate.operationVersion,
    now: staleNow,
    operationId: staleStart.operationId,
  };
  const staleSettled = await settleStaleCopyVariantTranslation(
    database.db,
    ids.workspace,
    staleSettlementInput,
  );
  assert.equal(staleSettled.status, "settled");
  assert.equal(staleSettled.lifecycle, "failed");
  assert.deepEqual(
    await settleStaleCopyVariantTranslation(
      database.db,
      ids.workspace,
      staleSettlementInput,
    ),
    staleSettled,
  );

  await assert.rejects(
    database.db.delete(copyVariant).where(eq(copyVariant.id, ids.copyVariant)),
    (error: unknown) =>
      [
        "fk_copy_variant_localization_copy_variant_id",
        "fk_copy_variant_translation_request_copy_variant_id",
      ].includes(constraintName(error) ?? ""),
  );

  await probeDeletionWins();
  await probeAdmissionWins();

  console.log(
    JSON.stringify({
      admissionRaceSerialized: true,
      atomicCompletion: true,
      idsOnlyEvent: true,
      immutableLocalization: true,
      localizedRevision: true,
      missingLocalizationRejected: true,
      oneAttempt: true,
      ownerScoped: true,
      restrictCleanup: true,
      staleSettlementGuarded: true,
      staleSettlementIdempotent: true,
      terminalFailure: true,
    }),
  );
} finally {
  await Promise.all([
    raceAdmissionDatabase.close(),
    raceSettlementDatabase.close(),
  ]);
  await cleanup();
  await database.close();
}

async function probeDeletionWins() {
  const race = await insertRaceFixture("deletion-wins");
  let admissionPromise!: ReturnType<typeof startCopyVariantTranslation>;

  await raceSettlementDatabase.db.transaction(async (tx) => {
    const settled = await settleCopyGeneration(
      tx,
      ids.workspace,
      race.replacementOperationId,
    );
    assert.equal(settled?.lifecycle, "succeeded");

    admissionPromise = startCopyVariantTranslation(
      raceAdmissionDatabase.db,
      ids.workspace,
      {
        actor: owner,
        contentLocale: "fa",
        copyVariantId: race.supersededVariantId,
        idempotencyKey: "deletion-wins",
        requestHash: "deletion-wins",
        requestId: null,
      },
    );
    await waitForDatabaseLock(raceAdmissionApplication);
  });

  const admission = await admissionPromise;
  assert.equal(admission.status, "not_found");
  const [deleted] = await database.db
    .select({ id: copyVariant.id })
    .from(copyVariant)
    .where(eq(copyVariant.id, race.supersededVariantId));
  assert.equal(deleted, undefined);
}

async function probeAdmissionWins() {
  const race = await insertRaceFixture("admission-wins");
  let settlementPromise!: ReturnType<typeof settleCopyGeneration>;
  let translationOperationId = "";

  await raceAdmissionDatabase.db.transaction(async (tx) => {
    const admission = await startCopyVariantTranslation(tx, ids.workspace, {
      actor: owner,
      contentLocale: "fa",
      copyVariantId: race.supersededVariantId,
      idempotencyKey: "admission-wins",
      requestHash: "admission-wins",
      requestId: null,
    });
    assert.equal(admission.status, "created");
    translationOperationId = admission.operationId;

    settlementPromise = settleCopyGeneration(
      raceSettlementDatabase.db,
      ids.workspace,
      race.replacementOperationId,
    );
    await waitForDatabaseLock(raceSettlementApplication);
  });

  const settled = await settlementPromise;
  assert.equal(settled?.lifecycle, "succeeded");
  const [retained] = await database.db
    .select({ id: copyVariant.id })
    .from(copyVariant)
    .where(eq(copyVariant.id, race.supersededVariantId));
  assert.equal(retained?.id, race.supersededVariantId);
  const [request] = await database.db
    .select({ copyVariantId: copyVariantLocalizationRequest.copyVariantId })
    .from(copyVariantLocalizationRequest)
    .where(
      eq(copyVariantLocalizationRequest.operationId, translationOperationId),
    );
  assert.equal(request?.copyVariantId, race.supersededVariantId);
}

async function waitForDatabaseLock(applicationName: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await database.db.execute(sql`
      select exists (
        select 1
        from pg_stat_activity
        where application_name = ${applicationName}
          and wait_event_type = 'Lock'
      ) as waiting
    `);
    if (result.rows[0]?.waiting === true) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error(
    `${applicationName} did not wait for the platform draft lock`,
  );
}

async function insertRaceFixture(label: string) {
  const fixture = {
    replacementAttemptId: randomUUID(),
    replacementOperationId: randomUUID(),
    replacementUnitId: randomUUID(),
    replacementVariantId: randomUUID(),
    supersededAttemptId: randomUUID(),
    supersededOperationId: randomUUID(),
    supersededUnitId: randomUUID(),
    supersededVariantId: randomUUID(),
  };

  await database.db.transaction(async (tx) => {
    await tx.insert(operation).values([
      {
        id: fixture.supersededOperationId,
        workspaceId: ids.workspace,
        actor: owner,
        commandType: "copy-generation:regenerate",
        idempotencyKey: `${label}-superseded`,
        requestHash: `${label}-superseded`,
        lifecycle: "succeeded",
        attemptSeq: 1,
      },
      {
        id: fixture.replacementOperationId,
        workspaceId: ids.workspace,
        actor: owner,
        commandType: "copy-generation:regenerate",
        idempotencyKey: `${label}-replacement`,
        requestHash: `${label}-replacement`,
        lifecycle: "settling",
        attemptSeq: 1,
      },
    ]);
    await tx
      .insert(copyGeneration)
      .values([
        raceGeneration(fixture.supersededOperationId),
        raceGeneration(fixture.replacementOperationId),
      ]);
    await tx
      .insert(operationAttempt)
      .values([
        raceAttempt(fixture.supersededAttemptId, fixture.supersededOperationId),
        raceAttempt(
          fixture.replacementAttemptId,
          fixture.replacementOperationId,
        ),
      ]);
    await tx
      .insert(copyGenerationUnit)
      .values([
        raceUnit(
          fixture.supersededUnitId,
          fixture.supersededOperationId,
          fixture.supersededAttemptId,
        ),
        raceUnit(
          fixture.replacementUnitId,
          fixture.replacementOperationId,
          fixture.replacementAttemptId,
        ),
      ]);
    await tx
      .insert(copyVariant)
      .values([
        raceVariant(fixture.supersededVariantId, fixture.supersededUnitId),
        raceVariant(fixture.replacementVariantId, fixture.replacementUnitId),
      ]);
  });

  return fixture;
}

function raceGeneration(operationId: string) {
  return {
    operationId,
    workspaceId: ids.workspace,
    platformDraftId: ids.platformDraft,
    requestedContentLocale: "en" as const,
    modelOptionKey: "probe",
    customerTemplateFingerprint: "copy-variant-translation-probe",
    brandPolicyFingerprint: "copy-variant-translation-probe",
    promptVersion: "copy-v1",
    configurationVersion: "copy-v1",
  };
}

function raceAttempt(id: string, operationId: string) {
  return {
    id,
    workspaceId: ids.workspace,
    operationId,
    attemptNumber: 1,
    outcome: "succeeded" as const,
  };
}

function raceUnit(id: string, copyGenerationId: string, attemptId: string) {
  return {
    id,
    workspaceId: ids.workspace,
    copyGenerationId,
    variantKey: "probe",
    status: "succeeded" as const,
    operationAttemptId: attemptId,
  };
}

function raceVariant(id: string, copyGenerationUnitId: string) {
  return {
    id,
    workspaceId: ids.workspace,
    copyGenerationUnitId,
    contentLocale: "en" as const,
    headline: "Race headline",
    body: "Race body",
    hashtags: ["#probe"],
  };
}

async function insertFixture(tx: Transaction) {
  await tx.insert(user).values([
    {
      id: owner,
      email: `${owner}@example.test`,
      name: "Copy Variant Translation Owner",
    },
    {
      id: intruder,
      email: `${intruder}@example.test`,
      name: "Copy Variant Translation Intruder",
    },
  ]);
  await tx.insert(workspace).values({
    id: ids.workspace,
    name: `Copy Variant Translation Probe ${ids.workspace}`,
  });
  await tx.insert(mediaBrand).values({
    id: ids.mediaBrand,
    workspaceId: ids.workspace,
    key: `copy-variant-${ids.mediaBrand}`,
    name: "Copy Variant Translation Probe",
    sortOrder: 1,
  });
  await tx.insert(operation).values([
    {
      id: ids.analysisOperation,
      workspaceId: ids.workspace,
      actor: owner,
      commandType: "analysis-run:promo",
      idempotencyKey: "copy-variant-analysis",
      requestHash: "copy-variant-analysis",
      lifecycle: "succeeded",
    },
    {
      id: ids.copyOperation,
      workspaceId: ids.workspace,
      actor: owner,
      commandType: "copy-generation:regenerate",
      idempotencyKey: "copy-variant-generation",
      requestHash: "copy-variant-generation",
      lifecycle: "succeeded",
      attemptSeq: 2,
    },
  ]);
  await tx.insert(analysisRun).values({
    id: ids.analysisRun,
    workspaceId: ids.workspace,
    kind: "promo",
    operationId: ids.analysisOperation,
    configuration: {
      kind: "promo",
      models: ["probe"],
      platforms: ["x"],
      promo: {
        brands: [`copy-variant-${ids.mediaBrand}`],
        prompts: {
          [`copy-variant-${ids.mediaBrand}`]: "Probe promo",
        },
      },
    },
    semanticStatus: "skipped",
    templateFingerprint: "copy-variant-translation-probe",
  });
  await tx.insert(analysisModelUnit).values({
    id: ids.analysisUnit,
    workspaceId: ids.workspace,
    analysisRunId: ids.analysisRun,
    mediaBrandId: ids.mediaBrand,
    modelOptionKey: "probe",
    taskKey: "promo-ideas:probe",
    status: "succeeded",
  });
  await tx.insert(promoIdea).values({
    id: ids.promoIdea,
    workspaceId: ids.workspace,
    analysisModelUnitId: ids.analysisUnit,
    rank: 1,
    title: "Probe promo",
    description: "Probe description",
    angle: "Probe angle",
  });
  await tx.insert(platformDraft).values({
    id: ids.platformDraft,
    workspaceId: ids.workspace,
    mediaBrandId: ids.mediaBrand,
    platform: "x",
    promoIdeaId: ids.promoIdea,
    lanePosition: 1,
  });
  await tx.insert(copyGeneration).values({
    operationId: ids.copyOperation,
    workspaceId: ids.workspace,
    platformDraftId: ids.platformDraft,
    requestedContentLocale: "en",
    modelOptionKey: "probe",
    customerTemplateFingerprint: "copy-variant-translation-probe",
    brandPolicyFingerprint: "copy-variant-translation-probe",
    promptVersion: "copy-v1",
    configurationVersion: "copy-v1",
  });
  await tx.insert(operationAttempt).values([
    {
      id: ids.copyAttempt,
      workspaceId: ids.workspace,
      operationId: ids.copyOperation,
      attemptNumber: 1,
      outcome: "succeeded",
    },
    {
      id: ids.copyAttemptTwo,
      workspaceId: ids.workspace,
      operationId: ids.copyOperation,
      attemptNumber: 2,
      outcome: "succeeded",
    },
  ]);
  await tx.insert(copyGenerationUnit).values([
    {
      id: ids.copyUnit,
      workspaceId: ids.workspace,
      copyGenerationId: ids.copyOperation,
      variantKey: "probe",
      status: "succeeded",
      operationAttemptId: ids.copyAttempt,
    },
    {
      id: ids.copyUnitTwo,
      workspaceId: ids.workspace,
      copyGenerationId: ids.copyOperation,
      variantKey: "probe-two",
      status: "succeeded",
      operationAttemptId: ids.copyAttemptTwo,
    },
  ]);
  await tx.insert(copyVariant).values([
    {
      id: ids.copyVariant,
      workspaceId: ids.workspace,
      copyGenerationUnitId: ids.copyUnit,
      contentLocale: "en",
      headline: "English headline",
      body: "English body",
      hashtags: ["#probe"],
    },
    {
      id: ids.copyVariantTwo,
      workspaceId: ids.workspace,
      copyGenerationUnitId: ids.copyUnitTwo,
      contentLocale: "en",
      headline: "Second English headline",
      body: "Second English body",
      hashtags: ["#probe"],
    },
  ]);
}

function constraintName(error: unknown) {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof DatabaseError) return current.constraint;
    current = current.cause;
  }
  return undefined;
}

async function cleanup() {
  await database.db.transaction(async (tx) => {
    await tx
      .delete(copyVariantLocalization)
      .where(eq(copyVariantLocalization.workspaceId, ids.workspace));
    await tx
      .delete(copyVariantLocalizationRequest)
      .where(eq(copyVariantLocalizationRequest.workspaceId, ids.workspace));
    await tx
      .delete(outboxEvent)
      .where(eq(outboxEvent.workspaceId, ids.workspace));
    await tx
      .update(platformDraft)
      .set({ activeRevisionId: null })
      .where(eq(platformDraft.workspaceId, ids.workspace));
    await tx
      .delete(draftRevisionCommandReceipt)
      .where(eq(draftRevisionCommandReceipt.workspaceId, ids.workspace));
    await tx
      .delete(draftRevision)
      .where(eq(draftRevision.workspaceId, ids.workspace));
    await tx
      .delete(copyVariant)
      .where(eq(copyVariant.workspaceId, ids.workspace));
    await tx
      .delete(copyGenerationUnit)
      .where(eq(copyGenerationUnit.workspaceId, ids.workspace));
    await tx
      .delete(copyGeneration)
      .where(eq(copyGeneration.workspaceId, ids.workspace));
    await tx
      .delete(operationAttempt)
      .where(eq(operationAttempt.workspaceId, ids.workspace));
    await tx
      .delete(platformDraft)
      .where(eq(platformDraft.workspaceId, ids.workspace));
    await tx.delete(promoIdea).where(eq(promoIdea.workspaceId, ids.workspace));
    await tx
      .delete(analysisModelUnit)
      .where(eq(analysisModelUnit.workspaceId, ids.workspace));
    await tx
      .delete(analysisRun)
      .where(eq(analysisRun.workspaceId, ids.workspace));
    await tx.delete(operation).where(eq(operation.workspaceId, ids.workspace));
    await tx
      .delete(mediaBrand)
      .where(eq(mediaBrand.workspaceId, ids.workspace));
    await tx.delete(workspace).where(eq(workspace.id, ids.workspace));
    await tx.delete(user).where(inArray(user.id, [owner, intruder]));
  });
}
