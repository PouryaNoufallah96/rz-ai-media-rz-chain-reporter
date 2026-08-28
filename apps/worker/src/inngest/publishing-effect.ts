import type { ActivityEventType } from "@rz-chain-reporter/contracts";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import { recordPublicationSettlementActivity } from "@rz-chain-reporter/db/repositories/activity-event";
import {
  beginOrResumePublicationAttempt,
  claimPublicationFinalEffect,
  loadPublicationExecutionContext,
  markSettlementActivityFailed,
  reassertPublicationExecution,
  recordPublicationCheckpoint,
  renewPublicationExecutionLease,
  settlePublicationExecution,
} from "@rz-chain-reporter/db/repositories/publication";
import {
  acceptPublishingMediaGrantForContainer,
  issuePublishingMediaGrant,
} from "@rz-chain-reporter/db/repositories/publishing-media-grant";
import { resolveDestinationCredential } from "@rz-chain-reporter/env/destination-bindings";
import { invoke } from "inngest";
import { z } from "zod";

import { workerLogger } from "../logging/logger";
import { createPublisher } from "../publishing/factory";
import {
  type ProviderFailure,
  type PublisherRuntime,
  type PublishRequest,
  providerCheckpointSchema,
  providerFailureSchema,
  publishMaterialSchema,
} from "../publishing/port";
import { workerEnv } from "../runtime/env";
import type { WorkerInngestClient } from "./client";
import { readStorageBytes, workerStorage } from "./media-storage";
import type { WorkerRuntime } from "./runtime";

const PUBLISH_EFFECT_RETRIES = 0 as const;
const PUBLISH_EFFECT_LEASE_MS = 15 * 60_000;
export const PUBLISH_EFFECT_INVOKE_TIMEOUT = "13m";

export const publishingEffectInputSchema = z
  .strictObject({
    _inngest: z.unknown().optional(),
    claimedBy: z.string().trim().min(1).max(200),
    claimVersion: z.int().positive(),
    operationId: z.uuid(),
    publicationId: z.uuid(),
    workspaceId: z.uuid(),
  })
  .transform(({ _inngest: _metadata, ...input }) => input);

export const publishingEffectResultSchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("confirmed"),
    attemptId: z.uuid(),
    providerResultId: z.string().trim().min(1).max(512),
  }),
  z.strictObject({
    status: z.literal("definite_failure"),
    attemptId: z.uuid().nullable(),
    failure: providerFailureSchema,
  }),
  z.strictObject({
    status: z.literal("delivery_unknown"),
    attemptId: z.uuid(),
    failure: providerFailureSchema,
  }),
  z.strictObject({
    status: z.literal("waiting"),
    attemptId: z.uuid(),
    failure: providerFailureSchema,
  }),
]);

type EffectInput = z.infer<typeof publishingEffectInputSchema>;

export function createPublishingEffectFunction(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  return client.createFunction(
    {
      id: "publication-provider-effect",
      retries: PUBLISH_EFFECT_RETRIES,
      triggers: [invoke(publishingEffectInputSchema)],
    },
    async ({ event, step }) => {
      const input = publishingEffectInputSchema.parse(event.data);
      let claimVersion = input.claimVersion;
      let sleepPass = 0;
      let renewalPass = 0;

      const assertLastResponsibleMoment = async () => {
        if (workerEnv.PUBLISHING_EMERGENCY_PAUSED) {
          throw new Error("PUBLISHING_PAUSED");
        }
        const asserted = await reassertPublicationExecution(
          runtime.db,
          input.workspaceId,
          {
            operationId: input.operationId,
            claimedBy: input.claimedBy,
            now: new Date(),
          },
        );
        if (asserted.status !== "ready") {
          throw new Error("PUBLICATION_REASSERTION_FAILED");
        }
        const destination = templateDestination(
          runtime.template,
          asserted.context.destination.key,
          asserted.context.destination.platform,
        );
        resolveDestinationCredential(destination, process.env);
        return asserted.context;
      };

      const publisherRuntime: PublisherRuntime = {
        beginAttempt: async () => {
          const attempt = await step.run("begin-publication-attempt", () =>
            beginOrResumePublicationAttempt(runtime.db, input.workspaceId, {
              operationId: input.operationId,
              claimedBy: input.claimedBy,
              now: new Date(),
            }),
          );
          if (!attempt) throw new Error("PUBLICATION_ATTEMPT_CLAIM_FAILED");
          return attempt;
        },
        claimFinalEffect: async (attemptId) => {
          const claimed = await claimPublicationFinalEffect(
            runtime.db,
            input.workspaceId,
            {
              attemptId,
              claimedBy: input.claimedBy,
              operationId: input.operationId,
            },
          );
          if (claimed.status === "not_found") {
            throw new Error("PUBLICATION_FINAL_EFFECT_CLAIM_FAILED");
          }
          return claimed.status === "claimed";
        },
        existingCheckpoint: async (_request, kind) => {
          return step.run(`load-publication-checkpoint-${kind}`, async () => {
            const context = await loadPublicationExecutionContext(
              runtime.db,
              input.workspaceId,
              input.operationId,
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
          });
        },
        readMedia: (objectKey) => readStorageBytes(workerStorage(), objectKey),
        renewLease: async () => {
          renewalPass += 1;
          const now = new Date();
          const renewedVersion = await step.run(
            `renew-publication-lease-${renewalPass}`,
            async () => {
              const renewed = await renewPublicationExecutionLease(
                runtime.db,
                input.workspaceId,
                {
                  operationId: input.operationId,
                  claimedBy: input.claimedBy,
                  expectedVersion: claimVersion,
                  now,
                  leaseExpiresAt: new Date(
                    now.getTime() + PUBLISH_EFFECT_LEASE_MS,
                  ),
                },
              );
              return renewed?.version ?? null;
            },
          );
          if (!renewedVersion) throw new Error("PUBLICATION_LEASE_LOST");
          claimVersion = renewedVersion;
        },
        run: async (name, effect) => {
          return step.run(name, async () => {
            await assertLastResponsibleMoment();
            return effect();
          }) as Promise<Awaited<ReturnType<typeof effect>>>;
        },
        sleep: async (duration) => {
          sleepPass += 1;
          await step.sleep(`publication-poll-${sleepPass}`, duration);
        },
        withMaterial: async (name, effect) =>
          step.run(name, async () => {
            const materialContext = await assertLastResponsibleMoment();
            return effect(materialFromContext(materialContext));
          }) as Promise<Awaited<ReturnType<typeof effect>>>,
      };

      const effectContext = await step.run(
        "load-publication-effect-context",
        async () => {
          const context = await assertLastResponsibleMoment();
          return {
            destinationKey: context.destination.key,
            mediaAssetId: context.publishOperation.selectedFinalMediaAssetId,
            platform: context.destination.platform,
          };
        },
      );
      const request: PublishRequest = {
        operationId: input.operationId,
        publicationId: input.publicationId,
        workspaceId: input.workspaceId,
      };
      const destination = templateDestination(
        runtime.template,
        effectContext.destinationKey,
        effectContext.platform,
      );
      const mediaAssetId = effectContext.mediaAssetId;
      const publisher = createPublisher({
        acceptInstagramGrant: (grantId) =>
          acceptPublishingMediaGrantForContainer(
            runtime.db,
            input.workspaceId,
            grantId,
          ).then(() => undefined),
        appUrl: workerEnv.APP_URL,
        destination,
        issueInstagramGrant: async (grantRequest, rawToken, expiresAt) => {
          if (!mediaAssetId) throw new Error("MEDIA_NOT_PUBLISHABLE");
          const grant = await issuePublishingMediaGrant(
            runtime.db,
            grantRequest.workspaceId,
            {
              expiresAt,
              mediaAssetId,
              operationId: grantRequest.operationId,
              publicationId: grantRequest.publicationId,
              rawToken,
            },
          );
          return { id: grant.id };
        },
        request,
        runtime: publisherRuntime,
        runtimeEnv: process.env,
      });

      const prepared = await publisher.prepare(request);
      if (prepared.status === "failed") {
        return publishingEffectResultSchema.parse(
          await step.run("settle-publication-preparation-failure", () =>
            settleFailure(runtime, input, claimVersion, prepared),
          ),
        );
      }
      for (const checkpoint of prepared.prepared.checkpoints) {
        await step.run(`record-${checkpoint.kind}`, async () => {
          const recorded = await recordPublicationCheckpoint(
            runtime.db,
            input.workspaceId,
            {
              attemptId: prepared.prepared.attempt.id,
              kind: checkpoint.kind,
              operationId: input.operationId,
              platform: prepared.prepared.platform,
              providerReferenceId: checkpoint.providerReferenceId,
              publicationId: input.publicationId,
            },
          );
          if (recorded.status === "mismatch") {
            throw new Error("PUBLICATION_CHECKPOINT_MISMATCH");
          }
          return recorded.checkpoint.id;
        });
      }

      const result = await publisher.publish(prepared.prepared);
      if (result.status === "failed") {
        return publishingEffectResultSchema.parse(
          await step.run("settle-publication-effect-failure", () =>
            settleFailure(runtime, input, claimVersion, {
              attemptId: result.attemptId,
              failure: result.failure,
            }),
          ),
        );
      }

      const confirmed = await step.run("settle-publication-confirmed", () =>
        settlePublicationExecution(runtime.db, input.workspaceId, {
          attemptId: result.attemptId,
          checkpoint: finalCheckpoint(publisher.platform, result.checkpoint),
          claimedBy: input.claimedBy,
          expectedOperationVersion: claimVersion,
          operationId: input.operationId,
          outcome: "confirmed",
          providerResultId: result.providerResultId,
          publicationId: input.publicationId,
        }),
      );
      if (!confirmed) throw new Error("PUBLICATION_CONFIRMATION_LOST");
      await step.run("record-publication-confirmed-activity", () =>
        recordSettlementActivity(runtime, input, "publication.confirmed"),
      );
      return publishingEffectResultSchema.parse({
        status: "confirmed",
        attemptId: result.attemptId,
        providerResultId: result.providerResultId,
      });
    },
  );
}

function finalCheckpoint(
  platform: "telegram" | "x" | "instagram",
  checkpoint: z.infer<typeof providerCheckpointSchema>,
) {
  if (platform === "telegram" && checkpoint.kind === "telegram_message") {
    return {
      kind: "telegram_message" as const,
      platform,
      providerReferenceId: checkpoint.providerReferenceId,
    };
  }
  if (platform === "x" && checkpoint.kind === "x_post") {
    return {
      kind: "x_post" as const,
      platform,
      providerReferenceId: checkpoint.providerReferenceId,
    };
  }
  if (platform === "instagram" && checkpoint.kind === "instagram_media") {
    return {
      kind: "instagram_media" as const,
      platform,
      providerReferenceId: checkpoint.providerReferenceId,
    };
  }
  throw new Error("PUBLICATION_FINAL_CHECKPOINT_INVALID");
}

async function settleFailure(
  runtime: WorkerRuntime,
  input: EffectInput,
  claimVersion: number,
  result: { attemptId: string | null; failure: ProviderFailure },
) {
  const settlementBase = {
    claimedBy: input.claimedBy,
    expectedOperationVersion: claimVersion,
    failureCode: result.failure.code,
    operationId: input.operationId,
    publicationId: input.publicationId,
  };
  if (!result.attemptId) {
    const settled = await settlePublicationExecution(
      runtime.db,
      input.workspaceId,
      { ...settlementBase, attemptId: null, outcome: "definite_failure" },
    );
    if (!settled) throw new Error("PUBLICATION_SETTLEMENT_LOST");
    await recordSettlementActivity(runtime, input, "publication.failed");
    return {
      status: "definite_failure" as const,
      attemptId: null,
      failure: result.failure,
    };
  }

  if (result.failure.certainty === "delivery_unknown") {
    const settled = await settlePublicationExecution(
      runtime.db,
      input.workspaceId,
      {
        ...settlementBase,
        attemptId: result.attemptId,
        outcome: "delivery_unknown",
      },
    );
    if (!settled) throw new Error("PUBLICATION_SETTLEMENT_LOST");
    await recordSettlementActivity(
      runtime,
      input,
      "publication.delivery_unknown",
    );
    return {
      status: "delivery_unknown" as const,
      attemptId: result.attemptId,
      failure: result.failure,
    };
  }

  if (
    result.failure.next === "retry_preparation" ||
    result.failure.next === "retry_after_provider_time"
  ) {
    const resumeAt = result.failure.retryAt
      ? new Date(result.failure.retryAt)
      : new Date();
    const settled = await settlePublicationExecution(
      runtime.db,
      input.workspaceId,
      {
        ...settlementBase,
        attemptId: result.attemptId,
        outcome: "deferred",
        resumeAt,
      },
    );
    if (!settled) throw new Error("PUBLICATION_SETTLEMENT_LOST");
    return {
      status: "waiting" as const,
      attemptId: result.attemptId,
      failure: result.failure,
    };
  }

  const settled = await settlePublicationExecution(
    runtime.db,
    input.workspaceId,
    {
      ...settlementBase,
      attemptId: result.attemptId,
      outcome: "definite_failure",
    },
  );
  if (!settled) throw new Error("PUBLICATION_SETTLEMENT_LOST");
  await recordSettlementActivity(runtime, input, "publication.failed");
  return {
    status: "definite_failure" as const,
    attemptId: result.attemptId,
    failure: result.failure,
  };
}

function materialFromContext(
  context: NonNullable<
    Awaited<ReturnType<typeof loadPublicationExecutionContext>>
  >,
) {
  return publishMaterialSchema.parse({
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
    source:
      context.sourceItem && context.sourceRevision
        ? {
            attribution: context.sourceItem.attribution,
            canonicalUrl: context.sourceRevision.canonicalUrl,
          }
        : null,
  });
}

async function recordSettlementActivity(
  runtime: WorkerRuntime,
  input: EffectInput,
  eventType: Extract<
    ActivityEventType,
    | "publication.confirmed"
    | "publication.delivery_unknown"
    | "publication.failed"
  >,
) {
  try {
    const context = await loadPublicationExecutionContext(
      runtime.db,
      input.workspaceId,
      input.operationId,
    );
    if (!context) throw new Error("PUBLICATION_CONTEXT_MISSING");
    const occurredAt = new Date();
    await recordPublicationSettlementActivity(runtime.db, input.workspaceId, {
      actorId: context.operation.actor,
      eventType,
      idempotencyKey: `publication-settlement:${input.operationId}:${eventType}`,
      operationId: input.operationId,
      publicationId: input.publicationId,
      requestHash: `${input.publicationId}:${input.operationId}:${eventType}`,
      scheduleId: context.publishOperation.scheduleId,
      occurredAt,
    });
  } catch {
    await markSettlementActivityFailed(
      runtime.db,
      input.workspaceId,
      input.operationId,
      "INTERNAL_SERVER_ERROR",
    ).catch(() => undefined);
    workerLogger.warn("worker.publishing.activity-unavailable", {
      operationId: input.operationId,
      workspaceId: input.workspaceId,
    });
  }
}

function templateDestination(
  template: CustomerTemplate,
  key: string,
  platform: "telegram" | "x" | "instagram",
) {
  const destination = template.destinationAccounts.find(
    (entry) => entry.key === key && entry.platform === platform,
  );
  if (!destination) throw new Error("TEMPLATE_DRIFT");
  return destination;
}
