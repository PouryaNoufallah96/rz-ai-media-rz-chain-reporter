import { claimOperationExecution } from "@rz-chain-reporter/db/repositories/operation";
import {
  allocateOperationAttempt,
  settleReconciliationOperationSuccess,
} from "@rz-chain-reporter/db/repositories/operation-attempt";
import {
  loadPublicationReconciliationContext,
  recordPublicationCheckpoint,
  recordPublicationReconciliation,
} from "@rz-chain-reporter/db/repositories/publication";

import { publishOperationStatus, type WorkerStep } from "../inngest/channels";
import type { WorkerRuntime } from "../inngest/runtime";
import { workerEnv } from "../runtime/env";
import { createPublisher } from "./factory";
import {
  type PublisherRuntime,
  type PublishRequest,
  providerCheckpointSchema,
  publishMaterialSchema,
} from "./port";

const RECONCILIATION_LEASE_MS = 2 * 60_000;

export async function reconcilePublication(
  step: WorkerStep,
  runtime: WorkerRuntime,
  input: {
    ambiguousAttemptId: string;
    claimedBy: string;
    operationId: string;
    publicationId: string;
    workspaceId: string;
  },
) {
  const now = new Date();
  const claim = await step.run("claim-publication-reconciliation", () =>
    claimOperationExecution(runtime.db, input.workspaceId, {
      claimedBy: input.claimedBy,
      id: input.operationId,
      leaseExpiresAt: new Date(now.getTime() + RECONCILIATION_LEASE_MS),
      now,
    }),
  );
  if (claim.status !== "claimed") return { status: claim.status };
  const attempt = await step.run(
    "begin-publication-reconciliation-attempt",
    () =>
      allocateOperationAttempt(
        runtime.db,
        input.workspaceId,
        input.operationId,
      ),
  );
  if (!attempt) throw new Error("RECONCILIATION_ATTEMPT_FAILED");
  await publishOperationStatus(
    step,
    input.workspaceId,
    {
      attemptCount: attempt.attemptNumber,
      lifecycle: "running",
      operationId: input.operationId,
      operationVersion: claim.operation.version,
    },
    "worker.publishing.realtime-unavailable",
  );

  const context = await step.run(
    "load-publication-reconciliation",
    async () => {
      const loaded = await loadPublicationReconciliationContext(
        runtime.db,
        input.workspaceId,
        input.publicationId,
      );
      if (!loaded) return null;
      const ambiguousAttempt = loaded.execution.attempts.find(
        (entry) => entry.id === input.ambiguousAttemptId,
      );
      return {
        current: {
          lifecycle: loaded.current.lifecycle,
          unresolvedAttemptId: loaded.current.unresolvedAttemptId,
          version: loaded.current.version,
        },
        destination: {
          key: loaded.execution.destination.key,
          platform: loaded.execution.destination.platform,
        },
        operationId: loaded.execution.operation.id,
        publishPlatform: loaded.execution.publishOperation.platform,
        ambiguousAttempt: ambiguousAttempt
          ? { createdAt: ambiguousAttempt.createdAt, id: ambiguousAttempt.id }
          : null,
        checkpoints: loaded.execution.checkpoints.map((entry) => ({
          id: entry.id,
          kind: entry.kind,
          operationAttemptId: entry.operationAttemptId,
          providerReferenceId: entry.providerReferenceId,
        })),
      };
    },
  );
  if (
    context?.current.lifecycle !== "delivery_unknown" ||
    context.current.unresolvedAttemptId !== input.ambiguousAttemptId
  ) {
    throw new Error("PUBLICATION_RECONCILIATION_REQUIRED");
  }
  const ambiguousAttempt = context.ambiguousAttempt;
  const evidence = context.checkpoints.find(
    (entry: { operationAttemptId: string }) =>
      entry.operationAttemptId === input.ambiguousAttemptId,
  );
  if (!ambiguousAttempt || (!evidence && context.publishPlatform !== "x")) {
    throw new Error("RECONCILIATION_EVIDENCE_INSUFFICIENT");
  }
  const destination = runtime.template.destinationAccounts.find(
    (entry) =>
      entry.key === context.destination.key &&
      entry.platform === context.destination.platform,
  );
  if (!destination) throw new Error("TEMPLATE_DRIFT");

  const request: PublishRequest = {
    operationId: context.operationId,
    publicationId: input.publicationId,
    workspaceId: input.workspaceId,
  };
  const publisherRuntime: PublisherRuntime = {
    beginAttempt: async () => ({
      id: input.ambiguousAttemptId,
      number: 1,
      resumed: true,
    }),
    claimFinalEffect: async () => {
      throw new Error("RECONCILIATION_FINAL_EFFECT_FORBIDDEN");
    },
    existingCheckpoint: async (_request, kind) => {
      const checkpoint = context.checkpoints.find(
        (entry: { kind: string; operationAttemptId: string }) =>
          entry.operationAttemptId === input.ambiguousAttemptId &&
          entry.kind === kind,
      );
      return checkpoint
        ? providerCheckpointSchema.parse({
            kind: checkpoint.kind,
            providerReferenceId: checkpoint.providerReferenceId,
          })
        : null;
    },
    readMedia: async () => {
      throw new Error("RECONCILIATION_MEDIA_READ_FORBIDDEN");
    },
    renewLease: async () => undefined,
    run: (name, effect) => step.run(name, effect),
    sleep: async (duration) => {
      await step.sleep("publication-reconciliation-wait", duration);
    },
    withMaterial: async (name, effect) =>
      step.run(name, async () => {
        const loaded = await loadPublicationReconciliationContext(
          runtime.db,
          input.workspaceId,
          input.publicationId,
        );
        if (!loaded) throw new Error("PUBLICATION_RECONCILIATION_REQUIRED");
        const material = publishMaterialSchema.parse({
          contentLocale: loaded.execution.draft.contentLocale,
          destinationKey: loaded.execution.destination.key,
          draft: {
            body: loaded.execution.draft.body,
            hashtags: loaded.execution.draft.hashtags,
            headline: loaded.execution.draft.headline,
          },
          media: loaded.execution.media
            ? {
                actualBytes: loaded.execution.media.actualBytes,
                mimeType: loaded.execution.media.mimeType,
                objectKey: loaded.execution.media.objectKey,
              }
            : null,
          platform: loaded.execution.publishOperation.platform,
          source:
            loaded.execution.sourceItem && loaded.execution.sourceRevision
              ? {
                  attribution: loaded.execution.sourceItem.attribution,
                  canonicalUrl: loaded.execution.sourceRevision.canonicalUrl,
                }
              : null,
        });
        return effect(material);
      }) as Promise<Awaited<ReturnType<typeof effect>>>,
  };
  const publisher = createPublisher({
    acceptInstagramGrant: async () => {
      throw new Error("RECONCILIATION_GRANT_FORBIDDEN");
    },
    appUrl: workerEnv.APP_URL,
    destination,
    issueInstagramGrant: async () => {
      throw new Error("RECONCILIATION_GRANT_FORBIDDEN");
    },
    reconciliationReference: { notBefore: ambiguousAttempt.createdAt },
    request,
    runtime: publisherRuntime,
    runtimeEnv: process.env,
  });
  const result = await publisher.reconcile(
    evidence
      ? {
          kind: evidence.kind,
          providerReferenceId: evidence.providerReferenceId,
        }
      : null,
  );
  if (result.status === "failed") {
    throw new Error(result.failure.code);
  }
  if (result.status === "still_unknown") {
    const settled = await step.run(
      "settle-publication-reconciliation-still-unknown",
      async () => {
        const result = await settleReconciliationOperationSuccess(
          runtime.db,
          input.workspaceId,
          {
            attemptId: attempt.id,
            claimedBy: input.claimedBy,
            expectedVersion: claim.operation.version,
            operationId: input.operationId,
          },
        );
        if (!result) {
          throw new Error("RECONCILIATION_OPERATION_SETTLEMENT_LOST");
        }
        return {
          attemptCount: result.operation.attemptSeq,
          latestAttemptOutcome: result.attempt.outcome ?? undefined,
          lifecycle: result.operation.lifecycle,
          operationVersion: result.operation.version,
        };
      },
    );
    await publishOperationStatus(
      step,
      input.workspaceId,
      {
        ...settled,
        operationId: input.operationId,
      },
      "worker.publishing.realtime-unavailable",
    );
    return { operation: settled, status: "still_unknown" as const };
  }

  let evidenceCheckpointId = evidence?.id ?? null;
  if (
    result.status === "delivered" &&
    (!evidence ||
      result.checkpoint.kind !== evidence.kind ||
      result.checkpoint.providerReferenceId !== evidence.providerReferenceId)
  ) {
    evidenceCheckpointId = await step.run(
      "record-publication-reconciliation-checkpoint",
      async () => {
        const recorded = await recordPublicationCheckpoint(
          runtime.db,
          input.workspaceId,
          {
            attemptId: input.ambiguousAttemptId,
            kind: result.checkpoint.kind,
            operationId: context.operationId,
            platform: context.publishPlatform,
            providerReferenceId: result.checkpoint.providerReferenceId,
            publicationId: input.publicationId,
          },
        );
        if (recorded.status === "mismatch") {
          throw new Error("PUBLICATION_CHECKPOINT_MISMATCH");
        }
        return recorded.checkpoint.id;
      },
    );
  }
  const decision =
    result.status === "delivered" ? "delivered" : "not_delivered";
  if (!evidenceCheckpointId) {
    throw new Error("RECONCILIATION_EVIDENCE_INSUFFICIENT");
  }
  const recorded = await step.run("settle-publication-reconciliation", () =>
    recordPublicationReconciliation(runtime.db, input.workspaceId, {
      ambiguousAttemptId: input.ambiguousAttemptId,
      authority: "provider",
      decision,
      evidenceCheckpointId,
      expectedVersion: context.current.version,
      idempotencyKey: `provider-reconciliation:${input.operationId}`,
      publicationId: input.publicationId,
      requestHash: `${input.publicationId}:${input.ambiguousAttemptId}:${decision}:${evidenceCheckpointId}`,
    }),
  );
  if (recorded.status !== "recorded" && recorded.status !== "replayed") {
    throw new Error("PUBLICATION_RECONCILIATION_FAILED");
  }
  const operationSettled = await step.run(
    "settle-publication-reconciliation-operation",
    async () => {
      const settled = await settleReconciliationOperationSuccess(
        runtime.db,
        input.workspaceId,
        {
          attemptId: attempt.id,
          claimedBy: input.claimedBy,
          expectedVersion: claim.operation.version,
          operationId: input.operationId,
          providerResultId:
            result.status === "delivered" ? result.providerResultId : undefined,
        },
      );
      if (!settled) {
        throw new Error("RECONCILIATION_OPERATION_SETTLEMENT_LOST");
      }
      return {
        attemptCount: settled.operation.attemptSeq,
        latestAttemptOutcome: settled.attempt.outcome ?? undefined,
        lifecycle: settled.operation.lifecycle,
        operationVersion: settled.operation.version,
      };
    },
  );
  await publishOperationStatus(
    step,
    input.workspaceId,
    { ...operationSettled, operationId: input.operationId },
    "worker.publishing.realtime-unavailable",
  );
  return { operation: operationSettled, status: decision };
}
