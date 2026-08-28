import { z } from "zod";

export const PUBLICATION_LIFECYCLES = [
  "available",
  "reserved",
  "effect_claimed",
  "delivery_unknown",
  "confirmed",
] as const;

export type PublicationLifecycle = (typeof PUBLICATION_LIFECYCLES)[number];

export const publicationLifecycleSchema = z.enum(PUBLICATION_LIFECYCLES);

export const PUBLISH_COMMAND_KINDS = [
  "direct",
  "scheduled",
  "missed_recovery",
  "retry",
  "reconciliation",
  "telegram_attestation",
] as const;

export type PublishCommandKind = (typeof PUBLISH_COMMAND_KINDS)[number];

export const SETTLEMENT_ACTIVITY_STATUSES = [
  "not_due",
  "pending",
  "failed",
  "recorded",
] as const;

export type SettlementActivityStatus =
  (typeof SETTLEMENT_ACTIVITY_STATUSES)[number];

export const settlementActivityStatusSchema = z.enum(
  SETTLEMENT_ACTIVITY_STATUSES,
);

export const PUBLISH_CHECKPOINT_KINDS = [
  "telegram_message",
  "x_media",
  "x_post",
  "instagram_grant",
  "instagram_container",
  "instagram_media",
] as const;

export type PublishCheckpointKind = (typeof PUBLISH_CHECKPOINT_KINDS)[number];

export const publishCheckpointKindSchema = z.enum(PUBLISH_CHECKPOINT_KINDS);

export const CHECKPOINT_EVIDENCE_AUTHORITIES = [
  "provider",
  "operator",
] as const;

export type CheckpointEvidenceAuthority =
  (typeof CHECKPOINT_EVIDENCE_AUTHORITIES)[number];

export const checkpointEvidenceAuthoritySchema = z.enum(
  CHECKPOINT_EVIDENCE_AUTHORITIES,
);

export const RECONCILIATION_DECISIONS = ["delivered", "not_delivered"] as const;
export type ReconciliationDecision = (typeof RECONCILIATION_DECISIONS)[number];
export const reconciliationDecisionSchema = z.enum(RECONCILIATION_DECISIONS);

export const RECONCILIATION_AUTHORITIES = ["provider", "operator"] as const;

export type ReconciliationAuthority =
  (typeof RECONCILIATION_AUTHORITIES)[number];

export const reconciliationAuthoritySchema = z.enum(RECONCILIATION_AUTHORITIES);

export const ACTIVITY_EVENT_TYPES = [
  "saved_card.saved",
  "saved_card.discarded",
  "saved_card.restored",
  "approval.granted",
  "schedule.created",
  "schedule.cancelled",
  "schedule.rescheduled",
  "schedule.missed",
  "publication.requested",
  "publication.confirmed",
  "publication.failed",
  "publication.delivery_unknown",
  "publication.reconciled_delivered",
  "publication.reconciled_not_delivered",
  "publication.telegram_attested_delivered",
  "publication.telegram_attested_not_delivered",
  "publishing.paused",
  "publishing.resumed",
] as const;

export type ActivityEventType = (typeof ACTIVITY_EVENT_TYPES)[number];

const idempotencyKeySchema = z
  .string()
  .trim()
  .min(1, { error: "IDEMPOTENCY_KEY_REQUIRED" })
  .max(200, { error: "IDEMPOTENCY_KEY_TOO_LONG" });

const commandIdentitySchema = z.strictObject({
  idempotencyKey: idempotencyKeySchema,
});

export const saveCardInputSchema = commandIdentitySchema.extend({
  platformDraftId: z.uuid(),
});

export const mutateSavedCardInputSchema = commandIdentitySchema.extend({
  savedCardId: z.uuid(),
  expectedVersion: z.int().positive(),
});

export const approveDraftInputSchema = commandIdentitySchema.extend({
  draftRevisionId: z.uuid(),
  expectedRevisionVersion: z.int().nonnegative(),
  selectedFinalMediaAssetId: z.uuid().nullable(),
});

export const directPublishInputSchema = commandIdentitySchema.extend({
  approvalId: z.uuid(),
  expectedRevisionVersion: z.int().nonnegative(),
  destinationAccountId: z.uuid(),
});

export const createScheduleInputSchema = commandIdentitySchema.extend({
  approvalId: z.uuid(),
  expectedRevisionVersion: z.int().nonnegative(),
  destinationAccountId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }),
});

export const scheduleMutationInputSchema = commandIdentitySchema.extend({
  scheduleId: z.uuid(),
  expectedVersion: z.int().positive(),
});

export const rescheduleInputSchema = scheduleMutationInputSchema.extend({
  scheduledAt: z.iso.datetime({ offset: true }),
});

export const recoverMissedScheduleInputSchema = commandIdentitySchema.extend({
  scheduleId: z.uuid(),
  expectedVersion: z.int().positive(),
  destinationAccountId: z.uuid(),
});

export const retryPublicationInputSchema = commandIdentitySchema.extend({
  publicationId: z.uuid(),
  expectedVersion: z.int().positive(),
  destinationAccountId: z.uuid(),
});

export const reconcilePublicationInputSchema = commandIdentitySchema.extend({
  publicationId: z.uuid(),
  expectedVersion: z.int().positive(),
  ambiguousAttemptId: z.uuid(),
});

export const attestTelegramPublicationInputSchema =
  commandIdentitySchema.extend({
    publicationId: z.uuid(),
    expectedVersion: z.int().positive(),
    ambiguousAttemptId: z.uuid(),
    decision: reconciliationDecisionSchema,
  });

export const setPublishingPauseInputSchema = commandIdentitySchema.extend({
  expectedVersion: z.int().nonnegative(),
  reasonCode: z.string().trim().min(1).max(100).nullable(),
});

const createdOrReplayedResultSchema = z.strictObject({
  status: z.enum(["created", "replayed"]),
});

const updatedOrReplayedResultSchema = z.strictObject({
  status: z.enum(["updated", "replayed"]),
});

export const saveCardResultSchema = createdOrReplayedResultSchema.extend({
  savedCardId: z.uuid(),
  version: z.int().positive(),
});

export const mutateSavedCardResultSchema = updatedOrReplayedResultSchema.extend(
  {
    savedCardId: z.uuid(),
    version: z.int().positive(),
  },
);

export const approveDraftResultSchema = createdOrReplayedResultSchema.extend({
  approvalId: z.uuid(),
});

export const publicationOperationResultSchema =
  createdOrReplayedResultSchema.extend({
    operationId: z.uuid(),
    publicationId: z.uuid(),
    version: z.int().positive(),
  });

export const scheduleOperationResultSchema =
  createdOrReplayedResultSchema.extend({
    operationId: z.uuid(),
    publicationId: z.uuid(),
    scheduleId: z.uuid(),
    version: z.int().positive(),
  });

export const scheduleMutationResultSchema =
  updatedOrReplayedResultSchema.extend({
    publicationId: z.uuid(),
    scheduleId: z.uuid(),
    version: z.int().positive(),
  });

export const publicationMutationResultSchema =
  updatedOrReplayedResultSchema.extend({
    publicationId: z.uuid(),
    version: z.int().positive(),
  });

export const publishingControlResultSchema =
  updatedOrReplayedResultSchema.extend({
    version: z.int().positive(),
  });
