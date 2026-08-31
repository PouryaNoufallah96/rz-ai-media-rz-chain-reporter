import {
  type ErrorCode,
  errorCodeSchema,
  type PublicationFailureCode,
  publicationFailureCodeSchema,
} from "@rz-chain-reporter/contracts";
import { inWorkspace } from "@rz-chain-reporter/db/filters";
import { settleReconciliationOperationFailure } from "@rz-chain-reporter/db/repositories/operation-attempt";
import {
  claimPublicationExecution,
  markPublicationCacheNotificationCompleted,
  readPublicationEffectiveAt,
  readPublicationExecutionSummary,
  readPublicationOperationActor,
  reassertPublicationExecution,
  settleTimedOutPublicationExecution,
} from "@rz-chain-reporter/db/repositories/publication";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { stableFailureCode, workerLogger } from "../logging/logger";
import { reconcilePublication } from "../publishing/reconcile";
import { notifyPublishingChanged } from "../web-cache/publishing";
import { publishOperationStatus } from "./channels";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import {
  createPublishingEffectFunction,
  PUBLISH_EFFECT_INVOKE_TIMEOUT,
  publishingEffectResultSchema,
} from "./publishing-effect";
import type { WorkerRuntime } from "./runtime";
import { assertWorkspace } from "./runtime";

const PUBLISH_PARENT_RETRIES = 2 as const;
const CLAIM_LEASE_MS = 15 * 60_000;

function reconciliationFailureOf(value: unknown): {
  failureCode: ErrorCode;
  providerFailureCode?: PublicationFailureCode;
} {
  const applicationFailure = errorCodeSchema.safeParse(value);
  if (applicationFailure.success) {
    return { failureCode: applicationFailure.data };
  }
  const providerFailure = publicationFailureCodeSchema.safeParse(value);
  return providerFailure.success
    ? {
        failureCode: "INTERNAL_SERVER_ERROR",
        providerFailureCode: providerFailure.data,
      }
    : { failureCode: "INTERNAL_SERVER_ERROR" };
}

export function createPublishingFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
) {
  const effect = createPublishingEffectFunction(client, runtime);
  const parent = client.createFunction(
    {
      id: "publication",
      retries: PUBLISH_PARENT_RETRIES,
      triggers: [durableEvents.operationPublicationRequested],
      onFailure: async ({ event, step }) => {
        const { operationId, publicationId, scheduleId, workspaceId } =
          event.data.event.data;
        const settlement = await step.run(
          "settle-failed-publication",
          async () => {
            const settled = await settleTimedOutPublicationExecution(
              runtime.db,
              workspaceId,
              {
                claimedBy: `publishing:${event.data.run_id}`,
                operationId,
                publicationId,
              },
            );
            if (!("attemptCount" in settled)) return settled;
            const [owner] = await runtime.db
              .select({ actor: operation.actor })
              .from(operation)
              .where(
                and(
                  inWorkspace(operation, workspaceId),
                  eq(operation.id, operationId),
                ),
              );
            return { ...settled, actor: owner?.actor ?? null };
          },
        );
        if (!("attemptCount" in settlement)) return;
        await notifyPublishingChanged(
          step,
          workspaceId,
          settlement.actor,
          {
            operationId,
            publicationId,
            scheduleId: scheduleId ?? null,
          },
          "failed",
        );
        if (settlement.actor) {
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: settlement.actor,
              attemptCount: settlement.attemptCount,
              lifecycle: settlement.operationLifecycle,
              operationId,
              operationVersion: settlement.operationVersion,
              sharedImport: false,
            },
            "worker.publishing.realtime-unavailable",
          );
        }
      },
    },
    async ({ event, runId, step }) => {
      const { operationId, publicationId, workspaceId } = event.data;
      await step.run("assert-publication-workspace", () =>
        assertWorkspace(runtime, workspaceId),
      );
      const timing = await step.run("load-publication-effective-at", () =>
        readPublicationEffectiveAt(runtime.db, workspaceId, operationId),
      );
      if (!timing) throw new NonRetriableError("NOT_FOUND");
      if (timing.scheduleId && timing.effectiveAt) {
        await step.sleepUntil(
          "wait-until-publication-effective-at",
          new Date(Date.parse(timing.effectiveAt) + 1_000),
        );
      }

      const claimedBy = `publishing:${runId}`;
      const claim = await step.run("claim-publication-after-wake", async () => {
        const now = new Date();
        const claimed = await claimPublicationExecution(
          runtime.db,
          workspaceId,
          {
            claimedBy,
            leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS),
            now,
            operationId,
            publicationId,
          },
        );
        if (claimed.status === "claimed") {
          return {
            actor: claimed.operation.actor,
            operationVersion: claimed.operation.version,
            status: claimed.status,
          };
        }
        if (claimed.status === "missed") {
          return {
            actor: claimed.operation.actor,
            attemptCount: claimed.operation.attemptSeq,
            lifecycle: claimed.operation.lifecycle,
            operationVersion: claimed.operation.version,
            status: claimed.status,
          };
        }
        return { status: claimed.status };
      });
      if (claim.status !== "claimed") {
        if (claim.status === "missed") {
          await notifyPublishingChanged(
            step,
            workspaceId,
            claim.actor,
            {
              operationId,
              publicationId,
              scheduleId: timing.scheduleId,
            },
            "missed",
          );
          await publishOperationStatus(
            step,
            workspaceId,
            {
              actorId: claim.actor,
              attemptCount: claim.attemptCount,
              lifecycle: claim.lifecycle,
              operationId,
              operationVersion: claim.operationVersion,
              sharedImport: false,
            },
            "worker.publishing.realtime-unavailable",
          );
        }
        return { operationId, status: claim.status };
      }

      await publishOperationStatus(
        step,
        workspaceId,
        {
          actorId: claim.actor,
          lifecycle: "running",
          operationId,
          operationVersion: claim.operationVersion,
          sharedImport: false,
        },
        "worker.publishing.realtime-unavailable",
      );
      const asserted = await step.run(
        "reassert-publication-after-claim",
        async () => {
          const result = await reassertPublicationExecution(
            runtime.db,
            workspaceId,
            {
              claimedBy,
              now: new Date(),
              operationId,
            },
          );
          return result.status;
        },
      );
      if (asserted !== "ready") {
        throw new NonRetriableError("PUBLICATION_REASSERTION_FAILED");
      }

      let result:
        | ReturnType<typeof publishingEffectResultSchema.parse>
        | Awaited<ReturnType<typeof settleTimedOutPublicationExecution>>
        | null = null;
      let invoked: unknown;
      try {
        invoked = await step.invoke("invoke-publication-provider-effect", {
          data: {
            claimedBy,
            claimVersion: claim.operationVersion,
            operationId,
            publicationId,
            workspaceId,
          },
          function: effect,
          timeout: PUBLISH_EFFECT_INVOKE_TIMEOUT,
        });
      } catch (error) {
        result = await step.run(
          "settle-publication-after-effect-invoke-failure",
          () => {
            workerLogger.warn("worker.publishing.effect-invoke-failed", {
              operationId,
              reason: stableFailureCode(
                error,
                error instanceof Error ? error.name : "unknown",
              ),
              workspaceId,
            });
            return settleTimedOutPublicationExecution(runtime.db, workspaceId, {
              claimedBy,
              operationId,
              publicationId,
            });
          },
        );
      }
      if (result === null) {
        result = publishingEffectResultSchema.parse(invoked);
      }
      const final = await step.run("reload-publication-after-effect", () =>
        readPublicationExecutionSummary(runtime.db, workspaceId, operationId),
      );
      const notification = await notifyPublishingChanged(
        step,
        workspaceId,
        claim.actor,
        {
          operationId,
          publicationId,
          scheduleId: timing.scheduleId,
        },
        "settled",
      );
      if (
        notification.cacheInvalidation === "disabled" ||
        (notification.cacheInvalidation === "accepted" &&
          notification.publishingRealtimePublished)
      ) {
        await step.run("complete-publishing-settlement-notification", () =>
          markPublicationCacheNotificationCompleted(
            runtime.db,
            workspaceId,
            operationId,
            new Date(),
          ),
        );
      }
      if (final) {
        await publishOperationStatus(
          step,
          workspaceId,
          {
            actorId: claim.actor,
            attemptCount: final.attemptCount,
            latestAttemptOutcome: final.latestAttemptOutcome ?? undefined,
            lifecycle: final.operationLifecycle,
            operationId,
            operationVersion: final.operationVersion,
            sharedImport: false,
          },
          "worker.publishing.realtime-unavailable",
        );
      }
      return { operationId, result };
    },
  );

  const reconciliation = client.createFunction(
    {
      id: "publication-reconciliation",
      retries: PUBLISH_PARENT_RETRIES,
      triggers: [durableEvents.operationPublicationReconciliationRequested],
      onFailure: async ({ event, step }) => {
        const { operationId, workspaceId } = event.data.event.data;
        const settlement = await step.run(
          "settle-failed-publication-reconciliation",
          async () => {
            const failure = reconciliationFailureOf(event.data.error.message);
            const settled = await settleReconciliationOperationFailure(
              runtime.db,
              workspaceId,
              {
                claimedBy: `publishing-reconciliation:${event.data.run_id}`,
                ...failure,
                operationId,
              },
            );
            return settled
              ? {
                  actor: settled.operation.actor,
                  attemptCount: settled.attemptCount,
                  latestAttemptOutcome: settled.latestAttemptOutcome,
                  operationLifecycle: settled.operation.lifecycle,
                  operationVersion: settled.operation.version,
                }
              : null;
          },
        );
        if (!settlement) return;
        await publishOperationStatus(
          step,
          workspaceId,
          {
            actorId: settlement.actor,
            attemptCount: settlement.attemptCount,
            latestAttemptOutcome: settlement.latestAttemptOutcome,
            lifecycle: settlement.operationLifecycle,
            operationId,
            operationVersion: settlement.operationVersion,
            sharedImport: false,
          },
          "worker.publishing.realtime-unavailable",
        );
      },
    },
    async ({ event, runId, step }) => {
      const result = await reconcilePublication(step, runtime, {
        ambiguousAttemptId: event.data.ambiguousAttemptId,
        claimedBy: `publishing-reconciliation:${runId}`,
        operationId: event.data.operationId,
        publicationId: event.data.publicationId,
        workspaceId: event.data.workspaceId,
      });
      const actor = await step.run("load-reconciliation-actor", () =>
        readPublicationOperationActor(
          runtime.db,
          event.data.workspaceId,
          event.data.operationId,
        ),
      );
      await notifyPublishingChanged(
        step,
        event.data.workspaceId,
        actor,
        {
          operationId: event.data.operationId,
          publicationId: event.data.publicationId,
          scheduleId: null,
        },
        "reconciled",
      );
      if (actor && "operation" in result) {
        await publishOperationStatus(
          step,
          event.data.workspaceId,
          {
            actorId: actor,
            ...result.operation,
            operationId: event.data.operationId,
            sharedImport: false,
          },
          "worker.publishing.realtime-unavailable",
        );
      }
      return result;
    },
  );

  return { effect, parent, reconciliation };
}
