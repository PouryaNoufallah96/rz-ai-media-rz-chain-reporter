import "server-only";

import { createHash } from "node:crypto";
import { installationProcedure } from "@rz-chain-reporter/api";
import {
  approveDraftInputSchema,
  approveDraftResultSchema,
  attestTelegramPublicationInputSchema,
  createScheduleInputSchema,
  directPublishInputSchema,
  mutateSavedCardInputSchema,
  mutateSavedCardResultSchema,
  publicationMutationResultSchema,
  publicationOperationResultSchema,
  publishingControlResultSchema,
  reconcilePublicationInputSchema,
  recoverMissedScheduleInputSchema,
  rescheduleInputSchema,
  retryPublicationInputSchema,
  saveCardInputSchema,
  saveCardResultSchema,
  scheduleMutationInputSchema,
  scheduleMutationResultSchema,
  scheduleOperationResultSchema,
  setPublishingPauseInputSchema,
} from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import { grantApproval } from "@rz-chain-reporter/db/repositories/approval";
import {
  admitDirectPublication,
  readPublicationCommandContext,
  recordPublicationReconciliation,
  requestPublicationReconciliation,
} from "@rz-chain-reporter/db/repositories/publication";
import { setPublishingPaused } from "@rz-chain-reporter/db/repositories/publishing-control";
import {
  mutateSavedCard,
  savePlatformDraft,
} from "@rz-chain-reporter/db/repositories/saved-card";
import {
  cancelSchedule,
  createSchedule,
  readMissedSchedule,
  rescheduleSchedule,
} from "@rz-chain-reporter/db/repositories/schedule";

import { customerTimeZone } from "@/lib/customer-template.server";

import { rpcDb } from "../db";

const publishingErrors = {
  UNAUTHORIZED: { status: 401 },
  VALIDATION_FAILED: { status: 400 },
  NOT_FOUND: { status: 404 },
  IDEMPOTENCY_KEY_REUSED: { status: 409 },
  VERSION_CONFLICT: { status: 409 },
  TRANSIENT_CONFLICT: { status: 409 },
  SAVED_CARD_ALREADY_ACTIVE: { status: 409 },
  APPROVAL_REQUIRED: { status: 409 },
  APPROVAL_SNAPSHOT_STALE: { status: 409 },
  MEDIA_NOT_PUBLISHABLE: { status: 409 },
  TEXT_ONLY_NOT_SUPPORTED: { status: 409 },
  DESTINATION_DISABLED: { status: 409 },
  DESTINATION_UNBOUND: { status: 409 },
  DESTINATION_NOT_MAPPED: { status: 409 },
  PUBLISHING_PAUSED: { status: 409 },
  SCHEDULE_IN_PAST: { status: 409 },
  SCHEDULE_VERSION_CONFLICT: { status: 409 },
  SCHEDULE_EFFECT_ALREADY_STARTED: { status: 409 },
  SCHEDULE_MISSED_CONFIRMATION_REQUIRED: { status: 409 },
  PUBLICATION_ALREADY_CLAIMED: { status: 409 },
  PUBLICATION_ALREADY_CONFIRMED: { status: 409 },
  PUBLICATION_RECONCILIATION_REQUIRED: { status: 409 },
  RECONCILIATION_EVIDENCE_INSUFFICIENT: { status: 409 },
  TELEGRAM_ATTESTATION_REQUIRED: { status: 409 },
} as const;

type PublishingRepositoryResult = Awaited<
  ReturnType<
    | typeof admitDirectPublication
    | typeof cancelSchedule
    | typeof createSchedule
    | typeof grantApproval
    | typeof mutateSavedCard
    | typeof recordPublicationReconciliation
    | typeof requestPublicationReconciliation
    | typeof rescheduleSchedule
    | typeof savePlatformDraft
    | typeof setPublishingPaused
  >
>;

type PublishingRepositoryErrorStatus = Exclude<
  PublishingRepositoryResult["status"],
  "created" | "recorded" | "replayed" | "updated"
>;

const publishingRepositoryErrorNames = {
  already_active: "SAVED_CARD_ALREADY_ACTIVE",
  approval_required: "APPROVAL_REQUIRED",
  approval_snapshot_stale: "APPROVAL_SNAPSHOT_STALE",
  destination_disabled: "DESTINATION_DISABLED",
  destination_not_mapped: "DESTINATION_NOT_MAPPED",
  destination_unbound: "DESTINATION_UNBOUND",
  evidence_insufficient: "RECONCILIATION_EVIDENCE_INSUFFICIENT",
  idempotency_mismatch: "IDEMPOTENCY_KEY_REUSED",
  media_not_publishable: "MEDIA_NOT_PUBLISHABLE",
  not_found: "NOT_FOUND",
  publication_already_claimed: "PUBLICATION_ALREADY_CLAIMED",
  publication_already_confirmed: "PUBLICATION_ALREADY_CONFIRMED",
  publication_reconciliation_required: "PUBLICATION_RECONCILIATION_REQUIRED",
  publishing_paused: "PUBLISHING_PAUSED",
  schedule_effect_already_started: "SCHEDULE_EFFECT_ALREADY_STARTED",
  schedule_in_past: "SCHEDULE_IN_PAST",
  snapshot_stale: "APPROVAL_SNAPSHOT_STALE",
  telegram_attestation_required: "TELEGRAM_ATTESTATION_REQUIRED",
  text_only_not_supported: "TEXT_ONLY_NOT_SUPPORTED",
  version_conflict: "VERSION_CONFLICT",
} as const satisfies Record<
  PublishingRepositoryErrorStatus,
  keyof typeof publishingErrors
>;

export const saveCard = installationProcedure
  .input(saveCardInputSchema)
  .output(saveCardResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        savePlatformDraft(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          platformDraftId: input.platformDraftId,
          idempotencyKey: input.idempotencyKey,
          requestHash: hashPayload(input),
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("savedCard" in result)) throw errors[errorName(result.status)]();
    return {
      status: createdOrReplayed(result.status),
      savedCardId: result.savedCard.id,
      version: result.savedCard.version,
    };
  });

function savedCardMutation(action: "discard" | "restore") {
  return installationProcedure
    .input(mutateSavedCardInputSchema)
    .output(mutateSavedCardResultSchema)
    .errors(publishingErrors)
    .handler(async ({ context, errors, input }) => {
      const result = await withPublishingDbRetry(
        () =>
          mutateSavedCard(rpcDb(), context.workspaceId, {
            actorId: context.session.user.id,
            savedCardId: input.savedCardId,
            expectedVersion: input.expectedVersion,
            action,
            idempotencyKey: input.idempotencyKey,
            requestHash: hashPayload({ action, ...input }),
          }),
        () => errors.TRANSIENT_CONFLICT(),
      );
      if (!("savedCard" in result)) throw errors[errorName(result.status)]();
      return {
        status: updatedOrReplayed(result.status),
        savedCardId: result.savedCard.id,
        version: result.savedCard.version,
      };
    });
}

export const discardCard = savedCardMutation("discard");
export const restoreCard = savedCardMutation("restore");

export const approve = installationProcedure
  .input(approveDraftInputSchema)
  .output(approveDraftResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        grantApproval(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          ...input,
          requestHash: hashPayload(input),
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("approval" in result)) throw errors[errorName(result.status)]();
    return {
      status: createdOrReplayed(result.status),
      approvalId: result.approval.id,
    };
  });

export const directPublish = installationProcedure
  .input(directPublishInputSchema)
  .output(publicationOperationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        admitDirectPublication(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          ...input,
          requestHash: hashPayload(input),
          requestId: context.requestId,
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("publication" in result)) throw errors[errorName(result.status)]();
    return {
      status: createdOrReplayed(result.status),
      publicationId: result.publication.id,
      operationId: result.operationId,
      version: result.publication.version,
    };
  });

export const schedulePublication = installationProcedure
  .input(createScheduleInputSchema)
  .output(scheduleOperationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        createSchedule(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          ...input,
          scheduledAt: new Date(input.scheduledAt),
          timezone: customerTimeZone,
          requestHash: hashPayload({ ...input, timezone: customerTimeZone }),
          requestId: context.requestId,
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("schedule" in result)) throw errors[errorName(result.status)]();
    if (!result.operationId) {
      throw new Error("schedule command operation missing");
    }
    return {
      status: createdOrReplayed(result.status),
      scheduleId: result.schedule.id,
      publicationId: result.schedule.publicationId,
      operationId: result.operationId,
      version: result.schedule.version,
    };
  });

export const cancelScheduledPublication = installationProcedure
  .input(scheduleMutationInputSchema)
  .output(scheduleMutationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        cancelSchedule(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          ...input,
          requestHash: hashPayload(input),
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("schedule" in result)) throw errors[errorName(result.status)]();
    return {
      status: updatedOrReplayed(result.status),
      scheduleId: result.schedule.id,
      publicationId: result.schedule.publicationId,
      version: result.schedule.version,
    };
  });

export const reschedulePublication = installationProcedure
  .input(rescheduleInputSchema)
  .output(scheduleOperationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        rescheduleSchedule(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          ...input,
          scheduledAt: new Date(input.scheduledAt),
          timezone: customerTimeZone,
          requestHash: hashPayload({ ...input, timezone: customerTimeZone }),
          requestId: context.requestId,
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("schedule" in result)) throw errors[errorName(result.status)]();
    if (!result.operationId) {
      throw new Error("reschedule command operation missing");
    }
    return {
      status: createdOrReplayed(result.status),
      scheduleId: result.schedule.id,
      publicationId: result.schedule.publicationId,
      operationId: result.operationId,
      version: result.schedule.version,
    };
  });

export const recoverMissedPublication = installationProcedure
  .input(recoverMissedScheduleInputSchema)
  .output(publicationOperationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const missed = await readMissedSchedule(
      rpcDb(),
      context.workspaceId,
      input.scheduleId,
      context.session.user.id,
    );
    if (!missed) throw errors.NOT_FOUND();
    if (missed.lifecycle !== "missed_requires_confirmation") {
      throw errors.SCHEDULE_MISSED_CONFIRMATION_REQUIRED();
    }
    const result = await withPublishingDbRetry(
      () =>
        admitDirectPublication(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          approvalId: missed.approvalId,
          destinationAccountId: input.destinationAccountId,
          scheduleId: missed.id,
          expectedScheduleVersion: input.expectedVersion,
          commandKind: "missed_recovery",
          idempotencyKey: input.idempotencyKey,
          requestHash: hashPayload(input),
          requestId: context.requestId,
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("publication" in result)) throw errors[errorName(result.status)]();
    return {
      status: createdOrReplayed(result.status),
      publicationId: result.publication.id,
      operationId: result.operationId,
      version: result.publication.version,
    };
  });

export const retryPublication = installationProcedure
  .input(retryPublicationInputSchema)
  .output(publicationOperationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const current = await readPublicationCommandContext(
      rpcDb(),
      context.workspaceId,
      input.publicationId,
    );
    if (!current) throw errors.NOT_FOUND();
    const result = await withPublishingDbRetry(
      () =>
        admitDirectPublication(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          approvalId: current.publication.approvalId,
          destinationAccountId: input.destinationAccountId,
          expectedPublicationVersion: input.expectedVersion,
          commandKind: "retry",
          idempotencyKey: input.idempotencyKey,
          requestHash: hashPayload(input),
          requestId: context.requestId,
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("publication" in result)) throw errors[errorName(result.status)]();
    return {
      status: createdOrReplayed(result.status),
      publicationId: result.publication.id,
      operationId: result.operationId,
      version: result.publication.version,
    };
  });

export const reconcilePublication = installationProcedure
  .input(reconcilePublicationInputSchema)
  .output(publicationOperationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const request = {
      ambiguousAttemptId: input.ambiguousAttemptId,
      expectedVersion: input.expectedVersion,
      idempotencyKey: input.idempotencyKey,
      publicationId: input.publicationId,
    };
    const result = await withPublishingDbRetry(
      () =>
        requestPublicationReconciliation(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          ...request,
          requestHash: hashPayload(request),
          requestId: context.requestId,
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (!("publication" in result)) {
      throw errors[errorName(result.status)]();
    }
    return {
      status: createdOrReplayed(result.status),
      operationId: result.operationId,
      publicationId: result.publication.id,
      version: result.publication.version,
    };
  });

export const attestTelegramPublication = installationProcedure
  .input(attestTelegramPublicationInputSchema)
  .output(publicationMutationResultSchema)
  .errors(publishingErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await withPublishingDbRetry(
      () =>
        recordPublicationReconciliation(rpcDb(), context.workspaceId, {
          actorId: context.session.user.id,
          authority: "operator",
          ...input,
          requestHash: hashPayload(input),
        }),
      () => errors.TRANSIENT_CONFLICT(),
    );
    if (result.status !== "recorded" && result.status !== "replayed") {
      throw errors[errorName(result.status)]();
    }
    return {
      status: result.status === "recorded" ? "updated" : result.status,
      publicationId: input.publicationId,
      version: result.publication.version,
    };
  });

function publishingPause(paused: boolean) {
  return installationProcedure
    .input(setPublishingPauseInputSchema)
    .output(publishingControlResultSchema)
    .errors(publishingErrors)
    .handler(async ({ context, errors, input }) => {
      const result = await withPublishingDbRetry(
        () =>
          setPublishingPaused(rpcDb(), context.workspaceId, {
            actorId: context.session.user.id,
            paused,
            ...input,
            requestHash: hashPayload({ paused, ...input }),
          }),
        () => errors.TRANSIENT_CONFLICT(),
      );
      if (result.status !== "updated" && result.status !== "replayed") {
        throw errors[errorName(result.status)]();
      }
      return {
        status: updatedOrReplayed(result.status),
        version: result.control.version,
      };
    });
}

export const pausePublishing = publishingPause(true);
export const resumePublishing = publishingPause(false);

function hashPayload(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function withPublishingDbRetry<T>(
  mutation: () => Promise<T>,
  transientConflict: () => unknown,
) {
  try {
    return await mutation();
  } catch (error) {
    if (classifyDbError(error)?.kind === "retry") {
      throw transientConflict();
    }
    throw error;
  }
}

function errorName(status: PublishingRepositoryErrorStatus) {
  return publishingRepositoryErrorNames[status];
}

function createdOrReplayed(status: "created" | "updated" | "replayed") {
  if (status === "created" || status === "replayed") return status;
  throw new Error("unexpected created command status");
}

function updatedOrReplayed(status: "created" | "updated" | "replayed") {
  if (status === "updated" || status === "replayed") return status;
  throw new Error("unexpected updated command status");
}
