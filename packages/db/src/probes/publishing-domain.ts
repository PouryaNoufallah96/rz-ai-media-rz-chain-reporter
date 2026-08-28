import { randomUUID } from "node:crypto";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import pg from "pg";

import { createDb } from "../index";
import { recordPublicationSettlementActivity } from "../repositories/activity-event";
import {
  grantApproval,
  readActionableApproval,
} from "../repositories/approval";
import { executeDraftRevisionCommand } from "../repositories/draft-revision";
import { claimOperationExecution } from "../repositories/operation";
import {
  allocateOperationAttempt,
  settleReconciliationOperationSuccess,
} from "../repositories/operation-attempt";
import {
  admitDirectPublication,
  beginOrResumePublicationAttempt,
  claimPublicationExecution,
  claimPublicationFinalEffect,
  enqueueStrandedPublicationRecoveries,
  markSettlementActivityFailed,
  readPublicationCommandContext,
  rearmSettlementActivity,
  reassertPublicationExecution,
  recordPublicationReconciliation,
  renewPublicationExecutionLease,
  requestPublicationReconciliation,
  settlePublicationExecution,
} from "../repositories/publication";
import { setPublishingPaused } from "../repositories/publishing-control";
import {
  acceptPublishingMediaGrantForContainer,
  fetchPublishingMediaGrant,
  hashPublishingMediaGrant,
  issuePublishingMediaGrant,
} from "../repositories/publishing-media-grant";
import { mutateSavedCard, savePlatformDraft } from "../repositories/saved-card";
import {
  cancelSchedule,
  createSchedule,
  rescheduleSchedule,
} from "../repositories/schedule";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 16 });
const client = new pg.Client({ connectionString: MIGRATION_DATABASE_URL });
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const actorId = `publishing-probe-${randomUUID()}`;
const otherActorId = `publishing-probe-${randomUUID()}`;
const brandId = randomUUID();
const xDestinationId = randomUUID();
const alternateXDestinationId = randomUUID();
const disabledXDestinationId = randomUUID();
const unboundXDestinationId = randomUUID();
const unmappedXDestinationId = randomUUID();
const telegramDestinationId = randomUUID();
const instagramDestinationId = randomUUID();
const genericImageId = randomUUID();
const orphanGeneratedImageId = randomUUID();
const xDraftIds = Array.from({ length: 13 }, () => randomUUID());
const xRevisionIds = Array.from({ length: 13 }, () => randomUUID());
const historicalSuccessorId = randomUUID();
const telegramDraftId = randomUUID();
const telegramRevisionId = randomUUID();
const instagramDraftIds = Array.from({ length: 2 }, () => randomUUID());
const instagramRevisionIds = Array.from({ length: 2 }, () => randomUUID());
const originOperationId = randomUUID();
const originRunId = randomUUID();
const originUnitId = randomUUID();
const originSelectionId = randomUUID();
const observed: string[] = [];

await client.connect();

try {
  await insertFixture();
  await proveSavedCards();
  await proveApprovalSnapshots();
  await proveApprovalKeyConcurrency();
  await proveActiveRevisionFences();
  await proveConcurrentAdmission();
  await proveScheduleCas();
  await proveRetryAndAmbiguity();
  await proveScheduledReconciliation();
  await proveTelegramAttestation();
  await provePublishingPause();
  await proveInstagramGrant();
  console.log(`publishing domain probe passed: ${observed.join(", ")}`);
} finally {
  await cleanup();
  await client.end();
  await database.close();
}

async function proveSavedCards() {
  const input = {
    actorId,
    platformDraftId: xDraftIds[0] as string,
    idempotencyKey: "saved-card",
    requestHash: "saved-card-hash",
  };
  const created = await savePlatformDraft(database.db, workspaceId, input);
  assertStatus(created.status, "created", "save");
  const replay = await savePlatformDraft(database.db, workspaceId, input);
  assertStatus(replay.status, "replayed", "save replay");
  const mismatch = await savePlatformDraft(database.db, workspaceId, {
    ...input,
    requestHash: "changed",
  });
  assertStatus(mismatch.status, "idempotency_mismatch", "save mismatch");
  if (!("savedCard" in created)) throw new Error("save result missing card");
  const discarded = await mutateSavedCard(database.db, workspaceId, {
    actorId,
    savedCardId: created.savedCard.id,
    expectedVersion: created.savedCard.version,
    action: "discard",
    idempotencyKey: "discard-card",
    requestHash: "discard-card-hash",
  });
  assertStatus(discarded.status, "updated", "discard");
  if (!("savedCard" in discarded)) throw new Error("discard missing card");
  const restored = await mutateSavedCard(database.db, workspaceId, {
    actorId,
    savedCardId: discarded.savedCard.id,
    expectedVersion: discarded.savedCard.version,
    action: "restore",
    idempotencyKey: "restore-card",
    requestHash: "restore-card-hash",
  });
  assertStatus(restored.status, "updated", "restore");
  if (!("savedCard" in restored)) throw new Error("restore missing card");
  const discardedAgain = await mutateSavedCard(database.db, workspaceId, {
    actorId,
    savedCardId: restored.savedCard.id,
    expectedVersion: restored.savedCard.version,
    action: "discard",
    idempotencyKey: "discard-card-again",
    requestHash: "discard-card-again-hash",
  });
  if (!("savedCard" in discardedAgain)) {
    throw new Error("second discard missing card");
  }
  await savePlatformDraft(database.db, workspaceId, {
    ...input,
    idempotencyKey: "saved-card-successor",
  });
  const blockedRestore = await mutateSavedCard(database.db, workspaceId, {
    actorId,
    savedCardId: discardedAgain.savedCard.id,
    expectedVersion: discardedAgain.savedCard.version,
    action: "restore",
    idempotencyKey: "restore-card-conflict",
    requestHash: "restore-card-conflict-hash",
  });
  assertStatus(blockedRestore.status, "already_active", "restore conflict");
  const concurrentSaveInput = {
    actorId,
    platformDraftId: xDraftIds[1] as string,
    requestHash: "concurrent-saved-card-hash",
  };
  const concurrentSaves = await Promise.all([
    savePlatformDraft(database.db, workspaceId, {
      ...concurrentSaveInput,
      idempotencyKey: "concurrent-saved-card-a",
    }),
    savePlatformDraft(database.db, workspaceId, {
      ...concurrentSaveInput,
      idempotencyKey: "concurrent-saved-card-b",
    }),
  ]);
  const concurrentStatuses = concurrentSaves.map((result) => result.status);
  if (
    concurrentStatuses.filter((status) => status === "created").length !== 1 ||
    !concurrentStatuses.includes("already_active")
  ) {
    throw new Error(
      `concurrent saved card conflict was not typed: ${concurrentStatuses.join(",")}`,
    );
  }
  const crossWorkspace = await savePlatformDraft(
    database.db,
    otherWorkspaceId,
    {
      ...input,
      idempotencyKey: "cross-workspace",
    },
  );
  assertStatus(crossWorkspace.status, "not_found", "workspace fence");
  observed.push(
    "workspace-constraints",
    "idempotent-command-replay-mismatch",
    "activity-replay",
    "concurrent-save-and-restore-active-constraint-mapping",
  );
}

async function proveApprovalSnapshots() {
  const generic = await grantApproval(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    draftRevisionId: instagramRevisionIds[0] as string,
    selectedFinalMediaAssetId: genericImageId,
    idempotencyKey: "generic-image-approval",
    requestHash: "generic-image-approval-hash",
  });
  assertStatus(generic.status, "created", "verified operator image");
  const stale = await grantApproval(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    draftRevisionId: instagramRevisionIds[0] as string,
    selectedFinalMediaAssetId: orphanGeneratedImageId,
    idempotencyKey: "stale-snapshot",
    requestHash: "stale-snapshot-hash",
  });
  assertStatus(stale.status, "snapshot_stale", "exact snapshot equality");
  const generated = await grantApproval(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    draftRevisionId: instagramRevisionIds[1] as string,
    selectedFinalMediaAssetId: orphanGeneratedImageId,
    idempotencyKey: "orphan-generated",
    requestHash: "orphan-generated-hash",
  });
  assertStatus(
    generated.status,
    "media_not_publishable",
    "generated ownership",
  );
  observed.push(
    "exact-snapshot-equality",
    "generated-final-ownership",
    "verified-operator-upload-selection",
  );
}

async function proveActiveRevisionFences() {
  const draftId = xDraftIds[12] as string;
  const revisionId = xRevisionIds[12] as string;
  const approvalId = await approveX(12, "active-fence");
  const duplicateApprovalInput = {
    actorId,
    draftRevisionId: revisionId,
    expectedRevisionVersion: 1,
    selectedFinalMediaAssetId: null,
    idempotencyKey: "active-fence-duplicate-approval",
    requestHash: "active-fence-duplicate-approval-hash",
  };
  const duplicateApproval = await grantApproval(
    database.db,
    workspaceId,
    duplicateApprovalInput,
  );
  if (
    !("approval" in duplicateApproval) ||
    duplicateApproval.approval.id !== approvalId
  ) {
    throw new Error("repeated approval did not reuse the snapshot approval");
  }
  const otherActorInput = {
    ...duplicateApprovalInput,
    actorId: otherActorId,
    idempotencyKey: "active-fence-other-actor-approval",
    requestHash: "active-fence-other-actor-approval-hash",
  };
  const otherActorApproval = await grantApproval(
    database.db,
    workspaceId,
    otherActorInput,
  );
  assertStatus(
    otherActorApproval.status,
    "not_found",
    "foreign origin approval",
  );
  const scheduled = await createFutureSchedule(approvalId, "active-fence");
  if (!("schedule" in scheduled) || !scheduled.operationId) {
    throw new Error("active revision schedule missing");
  }
  const switched = await executeDraftRevisionCommand(database.db, workspaceId, {
    actorId,
    commandKind: "select_revision",
    draftRevisionId: historicalSuccessorId,
    expectedActive: { id: revisionId, version: 1 },
    idempotencyKey: "activate-successor",
    platformDraftId: draftId,
    requestHash: "activate-successor-hash",
  });
  if (!("revision" in switched))
    throw new Error("active successor selection failed");
  const duplicateReplay = await grantApproval(
    database.db,
    workspaceId,
    duplicateApprovalInput,
  );
  assertStatus(
    duplicateReplay.status,
    "replayed",
    "deduplicated approval replay after selection",
  );
  if (
    !("approval" in duplicateReplay) ||
    duplicateReplay.approval.id !== approvalId
  ) {
    throw new Error(
      "deduplicated approval replay returned a different approval",
    );
  }
  const changedReplay = await grantApproval(database.db, workspaceId, {
    ...duplicateApprovalInput,
    draftRevisionId: historicalSuccessorId,
    expectedRevisionVersion: 2,
    requestHash: "changed-duplicate-approval-payload",
  });
  assertStatus(
    changedReplay.status,
    "idempotency_mismatch",
    "changed approval receipt payload",
  );
  const wrongActor = await grantApproval(database.db, workspaceId, {
    ...duplicateApprovalInput,
    actorId: otherActorId,
  });
  assertStatus(
    wrongActor.status,
    "idempotency_mismatch",
    "approval receipt actor identity",
  );
  const otherActorReplay = await grantApproval(
    database.db,
    workspaceId,
    otherActorInput,
  );
  assertStatus(
    otherActorReplay.status,
    "not_found",
    "foreign origin approval replay",
  );
  const receiptCounts = await client.query<{
    approvals: number;
    receipts: number;
  }>(
    `select
      (select count(*)::int from approval where workspace_id = $1 and draft_revision_id in ($2, $3)) as approvals,
      (select count(*)::int from activity_event where workspace_id = $1 and event_type = 'approval.granted' and approval_id = $4) as receipts`,
    [workspaceId, revisionId, historicalSuccessorId, approvalId],
  );
  if (
    receiptCounts.rows[0]?.approvals !== 1 ||
    receiptCounts.rows[0].receipts !== 2
  ) {
    throw new Error("approval replay or mismatch changed durable receipts");
  }
  const staleApproval = await grantApproval(database.db, workspaceId, {
    actorId,
    draftRevisionId: revisionId,
    expectedRevisionVersion: 1,
    selectedFinalMediaAssetId: null,
    idempotencyKey: "stale-active-approval",
    requestHash: "stale-active-approval-hash",
  });
  assertStatus(staleApproval.status, "snapshot_stale", "inactive approval");
  const staleDirect = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    approvalId,
    destinationAccountId: xDestinationId,
    expectedRevisionVersion: 2,
    idempotencyKey: "inactive-direct",
    requestHash: "inactive-direct-hash",
    requestId: null,
  });
  assertStatus(
    staleDirect.status,
    "approval_snapshot_stale",
    "inactive direct admission",
  );
  const staleSchedule = await createFutureSchedule(
    approvalId,
    "inactive-schedule",
  );
  assertStatus(
    staleSchedule.status,
    "approval_snapshot_stale",
    "inactive schedule admission",
  );
  if (!(await readActionableApproval(database.db, workspaceId, approvalId))) {
    throw new Error("admitted approval lost pinned snapshot");
  }
  const now = scheduled.schedule.effectiveAt;
  const claimedBy = "active-revision-pinned-schedule";
  const claim = await claimPublicationExecution(database.db, workspaceId, {
    operationId: scheduled.operationId,
    publicationId: scheduled.schedule.publicationId,
    claimedBy,
    now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
  });
  assertStatus(claim.status, "claimed", "pinned schedule claim");
  const reasserted = await reassertPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: scheduled.operationId,
      claimedBy,
      now,
    },
  );
  assertStatus(
    reasserted.status,
    "ready",
    "pinned schedule after active switch",
  );
  const returned = await executeDraftRevisionCommand(database.db, workspaceId, {
    actorId,
    commandKind: "select_revision",
    draftRevisionId: revisionId,
    expectedActive: { id: historicalSuccessorId, version: 2 },
    idempotencyKey: "activate-original",
    platformDraftId: draftId,
    requestHash: "activate-original-hash",
  });
  if (!("revision" in returned)) throw new Error("original selection failed");
  const staleReturned = await grantApproval(database.db, workspaceId, {
    actorId,
    draftRevisionId: revisionId,
    expectedRevisionVersion: 1,
    selectedFinalMediaAssetId: null,
    idempotencyKey: "stale-returned-approval",
    requestHash: "stale-returned-approval-hash",
  });
  assertStatus(
    staleReturned.status,
    "snapshot_stale",
    "returned revision version fence",
  );
  const duplicate = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    approvalId,
    destinationAccountId: xDestinationId,
    expectedRevisionVersion: 3,
    idempotencyKey: "returned-duplicate-publication",
    requestHash: "returned-duplicate-publication-hash",
    requestId: null,
  });
  assertStatus(
    duplicate.status,
    "publication_already_claimed",
    "reused revision publication slot",
  );
  observed.push(
    "deduplicated-approval-replay-after-active-switch",
    "approval-receipt-payload-and-actor-identity",
    "active-revision-admission-fences",
    "returned-revision-version-fence",
    "scheduled-snapshot-pinned-after-selection",
    "reused-revision-publication-uniqueness",
  );
}

async function proveApprovalKeyConcurrency() {
  const revisionIds = [xRevisionIds[0] as string, xRevisionIds[8] as string];
  const inputs = [actorId, otherActorId].map((actor, index) => ({
    actorId: actor,
    draftRevisionId: revisionIds[index] as string,
    expectedRevisionVersion: 1,
    selectedFinalMediaAssetId: null,
    idempotencyKey: "concurrent-approval-key",
    requestHash: "concurrent-approval-key-hash",
  }));
  const results = await Promise.all(
    inputs.map((input) => grantApproval(database.db, workspaceId, input)),
  );
  const statuses = results
    .map((result) => result.status)
    .sort()
    .join(",");
  if (
    statuses !== "created,idempotency_mismatch" &&
    statuses !== "created,not_found"
  ) {
    throw new Error(`cross-actor approval key race settled as ${statuses}`);
  }
  const counts = await client.query<{ approvals: number; receipts: number }>(
    `select
      (select count(*)::int from approval where workspace_id = $1 and draft_revision_id = any($2::uuid[])) as approvals,
      (select count(*)::int from activity_event where workspace_id = $1 and event_type = 'approval.granted' and idempotency_key = $3) as receipts`,
    [workspaceId, revisionIds, "concurrent-approval-key"],
  );
  if (counts.rows[0]?.approvals !== 1 || counts.rows[0].receipts !== 1) {
    throw new Error("cross-actor approval key race leaked durable effects");
  }
  observed.push("cross-actor-approval-receipt-key-serialization");
}

async function proveConcurrentAdmission() {
  const approvalId = await approveX(1, "concurrent");
  const future = new Date(Date.now() + 3_600_000);
  const [direct, scheduled] = await Promise.all([
    admitDirectPublication(database.db, workspaceId, {
      actorId,
      expectedRevisionVersion: 1,
      approvalId,
      destinationAccountId: xDestinationId,
      idempotencyKey: "concurrent-direct",
      requestHash: "concurrent-direct-hash",
      requestId: null,
    }),
    createSchedule(database.db, workspaceId, {
      actorId,
      expectedRevisionVersion: 1,
      approvalId,
      destinationAccountId: xDestinationId,
      scheduledAt: future,
      timezone: "UTC",
      idempotencyKey: "concurrent-schedule",
      requestHash: "concurrent-schedule-hash",
      requestId: null,
    }),
  ]);
  const statuses = [direct.status, scheduled.status];
  if (statuses.filter((status) => status === "created").length !== 1) {
    throw new Error(
      `concurrent admission lacked one winner: ${statuses.join(",")}`,
    );
  }
  if (!statuses.includes("publication_already_claimed")) {
    throw new Error(
      `concurrent admission lacked typed loser: ${statuses.join(",")}`,
    );
  }
  observed.push("concurrent-direct-scheduled-one-winner-one-typed-loser");
}

async function proveScheduleCas() {
  const cancelApproval = await approveX(2, "cancel");
  const cancelled = await createFutureSchedule(cancelApproval, "cancel");
  if (!("schedule" in cancelled))
    throw new Error("cancel fixture missing schedule");
  const cancelResult = await cancelSchedule(database.db, workspaceId, {
    actorId,
    scheduleId: cancelled.schedule.id,
    expectedVersion: cancelled.schedule.version,
    idempotencyKey: "cancel-command",
    requestHash: "cancel-command-hash",
  });
  assertStatus(cancelResult.status, "updated", "cancel CAS");
  if (typeof cancelled.operationId !== "string") {
    throw new Error("cancel fixture operation missing");
  }
  await assertCancelledOperation(cancelled.operationId, 2, "cancel");

  const rescheduleApproval = await approveX(3, "reschedule");
  const scheduled = await createFutureSchedule(
    rescheduleApproval,
    "reschedule",
  );
  if (!("schedule" in scheduled))
    throw new Error("reschedule fixture missing schedule");
  const successor = await rescheduleSchedule(database.db, workspaceId, {
    actorId,
    scheduleId: scheduled.schedule.id,
    expectedVersion: scheduled.schedule.version,
    scheduledAt: new Date(Date.now() + 7_200_000),
    timezone: "Asia/Tehran",
    idempotencyKey: "reschedule-command",
    requestHash: "reschedule-command-hash",
    requestId: null,
  });
  assertStatus(successor.status, "created", "reschedule successor");
  if (typeof scheduled.operationId !== "string") {
    throw new Error("reschedule fixture operation missing");
  }
  await assertCancelledOperation(scheduled.operationId, 2, "reschedule");

  const missedApproval = await approveX(4, "missed");
  const missed = await createFutureSchedule(missedApproval, "missed");
  if (!("schedule" in missed) || typeof missed.operationId !== "string")
    throw new Error("missed fixture missing schedule");
  const observedAt = new Date(missed.schedule.effectiveAt.getTime() + 600_000);
  const missedClaim = await claimPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: missed.operationId,
      publicationId: missed.schedule.publicationId,
      claimedBy: "publishing-domain-probe-missed",
      now: observedAt,
      leaseExpiresAt: new Date(observedAt.getTime() + 60_000),
    },
  );
  if (missedClaim.status !== "missed") {
    throw new Error(`missed schedule claim returned ${missedClaim.status}`);
  }
  if (
    missedClaim.operation.lifecycle !== "failed" ||
    missedClaim.operation.version !== 2 ||
    missedClaim.operation.claimedAt !== null ||
    missedClaim.operation.claimedBy !== null ||
    missedClaim.operation.leaseExpiresAt !== null
  ) {
    throw new Error("missed schedule operation was not fenced and settled");
  }
  const marked = missedClaim.schedule;
  const recovered = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId: marked.approvalId,
    destinationAccountId: marked.destinationAccountId,
    scheduleId: marked.id,
    expectedScheduleVersion: marked.version,
    commandKind: "missed_recovery",
    idempotencyKey: "recover-missed",
    requestHash: "recover-missed-hash",
    requestId: null,
  });
  assertStatus(recovered.status, "created", "missed recovery");
  if (!("operationId" in recovered) || !("publication" in recovered)) {
    throw new Error("missed recovery operation missing");
  }
  const missedRecoveryAt = new Date(observedAt.getTime() + 1);
  const consumedRecoveryOutboxId = await simulateConsumedOutboxEvent(
    recovered.operationId,
    new Date(missedRecoveryAt.getTime() - 5_001),
  );
  const missedRecoveryEvents = (
    await Promise.all([
      enqueueStrandedPublicationRecoveries(
        database.db,
        workspaceId,
        missedRecoveryAt,
      ),
      enqueueStrandedPublicationRecoveries(
        database.db,
        workspaceId,
        missedRecoveryAt,
      ),
    ])
  ).flat();
  if (
    missedRecoveryEvents.length !== 1 ||
    missedRecoveryEvents[0]?.id === consumedRecoveryOutboxId
  ) {
    throw new Error("missed recovery did not enqueue one fresh event");
  }
  const missedRecoveryClaimedBy = "publishing-domain-probe-missed-recovery";
  const missedRecoveryClaimAt = new Date(missedRecoveryAt.getTime() + 1);
  const missedRecoveryClaim = await claimPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: recovered.operationId,
      publicationId: recovered.publication.id,
      claimedBy: missedRecoveryClaimedBy,
      now: missedRecoveryClaimAt,
      leaseExpiresAt: new Date(missedRecoveryClaimAt.getTime() + 60_000),
    },
  );
  if (missedRecoveryClaim.status !== "claimed") {
    throw new Error(
      `missed recovery claim returned ${missedRecoveryClaim.status}`,
    );
  }
  const reassertedMissedRecovery = await reassertPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: recovered.operationId,
      claimedBy: missedRecoveryClaimedBy,
      now: new Date(missedRecoveryClaimAt.getTime() + 1),
    },
  );
  if (reassertedMissedRecovery.status !== "ready") {
    throw new Error("missed recovery execution was not reasserted");
  }
  const renewedMissedRecovery = await renewPublicationExecutionLease(
    database.db,
    workspaceId,
    {
      operationId: recovered.operationId,
      claimedBy: missedRecoveryClaimedBy,
      expectedVersion: missedRecoveryClaim.operation.version,
      now: new Date(missedRecoveryClaimAt.getTime() + 2),
      leaseExpiresAt: new Date(missedRecoveryClaimAt.getTime() + 120_000),
    },
  );
  if (!renewedMissedRecovery) {
    throw new Error("missed recovery lease was not renewed");
  }
  const missedRecoveryAttempt = await beginOrResumePublicationAttempt(
    database.db,
    workspaceId,
    {
      operationId: recovered.operationId,
      claimedBy: missedRecoveryClaimedBy,
      now: new Date(missedRecoveryClaimAt.getTime() + 3),
    },
  );
  if (!missedRecoveryAttempt) {
    throw new Error("missed recovery attempt was not allocated");
  }
  const missedRecoveryFinalEffect = await claimPublicationFinalEffect(
    database.db,
    workspaceId,
    {
      operationId: recovered.operationId,
      attemptId: missedRecoveryAttempt.id,
      claimedBy: missedRecoveryClaimedBy,
    },
  );
  if (missedRecoveryFinalEffect.status !== "claimed") {
    throw new Error("missed recovery final effect was not claimed");
  }
  const settledMissedRecovery = await settlePublicationExecution(
    database.db,
    workspaceId,
    {
      attemptId: missedRecoveryAttempt.id,
      claimedBy: missedRecoveryClaimedBy,
      expectedOperationVersion: renewedMissedRecovery.version,
      outcome: "confirmed",
      checkpoint: {
        platform: "x",
        kind: "x_post",
        providerReferenceId: "publishing-domain-probe-missed-recovery",
      },
      providerResultId: "publishing-domain-probe-missed-recovery",
      publicationId: recovered.publication.id,
      operationId: recovered.operationId,
    },
  );
  if (!settledMissedRecovery) {
    throw new Error("missed recovery settlement failed");
  }
  const preservedHistoricalSchedule = await readScheduleState(marked.id);
  if (
    preservedHistoricalSchedule?.lifecycle !== "missed_requires_confirmation" ||
    preservedHistoricalSchedule.version !== marked.version
  ) {
    throw new Error("missed recovery mutated its historical schedule");
  }

  const missedRescheduleApproval = await approveX(9, "missed-reschedule");
  const missedReschedule = await createFutureSchedule(
    missedRescheduleApproval,
    "missed-reschedule",
  );
  if (
    !("schedule" in missedReschedule) ||
    typeof missedReschedule.operationId !== "string"
  ) {
    throw new Error("missed reschedule fixture missing schedule");
  }
  const missedRescheduleAt = new Date(
    missedReschedule.schedule.effectiveAt.getTime() + 600_000,
  );
  const missedRescheduleClaim = await claimPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: missedReschedule.operationId,
      publicationId: missedReschedule.schedule.publicationId,
      claimedBy: "publishing-domain-probe-missed-reschedule",
      now: missedRescheduleAt,
      leaseExpiresAt: new Date(missedRescheduleAt.getTime() + 60_000),
    },
  );
  if (missedRescheduleClaim.status !== "missed") {
    throw new Error("missed reschedule schedule did not become missed");
  }
  const missedOperationVersion = missedRescheduleClaim.operation.version;
  const rescheduledMissed = await rescheduleSchedule(database.db, workspaceId, {
    actorId,
    scheduleId: missedRescheduleClaim.schedule.id,
    expectedVersion: missedRescheduleClaim.schedule.version,
    scheduledAt: new Date(Date.now() + 10_800_000),
    timezone: "UTC",
    idempotencyKey: "reschedule-missed-command",
    requestHash: "reschedule-missed-command-hash",
    requestId: null,
  });
  assertStatus(rescheduledMissed.status, "created", "reschedule missed");
  const preservedMissedOperation = await readOperationState(
    missedReschedule.operationId,
  );
  if (
    preservedMissedOperation?.lifecycle !== "failed" ||
    preservedMissedOperation.version !== missedOperationVersion
  ) {
    throw new Error("rescheduling changed the missed terminal operation");
  }

  const earlyWakeApproval = await approveX(10, "early-wake");
  const earlyWake = await createFutureSchedule(earlyWakeApproval, "early-wake");
  if (!("schedule" in earlyWake) || typeof earlyWake.operationId !== "string") {
    throw new Error("early wake fixture missing schedule");
  }
  const earlyWakeAt = new Date();
  const earlyWakeEffectiveAt = new Date(earlyWakeAt.getTime() - 5_001);
  const earlyWakeOutboxId = await simulateConsumedPublicationEvent(
    earlyWake.operationId,
    earlyWake.schedule.id,
    earlyWakeEffectiveAt,
    new Date(earlyWakeEffectiveAt.getTime() - 1),
  );
  const recoveryEvents = (
    await Promise.all([
      enqueueStrandedPublicationRecoveries(
        database.db,
        workspaceId,
        earlyWakeAt,
      ),
      enqueueStrandedPublicationRecoveries(
        database.db,
        workspaceId,
        earlyWakeAt,
      ),
    ])
  ).flat();
  const recoveryOutboxId = recoveryEvents[0]?.id;
  if (
    recoveryEvents.length !== 1 ||
    !recoveryOutboxId ||
    recoveryOutboxId === earlyWakeOutboxId
  ) {
    throw new Error("early wake recovery did not enqueue one fresh event");
  }
  const duplicateRearm = await enqueueStrandedPublicationRecoveries(
    database.db,
    workspaceId,
    new Date(earlyWakeAt.getTime() + 1),
  );
  if (duplicateRearm.length !== 0) {
    throw new Error("pending early wake recovery was rearmed twice");
  }
  const acceptedAt = new Date(earlyWakeAt.getTime() + 2);
  await client.query(
    `update outbox_event
     set dispatched_at = $1, next_attempt_at = $1, updated_at = $1
     where id = $2 and workspace_id = $3`,
    [acceptedAt, recoveryOutboxId, workspaceId],
  );
  const acceptedReplay = await enqueueStrandedPublicationRecoveries(
    database.db,
    workspaceId,
    new Date(acceptedAt.getTime() + 1),
  );
  if (acceptedReplay.length !== 0) {
    throw new Error("accepted early wake recovery created an event storm");
  }
  const recoveredClaim = await claimPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: earlyWake.operationId,
      publicationId: earlyWake.schedule.publicationId,
      claimedBy: "publishing-domain-probe-early-wake",
      now: new Date(acceptedAt.getTime() + 2),
      leaseExpiresAt: new Date(acceptedAt.getTime() + 60_002),
    },
  );
  if (recoveredClaim.status !== "claimed") {
    throw new Error(
      `early wake recovery claim returned ${recoveredClaim.status}`,
    );
  }

  const recoveryMissApproval = await approveX(11, "recovery-missed");
  const recoveryMissed = await createFutureSchedule(
    recoveryMissApproval,
    "recovery-missed",
  );
  if (
    !("schedule" in recoveryMissed) ||
    typeof recoveryMissed.operationId !== "string"
  ) {
    throw new Error("recovery missed fixture missing schedule");
  }
  const recoveryMissedAt = new Date();
  const recoveryMissedEffectiveAt = new Date(
    recoveryMissedAt.getTime() - 5 * 60_000 - 1,
  );
  await simulateConsumedPublicationEvent(
    recoveryMissed.operationId,
    recoveryMissed.schedule.id,
    recoveryMissedEffectiveAt,
    new Date(recoveryMissedEffectiveAt.getTime() + 1),
  );
  const missedRearm = await enqueueStrandedPublicationRecoveries(
    database.db,
    workspaceId,
    recoveryMissedAt,
  );
  if (missedRearm.length !== 1) {
    throw new Error("overdue queued schedule was not rearmed for settlement");
  }
  const recoveredMiss = await claimPublicationExecution(
    database.db,
    workspaceId,
    {
      operationId: recoveryMissed.operationId,
      publicationId: recoveryMissed.schedule.publicationId,
      claimedBy: "publishing-domain-probe-recovery-missed",
      now: recoveryMissedAt,
      leaseExpiresAt: new Date(recoveryMissedAt.getTime() + 60_000),
    },
  );
  if (recoveredMiss.status !== "missed") {
    throw new Error(`overdue queued schedule returned ${recoveredMiss.status}`);
  }
  const attemptRows = await client
    .query<{ attemptCount: string }>(
      `select count(*)::text as "attemptCount"
     from operation_attempt
     where workspace_id = $1 and operation_id = $2`,
      [workspaceId, recoveryMissed.operationId],
    )
    .then(({ rows }) => rows);
  if (attemptRows[0]?.attemptCount !== "0") {
    throw new Error("missed queued schedule allocated a provider attempt");
  }
  observed.push(
    "cancel-reschedule-missed-cas",
    "cancelled-predecessor-operations",
    "missed-terminal-operation-summary",
    "missed-recovery-rearm-claim-renew-settle",
    "missed-recovery-preserves-historical-schedule",
    "missed-reschedule-preserves-terminal-operation",
    "queued-schedule-early-wake-single-rearm",
    "queued-schedule-miss-no-provider-attempt",
    "immutable-successor-schedule",
  );
}

async function simulateConsumedPublicationEvent(
  operationId: string,
  scheduleId: string,
  effectiveAt: Date,
  dispatchedAt: Date,
) {
  await client.query(
    `update schedule
     set scheduled_at = $1, effective_at = $1, updated_at = $2
     where id = $3 and workspace_id = $4`,
    [effectiveAt, dispatchedAt, scheduleId, workspaceId],
  );
  return simulateConsumedOutboxEvent(operationId, dispatchedAt);
}

async function simulateConsumedOutboxEvent(
  operationId: string,
  dispatchedAt: Date,
) {
  const { rows } = await client.query<{ id: string }>(
    `update outbox_event
     set dispatched_at = $1, dispatch_attempt_count = 1,
         next_attempt_at = $1, updated_at = $1
     where operation_id = $2 and workspace_id = $3
     returning id`,
    [dispatchedAt, operationId, workspaceId],
  );
  if (rows.length !== 1 || !rows[0]) {
    throw new Error("early wake fixture outbox event missing");
  }
  return rows[0].id;
}

async function proveRetryAndAmbiguity() {
  const retryApproval = await approveX(5, "retry");
  const first = await admit(retryApproval, "definite-first");
  if (!("publication" in first))
    throw new Error("definite fixture missing publication");
  const firstClaim = await claimProbePublication(
    first.operationId,
    first.publication.id,
    "definite-first",
  );
  const released = await settlePublicationExecution(database.db, workspaceId, {
    attemptId: null,
    claimedBy: "definite-first",
    expectedOperationVersion: firstClaim.operation.version,
    failureCode: "PROVIDER_CAPABILITY_UNAVAILABLE",
    outcome: "definite_failure",
    publicationId: first.publication.id,
    operationId: first.operationId,
  });
  if (!released) throw new Error("definite failure did not release slot");
  for (const [destinationAccountId, expected, label] of [
    [unmappedXDestinationId, "destination_not_mapped", "unmapped retry"],
    [instagramDestinationId, "destination_not_mapped", "cross-platform retry"],
    [disabledXDestinationId, "destination_disabled", "disabled retry"],
    [unboundXDestinationId, "destination_unbound", "unbound retry"],
  ] as const) {
    const fenced = await admitDirectPublication(database.db, workspaceId, {
      actorId,
      expectedRevisionVersion: 1,
      approvalId: retryApproval,
      destinationAccountId,
      expectedPublicationVersion: released.publication.version,
      commandKind: "retry",
      idempotencyKey: `fenced-${label}`,
      requestHash: `fenced-${label}-hash`,
      requestId: null,
    });
    assertStatus(fenced.status, expected, label);
  }
  const retry = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId: retryApproval,
    destinationAccountId: alternateXDestinationId,
    expectedPublicationVersion: released.publication.version,
    commandKind: "retry",
    idempotencyKey: "definite-successor",
    requestHash: "definite-successor-hash",
    requestId: null,
  });
  assertStatus(retry.status, "created", "definite failure successor");
  if (!("operationId" in retry)) throw new Error("retry operation missing");
  const retryContext = await readPublicationCommandContext(
    database.db,
    workspaceId,
    first.publication.id,
  );
  if (retryContext?.destinationAccountId !== alternateXDestinationId) {
    throw new Error("alternate retry destination was not selected");
  }
  const retryClaim = await claimProbePublication(
    retry.operationId,
    retry.publication.id,
    "definite-successor",
  );
  const pending = await settlePublicationExecution(database.db, workspaceId, {
    attemptId: null,
    claimedBy: "definite-successor",
    expectedOperationVersion: retryClaim.operation.version,
    failureCode: "PROVIDER_CAPABILITY_UNAVAILABLE",
    outcome: "definite_failure",
    publicationId: retry.publication.id,
    operationId: retry.operationId,
  });
  if (!pending) throw new Error("retry settlement missing");
  if (
    !(await markSettlementActivityFailed(
      database.db,
      workspaceId,
      retry.operationId,
      "INTERNAL_SERVER_ERROR",
    ))
  ) {
    throw new Error("activity failure state missing");
  }
  if (
    !(await rearmSettlementActivity(
      database.db,
      workspaceId,
      retry.operationId,
    ))
  ) {
    throw new Error("activity rearm missing");
  }
  const settlementOccurredAt = new Date();
  const settlementActivityInput = {
    actorId,
    eventType: "publication.failed" as const,
    idempotencyKey: `publication-settlement:${retry.operationId}:publication.failed`,
    operationId: retry.operationId,
    publicationId: retry.publication.id,
    requestHash: `${retry.publication.id}:${retry.operationId}:publication.failed`,
    occurredAt: settlementOccurredAt,
  };
  const recordedActivity = await recordPublicationSettlementActivity(
    database.db,
    workspaceId,
    settlementActivityInput,
  );
  assertStatus(recordedActivity.status, "created", "activity recorded state");
  const replayedActivity = await recordPublicationSettlementActivity(
    database.db,
    workspaceId,
    settlementActivityInput,
  );
  assertStatus(replayedActivity.status, "replayed", "activity atomic replay");
  if (
    replayedActivity.event.id !== recordedActivity.event.id ||
    recordedActivity.operation.settlementActivityRecordedAt?.getTime() !==
      settlementOccurredAt.getTime() ||
    replayedActivity.operation.settlementActivityRecordedAt?.getTime() !==
      settlementOccurredAt.getTime()
  ) {
    throw new Error("activity replay diverged from atomic recording");
  }

  const ambiguousApproval = await approveX(6, "ambiguous");
  const ambiguous = await admit(ambiguousApproval, "ambiguous-first");
  if (!("publication" in ambiguous))
    throw new Error("ambiguous fixture missing publication");
  const ambiguousClaim = await claimProbePublication(
    ambiguous.operationId,
    ambiguous.publication.id,
    "ambiguous-first",
  );
  const ambiguousAttempt = await beginOrResumePublicationAttempt(
    database.db,
    workspaceId,
    {
      operationId: ambiguous.operationId,
      claimedBy: "ambiguous-first",
      now: new Date(),
    },
  );
  if (!ambiguousAttempt) throw new Error("ambiguous attempt missing");
  const attemptId = ambiguousAttempt.id;
  assertStatus(
    (
      await claimPublicationFinalEffect(database.db, workspaceId, {
        operationId: ambiguous.operationId,
        attemptId,
        claimedBy: "ambiguous-first",
      })
    ).status,
    "claimed",
    "final effect claim",
  );
  assertStatus(
    (
      await claimPublicationFinalEffect(database.db, workspaceId, {
        operationId: ambiguous.operationId,
        attemptId,
        claimedBy: "ambiguous-first",
      })
    ).status,
    "already_started",
    "final effect replay fence",
  );
  const unknown = await settlePublicationExecution(database.db, workspaceId, {
    attemptId,
    claimedBy: "ambiguous-first",
    expectedOperationVersion: ambiguousClaim.operation.version,
    failureCode: "X_DELIVERY_UNKNOWN",
    outcome: "delivery_unknown",
    publicationId: ambiguous.publication.id,
    operationId: ambiguous.operationId,
  });
  if (!unknown) throw new Error("delivery unknown did not settle");
  const atomicTruth = await client.query<{
    attemptOutcome: string | null;
    failureCode: string | null;
    operationLifecycle: string;
    providerFailureCode: string | null;
  }>(
    `select attempt.outcome as "attemptOutcome", attempt.failure_code as "failureCode",
            attempt.provider_failure_code as "providerFailureCode", operation.lifecycle as "operationLifecycle"
       from operation_attempt attempt
       join operation on operation.id = attempt.operation_id
      where attempt.workspace_id = $1 and attempt.id = $2`,
    [workspaceId, attemptId],
  );
  const settledTruth = atomicTruth.rows[0];
  if (
    settledTruth?.attemptOutcome !== "ambiguous" ||
    settledTruth.failureCode !== "INTERNAL_SERVER_ERROR" ||
    settledTruth.providerFailureCode !== "X_DELIVERY_UNKNOWN" ||
    settledTruth.operationLifecycle !== "unknown"
  ) {
    throw new Error("atomic settlement lost generic or provider failure truth");
  }
  const attemptAfterSettlement = await beginOrResumePublicationAttempt(
    database.db,
    workspaceId,
    {
      operationId: ambiguous.operationId,
      claimedBy: "ambiguous-first",
      now: new Date(),
    },
  );
  if (attemptAfterSettlement) {
    throw new Error("ambiguous attempt was re-entered after settlement");
  }
  const blocked = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId: ambiguousApproval,
    destinationAccountId: xDestinationId,
    commandKind: "retry",
    expectedPublicationVersion: unknown.publication.version,
    idempotencyKey: "blocked-unknown",
    requestHash: "blocked-unknown-hash",
    requestId: null,
  });
  assertStatus(
    blocked.status,
    "publication_reconciliation_required",
    "unknown retry block",
  );
  const reconciliationRequest = {
    actorId,
    publicationId: ambiguous.publication.id,
    ambiguousAttemptId: attemptId,
    expectedVersion: unknown.publication.version,
    idempotencyKey: "request-reconciliation",
    requestHash: "request-reconciliation-hash",
    requestId: null,
  };
  const requested = await requestPublicationReconciliation(
    database.db,
    workspaceId,
    reconciliationRequest,
  );
  assertStatus(requested.status, "created", "reconciliation request");
  const requestReplay = await requestPublicationReconciliation(
    database.db,
    workspaceId,
    reconciliationRequest,
  );
  assertStatus(
    requestReplay.status,
    "replayed",
    "reconciliation request replay",
  );
  const requestMismatch = await requestPublicationReconciliation(
    database.db,
    workspaceId,
    { ...reconciliationRequest, requestHash: "changed" },
  );
  assertStatus(
    requestMismatch.status,
    "idempotency_mismatch",
    "reconciliation request mismatch",
  );
  if (!("operationId" in requested)) {
    throw new Error("reconciliation request operation missing");
  }
  const reconciliationClaimedBy = "publishing-reconciliation-probe";
  const reconciliationClaim = await claimOperationExecution(
    database.db,
    workspaceId,
    {
      claimedBy: reconciliationClaimedBy,
      id: requested.operationId,
      leaseExpiresAt: new Date(Date.now() + 60_000),
      now: new Date(),
    },
  );
  assertStatus(
    reconciliationClaim.status,
    "claimed",
    "reconciliation operation claim",
  );
  if (reconciliationClaim.status !== "claimed") {
    throw new Error("reconciliation operation claim missing");
  }
  const reconciliationAttempt = await allocateOperationAttempt(
    database.db,
    workspaceId,
    requested.operationId,
  );
  if (!reconciliationAttempt) {
    throw new Error("reconciliation operation attempt missing");
  }
  const reconciliationSettlement = {
    attemptId: reconciliationAttempt.id,
    claimedBy: reconciliationClaimedBy,
    expectedVersion: reconciliationClaim.operation.version,
    operationId: requested.operationId,
  };
  const settledReconciliationOperation =
    await settleReconciliationOperationSuccess(
      database.db,
      workspaceId,
      reconciliationSettlement,
    );
  if (!settledReconciliationOperation) {
    throw new Error("reconciliation operation settlement missing");
  }
  const replayedReconciliationSettlement =
    await settleReconciliationOperationSuccess(
      database.db,
      workspaceId,
      reconciliationSettlement,
    );
  if (!replayedReconciliationSettlement) {
    throw new Error("reconciliation operation settlement replay missing");
  }
  const outbox = await client.query<{ event_type: string }>(
    "select event_type from outbox_event where workspace_id = $1 and operation_id = $2",
    [workspaceId, requested.operationId],
  );
  if (
    outbox.rowCount !== 1 ||
    outbox.rows[0]?.event_type !==
      "operation/publication-reconciliation.requested"
  ) {
    throw new Error("reconciliation request outbox identity missing");
  }
  const rejectedAttestation = await recordPublicationReconciliation(
    database.db,
    workspaceId,
    {
      actorId,
      authority: "operator",
      publicationId: ambiguous.publication.id,
      ambiguousAttemptId: attemptId,
      expectedVersion: unknown.publication.version,
      decision: "delivered",
      idempotencyKey: "reject-x-attestation",
      requestHash: "reject-x-attestation-hash",
    },
  );
  assertStatus(
    rejectedAttestation.status,
    "evidence_insufficient",
    "X operator attestation fence",
  );
  const checkpointId = randomUUID();
  await client.query(
    `insert into publish_checkpoint
      (id, workspace_id, publication_id, operation_id, operation_attempt_id, platform, kind, provider_reference_id)
     values ($1, $2, $3, $4, $5, 'x', 'x_post', 'probe-post')`,
    [
      checkpointId,
      workspaceId,
      ambiguous.publication.id,
      ambiguous.operationId,
      attemptId,
    ],
  );
  const reconciled = await recordPublicationReconciliation(
    database.db,
    workspaceId,
    {
      authority: "provider",
      publicationId: ambiguous.publication.id,
      ambiguousAttemptId: attemptId,
      expectedVersion: unknown.publication.version,
      decision: "delivered",
      evidenceCheckpointId: checkpointId,
      idempotencyKey: "reconcile-delivered",
      requestHash: "reconcile-delivered-hash",
    },
  );
  assertStatus(reconciled.status, "recorded", "reconciliation");
  if (!reconciled.publication)
    throw new Error("reconciliation publication missing");
  if (
    reconciled.publication.confirmedProviderResultId !== "probe-post" ||
    reconciled.publication.confirmedCheckpointId !== checkpointId
  ) {
    throw new Error(
      "provider reconciliation stored non-authoritative identity",
    );
  }
  assertStatus(
    (
      await recordPublicationReconciliation(database.db, workspaceId, {
        authority: "provider",
        publicationId: ambiguous.publication.id,
        ambiguousAttemptId: attemptId,
        expectedVersion: unknown.publication.version,
        decision: "delivered",
        evidenceCheckpointId: checkpointId,
        idempotencyKey: "reconcile-delivered",
        requestHash: "reconcile-delivered-hash",
      })
    ).status,
    "replayed",
    "provider reconciliation replay",
  );
  const confirmedBlock = await admitDirectPublication(
    database.db,
    workspaceId,
    {
      actorId,
      expectedRevisionVersion: 1,
      approvalId: ambiguousApproval,
      destinationAccountId: xDestinationId,
      commandKind: "retry",
      expectedPublicationVersion: reconciled.publication.version,
      idempotencyKey: "blocked-confirmed",
      requestHash: "blocked-confirmed-hash",
      requestId: null,
    },
  );
  assertStatus(
    confirmedBlock.status,
    "publication_already_confirmed",
    "confirmed slot",
  );
  observed.push(
    "definite-failure-successor",
    "delivery-unknown-block",
    "confirmed-terminal-slot",
    "alternate-destination-retry-and-invalid-target-fences",
    "outbox-owned-provider-reconciliation",
    "authoritative-provider-identity",
    "atomic-settlement-activity-lifecycle-rearm-replay",
    "atomic-attempt-publication-operation-settlement",
    "final-provider-effect-cas",
    "settled-attempt-reentry-block",
    "atomic-reconciliation-operation-settlement-replay",
  );
}

async function proveScheduledReconciliation() {
  for (const [index, key, decision, expectedSchedule] of [
    [7, "scheduled-delivered", "delivered", "completed"],
    [8, "scheduled-not-delivered", "not_delivered", "failed"],
  ] as const) {
    const approvalId = await approveX(index, key);
    const scheduled = await createFutureSchedule(approvalId, key);
    if (
      !("schedule" in scheduled) ||
      typeof scheduled.operationId !== "string"
    ) {
      throw new Error(`${key} schedule or operation missing`);
    }
    const operationId = scheduled.operationId;
    const now = new Date(scheduled.schedule.effectiveAt.getTime() + 1_000);
    const claim = await claimPublicationExecution(database.db, workspaceId, {
      operationId,
      publicationId: scheduled.schedule.publicationId,
      claimedBy: key,
      now,
      leaseExpiresAt: new Date(now.getTime() + 60_000),
    });
    assertStatus(claim.status, "claimed", `${key} claim`);
    if (claim.status !== "claimed") throw new Error(`${key} claim missing`);
    const attempt = await beginOrResumePublicationAttempt(
      database.db,
      workspaceId,
      { operationId, claimedBy: key, now },
    );
    if (!attempt) throw new Error(`${key} attempt missing`);
    const attemptId = attempt.id;
    const unknown = await settlePublicationExecution(database.db, workspaceId, {
      attemptId,
      claimedBy: key,
      expectedOperationVersion: claim.operation.version,
      failureCode: "X_DELIVERY_UNKNOWN",
      operationId,
      outcome: "delivery_unknown",
      publicationId: scheduled.schedule.publicationId,
    });
    if (!unknown) throw new Error(`${key} unknown settlement missing`);
    const checkpointId = randomUUID();
    const providerReferenceId = `${key}-provider-result`;
    await client.query(
      `insert into publish_checkpoint
        (id, workspace_id, publication_id, operation_id, operation_attempt_id, platform, kind, provider_reference_id)
       values ($1, $2, $3, $4, $5, 'x', 'x_post', $6)`,
      [
        checkpointId,
        workspaceId,
        scheduled.schedule.publicationId,
        operationId,
        attemptId,
        providerReferenceId,
      ],
    );
    const reconciled = await recordPublicationReconciliation(
      database.db,
      workspaceId,
      {
        authority: "provider",
        publicationId: scheduled.schedule.publicationId,
        ambiguousAttemptId: attemptId,
        expectedVersion: unknown.publication.version,
        decision,
        evidenceCheckpointId: checkpointId,
        idempotencyKey: `reconcile-${key}`,
        requestHash: `reconcile-${key}-hash`,
      },
    );
    assertStatus(reconciled.status, "recorded", `${key} reconciliation`);
    const scheduleResult = await client.query<{ lifecycle: string }>(
      "select lifecycle from schedule where workspace_id = $1 and id = $2",
      [workspaceId, scheduled.schedule.id],
    );
    if (scheduleResult.rows[0]?.lifecycle !== expectedSchedule) {
      throw new Error(`${key} schedule did not settle ${expectedSchedule}`);
    }
  }
  observed.push("scheduled-reconciliation-completed-failed-settlement");
}

async function proveTelegramAttestation() {
  const approval = await grantApproval(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    draftRevisionId: telegramRevisionId,
    selectedFinalMediaAssetId: null,
    idempotencyKey: "telegram-approval",
    requestHash: "telegram-approval-hash",
  });
  if (!("approval" in approval)) throw new Error("telegram approval missing");
  const admitted = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId: approval.approval.id,
    destinationAccountId: telegramDestinationId,
    idempotencyKey: "telegram-publication",
    requestHash: "telegram-publication-hash",
    requestId: null,
  });
  if (!("publication" in admitted))
    throw new Error("telegram admission missing");
  const claim = await claimProbePublication(
    admitted.operationId,
    admitted.publication.id,
    "telegram-attestation",
  );
  const attempt = await beginOrResumePublicationAttempt(
    database.db,
    workspaceId,
    {
      operationId: admitted.operationId,
      claimedBy: "telegram-attestation",
      now: new Date(),
    },
  );
  if (!attempt) throw new Error("telegram attempt missing");
  const attemptId = attempt.id;
  const unknown = await settlePublicationExecution(database.db, workspaceId, {
    attemptId,
    claimedBy: "telegram-attestation",
    expectedOperationVersion: claim.operation.version,
    failureCode: "TELEGRAM_DELIVERY_UNKNOWN",
    outcome: "delivery_unknown",
    publicationId: admitted.publication.id,
    operationId: admitted.operationId,
  });
  if (!unknown) throw new Error("telegram unknown settlement missing");
  const providerRequest = await requestPublicationReconciliation(
    database.db,
    workspaceId,
    {
      actorId,
      publicationId: admitted.publication.id,
      ambiguousAttemptId: attemptId,
      expectedVersion: unknown.publication.version,
      idempotencyKey: "telegram-provider-request",
      requestHash: "telegram-provider-request-hash",
      requestId: null,
    },
  );
  assertStatus(
    providerRequest.status,
    "telegram_attestation_required",
    "telegram provider reconciliation fence",
  );
  const attested = await recordPublicationReconciliation(
    database.db,
    workspaceId,
    {
      actorId,
      authority: "operator",
      publicationId: admitted.publication.id,
      ambiguousAttemptId: attemptId,
      expectedVersion: unknown.publication.version,
      decision: "delivered",
      idempotencyKey: "telegram-attestation",
      requestHash: "telegram-attestation-hash",
    },
  );
  assertStatus(attested.status, "recorded", "telegram attestation");
  if (
    !attested.publication ||
    attested.publication.confirmedProviderResultId !== null ||
    attested.publication.confirmedCheckpointId !== null
  ) {
    throw new Error("telegram attestation fabricated provider identity");
  }
  const attestationReplay = await recordPublicationReconciliation(
    database.db,
    workspaceId,
    {
      actorId,
      authority: "operator",
      publicationId: admitted.publication.id,
      ambiguousAttemptId: attemptId,
      expectedVersion: unknown.publication.version,
      decision: "delivered",
      idempotencyKey: "telegram-attestation",
      requestHash: "telegram-attestation-hash",
    },
  );
  assertStatus(
    attestationReplay.status,
    "replayed",
    "telegram attestation replay",
  );
  if (
    attestationReplay.status !== "replayed" ||
    !attestationReplay.publication ||
    attestationReplay.publication.version !== attested.publication.version
  ) {
    throw new Error("telegram attestation replay returned a stale version");
  }
  observed.push(
    "telegram-only-attestation-without-provider-result",
    "telegram-attestation-replay-publication-version",
  );
}

async function provePublishingPause() {
  const paused = await setPublishingPaused(database.db, workspaceId, {
    actorId,
    paused: true,
    reasonCode: "operator",
    expectedVersion: 0,
    idempotencyKey: "pause",
    requestHash: "pause-hash",
  });
  assertStatus(paused.status, "updated", "pause");
  const approvalId = await approveX(0, "paused-admission");
  assertStatus(
    (await admit(approvalId, "paused-admission")).status,
    "publishing_paused",
    "paused admission",
  );
  if (!paused.control) throw new Error("pause control missing");
  assertStatus(
    (
      await setPublishingPaused(database.db, workspaceId, {
        actorId,
        paused: false,
        reasonCode: null,
        expectedVersion: paused.control.version,
        idempotencyKey: "resume",
        requestHash: "resume-hash",
      })
    ).status,
    "updated",
    "resume",
  );
  observed.push("pause-cas");
}

async function proveInstagramGrant() {
  const approval = await grantApproval(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    draftRevisionId: instagramRevisionIds[0] as string,
    selectedFinalMediaAssetId: genericImageId,
    idempotencyKey: "instagram-publication-approval",
    requestHash: "instagram-publication-approval-hash",
  });
  if (!("approval" in approval)) throw new Error("instagram approval missing");
  const publication = await admitDirectPublication(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId: approval.approval.id,
    destinationAccountId: instagramDestinationId,
    idempotencyKey: "instagram-publication",
    requestHash: "instagram-publication-hash",
    requestId: null,
  });
  if (!("publication" in publication))
    throw new Error("instagram publication missing");
  const rawToken = "probe-token";
  const tokenHash = hashPublishingMediaGrant(rawToken);
  const grant = await issuePublishingMediaGrant(database.db, workspaceId, {
    publicationId: publication.publication.id,
    operationId: publication.operationId,
    mediaAssetId: genericImageId,
    rawToken,
    expiresAt: new Date(Date.now() + 120_000),
  });
  const firstFetch = await fetchPublishingMediaGrant(
    database.db,
    workspaceId,
    tokenHash,
    new Date(),
  );
  const refetch = await fetchPublishingMediaGrant(
    database.db,
    workspaceId,
    tokenHash,
    new Date(),
  );
  const crossWorkspaceFetch = await fetchPublishingMediaGrant(
    database.db,
    otherWorkspaceId,
    tokenHash,
    new Date(),
  );
  if (!firstFetch || !refetch || firstFetch.grant.id !== refetch.grant.id) {
    throw new Error("pre-acceptance grant refetch failed");
  }
  if (crossWorkspaceFetch !== null) {
    throw new Error("publishing media grant crossed workspace boundary");
  }
  const accepted = await acceptPublishingMediaGrantForContainer(
    database.db,
    workspaceId,
    grant.id,
  );
  const replayedAcceptance = await acceptPublishingMediaGrantForContainer(
    database.db,
    workspaceId,
    grant.id,
  );
  if (
    accepted.id !== grant.id ||
    replayedAcceptance.id !== grant.id ||
    (await fetchPublishingMediaGrant(
      database.db,
      workspaceId,
      tokenHash,
      new Date(),
    )) !== null
  ) {
    throw new Error("post-acceptance grant remained usable");
  }
  observed.push(
    "short-lived-instagram-grant-refetch-cas-post-acceptance-rejection",
    "workspace-scoped-instagram-grant-fetch",
  );
}

async function assertCancelledOperation(
  operationId: string,
  expectedVersion: number,
  label: string,
) {
  const current = await readOperationState(operationId);
  if (
    current?.lifecycle !== "cancelled" ||
    current.version !== expectedVersion ||
    current.claimedAt !== null ||
    current.claimedBy !== null ||
    current.leaseExpiresAt !== null
  ) {
    throw new Error(`${label} predecessor operation was not cancelled`);
  }
}

async function readOperationState(operationId: string) {
  const result = await client.query<{
    claimedAt: Date | null;
    claimedBy: string | null;
    leaseExpiresAt: Date | null;
    lifecycle: string;
    version: number;
  }>(
    `select claimed_at as "claimedAt", claimed_by as "claimedBy",
            lease_expires_at as "leaseExpiresAt", lifecycle, version
       from operation
      where workspace_id = $1 and id = $2`,
    [workspaceId, operationId],
  );
  return result.rows[0] ?? null;
}

async function readScheduleState(scheduleId: string) {
  const result = await client.query<{
    lifecycle: string;
    version: number;
  }>(
    `select lifecycle, version
       from schedule
      where workspace_id = $1 and id = $2`,
    [workspaceId, scheduleId],
  );
  return result.rows[0] ?? null;
}

async function claimProbePublication(
  operationId: string,
  publicationId: string,
  claimedBy: string,
) {
  const now = new Date();
  const claimed = await claimPublicationExecution(database.db, workspaceId, {
    operationId,
    publicationId,
    claimedBy,
    now,
    leaseExpiresAt: new Date(now.getTime() + 60_000),
  });
  if (claimed.status !== "claimed") {
    throw new Error(`${claimedBy} claim returned ${claimed.status}`);
  }
  return claimed;
}

async function approveX(index: number, key: string) {
  const result = await grantApproval(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    draftRevisionId: xRevisionIds[index] as string,
    selectedFinalMediaAssetId: null,
    idempotencyKey: `approval-${key}`,
    requestHash: `approval-${key}-hash`,
  });
  if (!("approval" in result))
    throw new Error(`${key} approval failed: ${result.status}`);
  return result.approval.id;
}

async function admit(approvalId: string, key: string) {
  return admitDirectPublication(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId,
    destinationAccountId: xDestinationId,
    idempotencyKey: key,
    requestHash: `${key}-hash`,
    requestId: null,
  });
}

async function createFutureSchedule(approvalId: string, key: string) {
  return createSchedule(database.db, workspaceId, {
    actorId,
    expectedRevisionVersion: 1,
    approvalId,
    destinationAccountId: xDestinationId,
    scheduledAt: new Date(Date.now() + 3_600_000),
    timezone: "UTC",
    idempotencyKey: `schedule-${key}`,
    requestHash: `schedule-${key}-hash`,
    requestId: null,
  });
}

async function insertFixture() {
  await client.query("set session_replication_role = replica");
  await client.query(
    "insert into workspace (id, name) values ($1, $2), ($3, $4)",
    [
      workspaceId,
      `Publishing probe ${workspaceId}`,
      otherWorkspaceId,
      `Publishing other ${otherWorkspaceId}`,
    ],
  );
  await client.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Probe', $2, true), ($3, 'Probe', $4, true)`,
    [
      actorId,
      `${actorId}@example.invalid`,
      otherActorId,
      `${otherActorId}@example.invalid`,
    ],
  );
  await client.query(
    `insert into media_brand (id, workspace_id, key, name, sort_order) values ($1, $2, 'probe', 'Probe', 1)`,
    [brandId, workspaceId],
  );
  await client.query(
    `insert into operation (id, workspace_id, actor, command_type, idempotency_key, request_hash, lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
     values ($1, $2, $3, 'probe-analysis', 'analysis', 'analysis', 'succeeded', now(), 0, 1, now(), now())`,
    [originOperationId, workspaceId, actorId],
  );
  await client.query(
    `insert into analysis_run (id, workspace_id, kind, operation_id, configuration, template_fingerprint, semantic_status, started_at, created_at, updated_at)
     values ($1, $2, 'news', $3, $4::jsonb, 'probe-template', 'skipped', now(), now(), now())`,
    [
      originRunId,
      workspaceId,
      originOperationId,
      JSON.stringify({
        kind: "news",
        brands: ["probe"],
        models: ["probe-model"],
        platforms: ["telegram", "x"],
        sourceIds: [],
        windowHours: 24,
        enrichmentEnabled: true,
        telegramOnly: false,
        orderingMode: "views",
        topN: 10,
        topics: [],
      }),
    ],
  );
  await client.query(
    `insert into analysis_model_unit (id, workspace_id, analysis_run_id, media_brand_id, model_option_key, task_key, status, created_at, updated_at)
     values ($1, $2, $3, $4, 'probe-model', 'probe', 'succeeded', now(), now())`,
    [originUnitId, workspaceId, originRunId, brandId],
  );
  await client.query(
    `insert into editorial_selection (id, workspace_id, analysis_model_unit_id, rank, source_item_id, suggested_platform, created_at, updated_at)
     values ($1, $2, $3, 1, $4, 'x', now(), now())`,
    [originSelectionId, workspaceId, originUnitId, randomUUID()],
  );
  await client.query(
    `insert into destination_account (id, workspace_id, key, platform, enabled, binding_present)
     values ($1, $7, 'x-probe', 'x', true, true),
            ($2, $7, 'x-alternate', 'x', true, true),
            ($3, $7, 'x-disabled', 'x', false, true),
            ($4, $7, 'x-unbound', 'x', true, false),
            ($5, $7, 'x-unmapped', 'x', true, true),
            ($6, $7, 'telegram-probe', 'telegram', true, true),
            ($8, $7, 'instagram-probe', 'instagram', true, true)`,
    [
      xDestinationId,
      alternateXDestinationId,
      disabledXDestinationId,
      unboundXDestinationId,
      unmappedXDestinationId,
      telegramDestinationId,
      workspaceId,
      instagramDestinationId,
    ],
  );
  await client.query(
    `insert into media_brand_destination_account (workspace_id, media_brand_id, destination_account_id)
     values ($1, $2, $3), ($1, $2, $4), ($1, $2, $5), ($1, $2, $6), ($1, $2, $7), ($1, $2, $8)`,
    [
      workspaceId,
      brandId,
      xDestinationId,
      alternateXDestinationId,
      disabledXDestinationId,
      unboundXDestinationId,
      telegramDestinationId,
      instagramDestinationId,
    ],
  );
  await client.query(
    `insert into media_asset
      (id, workspace_id, kind, object_key, mime_type, declared_bytes, actual_bytes, checksum, lifecycle, verified_at)
     values ($1, $3, 'image', $4, 'image/png', 1, 1, 'generic', 'verified', now()),
            ($2, $3, 'image_final', $5, 'image/png', 1, 1, 'orphan', 'verified', now())`,
    [
      genericImageId,
      orphanGeneratedImageId,
      workspaceId,
      `probe/${genericImageId}`,
      `probe/${orphanGeneratedImageId}`,
    ],
  );
  for (let index = 0; index < xDraftIds.length; index += 1) {
    await insertDraft(
      xDraftIds[index] as string,
      xRevisionIds[index] as string,
      "x",
      null,
      index + 1,
    );
  }
  await client.query(
    `insert into draft_revision (id, workspace_id, platform_draft_id, revision_number, content_locale, headline, body, hashtags, originating_copy_variant_id, authored_by)
     select $1, workspace_id, platform_draft_id, 2, content_locale, 'Changed probe', body, hashtags, originating_copy_variant_id, authored_by
     from draft_revision where workspace_id = $2 and id = $3`,
    [historicalSuccessorId, workspaceId, xRevisionIds[12]],
  );
  await insertDraft(telegramDraftId, telegramRevisionId, "telegram", null, 10);
  await insertDraft(
    instagramDraftIds[0] as string,
    instagramRevisionIds[0] as string,
    "instagram",
    genericImageId,
    20,
  );
  await insertDraft(
    instagramDraftIds[1] as string,
    instagramRevisionIds[1] as string,
    "instagram",
    orphanGeneratedImageId,
    21,
  );
  await client.query("set session_replication_role = origin");
}

async function insertDraft(
  draftId: string,
  revisionId: string,
  platform: "instagram" | "telegram" | "x",
  mediaAssetId: string | null,
  lanePosition: number,
) {
  await client.query(
    `insert into platform_draft
      (id, workspace_id, media_brand_id, platform, editorial_selection_id, lane_position)
     values ($1, $2, $3, $4, $5, $6)`,
    [draftId, workspaceId, brandId, platform, originSelectionId, lanePosition],
  );
  await client.query(
    `insert into draft_revision
      (id, workspace_id, platform_draft_id, revision_number, content_locale, headline, body, hashtags,
       originating_copy_variant_id, selected_final_media_asset_id, authored_by)
     values ($1, $2, $3, 1, 'en', 'Probe', 'Probe body', array['probe'], $4, $5, $6)`,
    [revisionId, workspaceId, draftId, randomUUID(), mediaAssetId, actorId],
  );
  await client.query(
    "update platform_draft set active_revision_id = $1, revision_version = 1 where workspace_id = $2 and id = $3",
    [revisionId, workspaceId, draftId],
  );
}

async function cleanup() {
  await client.query("set session_replication_role = replica");
  for (const table of [
    "publishing_media_grant",
    "publication_reconciliation",
    "publish_checkpoint",
    "activity_event",
    "outbox_event",
    "schedule",
    "publish_operation",
    "operation_attempt",
    "publication",
    "operation",
    "approval",
    "saved_card",
    "draft_revision_command_receipt",
    "publishing_control",
    "draft_revision",
    "platform_draft",
    "editorial_selection",
    "analysis_model_unit",
    "analysis_run",
    "media_brand_destination_account",
    "destination_account",
    "media_asset",
    "media_brand",
  ]) {
    await client.query(`delete from ${table} where workspace_id = $1`, [
      workspaceId,
    ]);
  }
  await client.query(`delete from "user" where id in ($1, $2)`, [
    actorId,
    otherActorId,
  ]);
  await client.query("delete from workspace where id = any($1::uuid[])", [
    [workspaceId, otherWorkspaceId],
  ]);
  await client.query("set session_replication_role = origin");
}

function assertStatus(actual: string, expected: string, label: string) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}
