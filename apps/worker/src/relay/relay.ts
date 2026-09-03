import {
  marketGenerationRequestedPayloadSchema,
  marketVerificationRequestedPayloadSchema,
  OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
  OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
  OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
  OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME,
  OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME,
  OPERATION_PUBLICATION_REQUESTED_EVENT_NAME,
  OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { recordPublicationSettlementActivity } from "@rz-chain-reporter/db/repositories/activity-event";
import { findAnalysisRunByOperationId } from "@rz-chain-reporter/db/repositories/analysis-run";
import { findCopyExecutionContext } from "@rz-chain-reporter/db/repositories/copy-generation";
import { loadCopyVariantTranslationRequest } from "@rz-chain-reporter/db/repositories/copy-variant-localization";
import { loadEditorialPresentationTranslationRequest } from "@rz-chain-reporter/db/repositories/editorial-presentation-localization-request";
import { findImageExecutionContext } from "@rz-chain-reporter/db/repositories/image-generation";
import { ensureMarketComparisonCatalogRefresh } from "@rz-chain-reporter/db/repositories/market-comparison-catalog";
import {
  claimOutboxEvents,
  markOutboxDispatched,
  markOutboxFailed,
} from "@rz-chain-reporter/db/repositories/outbox-relay";
import {
  deferPublicationCacheNotification,
  enqueueStrandedPublicationRecoveries,
  markPublicationCacheNotificationCompleted,
  markSettlementActivityFailed,
  readPendingPublicationFollowUps,
  readPublicationOperationActor,
  rearmSettlementActivity,
} from "@rz-chain-reporter/db/repositories/publication";
import { publishOperationsChangedNow } from "../inngest/channels";
import type { WorkerInngestClient } from "../inngest/client";
import {
  createInngestEvent,
  OutboxEventContractError,
} from "../inngest/events";
import { workerLogger } from "../logging/logger";
import { abortableDelay } from "../runtime/delay";
import { notifyDraftsChangedNow } from "../web-cache/drafts";
import {
  notifyEditorialChangedNow,
  notifyEditorialTranslationDispatchChangedNow,
} from "../web-cache/editorial";
import {
  notifyMarketAnalysisChangedNow,
  notifyMarketDraftsChangedNow,
} from "../web-cache/market-analysis";
import { notifyCacheInvalidation } from "../web-cache/notify";
import { notifyPublishingChangedNow } from "../web-cache/publishing";
import {
  notifySourcesCacheChanged,
  notifySourcesChangedNow,
} from "../web-cache/sources";

type ClaimedOutboxEvent = Awaited<ReturnType<typeof claimOutboxEvents>>[number];
type DispatchChangeCode = "dispatch_exhausted" | "queued";
type PublicationFollowUp = Awaited<
  ReturnType<typeof readPendingPublicationFollowUps>
>[number];

const BATCH_SIZE = 5;
const LEASE_DURATION_MS = 120_000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60_000;
const POLL_INTERVAL_MS = 500;
const PUBLICATION_FOLLOW_UP_RETRY_MS = 30_000;
const RECOVERY_SCAN_INTERVAL_MS = 10_000;
const MARKET_CATALOG_WAITING_CHECK_MS = 10_000;
const MARKET_CATALOG_ACTIVE_CHECK_MS = 30_000;

function nextBackoffMs(attempt: number, maximum: number) {
  return Math.min(1_000 * 2 ** Math.max(0, attempt - 1), maximum);
}

function failureCode(error: unknown) {
  if (error instanceof OutboxEventContractError) {
    return { code: error.code, terminal: true };
  }
  return { code: "INNGEST_SEND_FAILED", terminal: false } as const;
}

export class OutboxRelay {
  readonly claimedBy: string;
  private readonly abortController = new AbortController();
  private accepting = false;
  private lastRecoveryScanAt = 0;
  private loopPromise: Promise<void> | null = null;
  private nextMarketCatalogCheckAt = 0;

  constructor(
    private readonly executor: Executor,
    private readonly workspaceId: string,
    private readonly client: WorkerInngestClient,
    claimedBy: string,
    private readonly marketCatalogRefreshEnabled = false,
  ) {
    this.claimedBy = claimedBy;
  }

  get isAccepting() {
    return this.accepting;
  }

  start() {
    if (this.loopPromise) {
      return;
    }
    this.accepting = true;
    this.loopPromise = this.run();
  }

  async stopIntakeAndDrain() {
    this.accepting = false;
    this.abortController.abort();
    await this.loopPromise;
  }

  private async run() {
    while (this.accepting) {
      try {
        if (Date.now() - this.lastRecoveryScanAt >= RECOVERY_SCAN_INTERVAL_MS) {
          const recoveries = await enqueueStrandedPublicationRecoveries(
            this.executor,
            this.workspaceId,
            new Date(),
            BATCH_SIZE,
          );
          if (recoveries.length > 0) {
            workerLogger.info("worker.publishing.recovery-enqueued", {
              attempt: recoveries.length,
              workspaceId: this.workspaceId,
            });
          }
          await this.repairPublicationFollowUps();
          await this.ensureMarketCatalogRefresh();
          this.lastRecoveryScanAt = Date.now();
        }
        const events = await claimOutboxEvents(
          this.executor,
          this.workspaceId,
          {
            claimedBy: this.claimedBy,
            leaseDurationMs: LEASE_DURATION_MS,
            limit: BATCH_SIZE,
          },
        );

        if (
          events.some(
            (event) =>
              event.eventType === OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
          )
        ) {
          try {
            await notifySourcesCacheChanged(this.workspaceId);
          } catch {
            workerLogger.warn("worker.sources.cache-notification-unavailable", {
              workspaceId: this.workspaceId,
            });
          }
        }

        const dispatches = await Promise.allSettled(
          events.map(async (event) => ({
            code: await this.dispatch(event),
            event,
          })),
        );
        const completed = dispatches.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        await Promise.allSettled(
          completed.flatMap(({ code, event }) => {
            if (!code) return [];
            if (this.isAnalysisRunEvent(event)) {
              return [this.notifyAnalysisRunDispatchChanged(event)];
            }
            if (
              event.eventType ===
              OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME
            ) {
              return [
                this.notifyPresentationTranslationDispatchChanged(event, code),
              ];
            }
            if (
              event.eventType ===
              OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME
            ) {
              return [
                this.notifyCopyVariantTranslationDispatchChanged(event, code),
              ];
            }
            return [];
          }),
        );
        const operationAudiences = new Map<
          string,
          { actorId: string; sharedImport: boolean }
        >();
        for (const { code, event } of completed) {
          if (code === null) continue;
          operationAudiences.set(
            event.sharedImport ? "shared-import" : event.actorId,
            {
              actorId: event.actorId,
              sharedImport: event.sharedImport,
            },
          );
        }
        await Promise.all(
          [...operationAudiences.values()].map((audience) =>
            publishOperationsChangedNow(this.client, this.workspaceId, {
              ...audience,
              occurredAt: new Date().toISOString(),
              schemaVersion: 1,
            }),
          ),
        );

        if (completed.length !== dispatches.length) {
          workerLogger.error("worker.relay.batch-failed", {
            errorCode: "OUTBOX_RELAY_BATCH_FAILED",
          });
          await abortableDelay(POLL_INTERVAL_MS, this.abortController.signal);
        }

        if (events.length === 0) {
          await abortableDelay(POLL_INTERVAL_MS, this.abortController.signal);
        }
      } catch {
        workerLogger.error("worker.relay.batch-failed", {
          errorCode: "OUTBOX_RELAY_BATCH_FAILED",
        });
        await abortableDelay(POLL_INTERVAL_MS, this.abortController.signal);
      }
    }
  }

  private async ensureMarketCatalogRefresh() {
    const now = new Date();
    if (
      !this.marketCatalogRefreshEnabled ||
      now.getTime() < this.nextMarketCatalogCheckAt
    ) {
      return;
    }
    const result = await ensureMarketComparisonCatalogRefresh(
      this.executor,
      this.workspaceId,
      now,
    );
    if (result.status === "created") {
      workerLogger.info("worker.market-catalog.refresh-enqueued", {
        operationId: result.operationId,
        workspaceId: this.workspaceId,
      });
    }
    if (
      result.status === "fresh" ||
      result.status === "retry_bucket_complete"
    ) {
      this.nextMarketCatalogCheckAt = result.nextEligibleAt.getTime();
      return;
    }
    this.nextMarketCatalogCheckAt =
      now.getTime() +
      (result.status === "waiting_for_operator"
        ? MARKET_CATALOG_WAITING_CHECK_MS
        : MARKET_CATALOG_ACTIVE_CHECK_MS);
  }

  private async repairPublicationFollowUps() {
    const now = new Date();
    const followUps = await readPendingPublicationFollowUps(
      this.executor,
      this.workspaceId,
      new Date(now.getTime() - PUBLICATION_FOLLOW_UP_RETRY_MS),
      BATCH_SIZE,
    );
    const repairs = await Promise.allSettled(
      followUps.map((followUp) =>
        this.repairPublicationFollowUp(followUp, now),
      ),
    );
    if (repairs.some((repair) => repair.status === "rejected")) {
      workerLogger.warn("worker.publishing.follow-up-unavailable", {
        attempt: followUps.length,
        workspaceId: this.workspaceId,
      });
    }
  }

  private async repairPublicationFollowUp(
    followUp: PublicationFollowUp,
    attemptedAt: Date,
  ) {
    const repairs: Promise<void>[] = [];
    if (
      followUp.settlementActivityStatus === "pending" ||
      followUp.settlementActivityStatus === "failed"
    ) {
      repairs.push(this.repairSettlementActivity(followUp, attemptedAt));
    }
    if (followUp.cacheNotificationDue) {
      repairs.push(this.repairPublishingNotification(followUp, attemptedAt));
    }
    const results = await Promise.allSettled(repairs);
    if (results.some((result) => result.status === "rejected")) {
      throw new Error("PUBLICATION_FOLLOW_UP_UNAVAILABLE");
    }
  }

  private async repairSettlementActivity(
    followUp: PublicationFollowUp,
    occurredAt: Date,
  ) {
    try {
      if (followUp.settlementActivityStatus === "failed") {
        await rearmSettlementActivity(
          this.executor,
          this.workspaceId,
          followUp.operationId,
        );
      }
      await recordPublicationSettlementActivity(
        this.executor,
        this.workspaceId,
        {
          actorId: followUp.actorId,
          eventType: followUp.activityEventType,
          idempotencyKey: `publication-settlement:${followUp.operationId}:${followUp.activityEventType}`,
          operationId: followUp.operationId,
          publicationId: followUp.publicationId,
          requestHash: `${followUp.publicationId}:${followUp.operationId}:${followUp.activityEventType}`,
          scheduleId: followUp.scheduleId,
          occurredAt,
        },
      );
    } catch {
      await markSettlementActivityFailed(
        this.executor,
        this.workspaceId,
        followUp.operationId,
        "INTERNAL_SERVER_ERROR",
      ).catch(() => undefined);
      throw new Error("PUBLICATION_ACTIVITY_UNAVAILABLE");
    }
  }

  private async repairPublishingNotification(
    followUp: PublicationFollowUp,
    attemptedAt: Date,
  ) {
    const notification = await notifyPublishingChangedNow(
      this.client,
      this.workspaceId,
      followUp.actorId,
      {
        operationId: followUp.operationId,
        publicationId: followUp.publicationId,
        scheduleId: followUp.scheduleId,
      },
    );
    const completed =
      notification.cacheInvalidation === "disabled" ||
      (notification.cacheInvalidation === "accepted" &&
        notification.publishingRealtimePublished);
    if (completed) {
      await markPublicationCacheNotificationCompleted(
        this.executor,
        this.workspaceId,
        followUp.operationId,
        attemptedAt,
      );
      return;
    }
    await deferPublicationCacheNotification(
      this.executor,
      this.workspaceId,
      followUp.operationId,
      attemptedAt,
    );
  }

  private async dispatch(event: ClaimedOutboxEvent) {
    try {
      await this.client.send(createInngestEvent(event));
    } catch (error) {
      return this.recordDispatchFailure(event, error);
    }

    const result = await markOutboxDispatched(this.executor, this.workspaceId, {
      id: event.id,
      claimedBy: this.claimedBy,
    });
    if (result.status === "not_owned") {
      workerLogger.warn("worker.relay.lease-lost", {
        eventType: event.eventType,
        outboxId: event.id,
      });
      return null;
    }

    workerLogger.info("worker.relay.dispatched", {
      attempt: event.dispatchAttemptCount,
      eventType: event.eventType,
      operationId: event.operationId,
      outboxId: event.id,
      workspaceId: event.workspaceId,
    });
    await this.notifySourceImportDispatchChanged(event);
    await this.notifyCopyDispatchChanged(event, "queued");
    await this.notifyImageDispatchChanged(event, "queued");
    await this.notifyPublishingDispatchChanged(event);
    await this.notifyMarketDispatchChanged(event);
    return "queued" as const;
  }

  private async recordDispatchFailure(
    event: ClaimedOutboxEvent,
    error: unknown,
  ): Promise<DispatchChangeCode | null> {
    const failure = failureCode(error);
    const exhausted =
      failure.terminal || event.dispatchAttemptCount >= MAX_ATTEMPTS;
    const backoffMs = nextBackoffMs(event.dispatchAttemptCount, MAX_BACKOFF_MS);
    const result = await markOutboxFailed(this.executor, this.workspaceId, {
      id: event.id,
      claimedBy: this.claimedBy,
      errorCode: failure.code,
      exhausted,
      nextAttemptAt: new Date(Date.now() + backoffMs),
    });

    if (result.status === "not_owned") {
      workerLogger.warn("worker.relay.lease-lost", {
        eventType: event.eventType,
        outboxId: event.id,
      });
      return null;
    }

    const code = exhausted ? "dispatch_exhausted" : "queued";
    workerLogger.warn(
      exhausted ? "worker.relay.exhausted" : "worker.relay.delayed",
      {
        attempt: event.dispatchAttemptCount,
        delayMs: backoffMs,
        errorCode: failure.code,
        eventType: event.eventType,
        operationId: event.operationId,
        outboxId: event.id,
        workspaceId: event.workspaceId,
      },
    );
    await this.notifySourceImportDispatchChanged(event);
    await this.notifyCopyDispatchChanged(event, code);
    await this.notifyImageDispatchChanged(event, code);
    await this.notifyPublishingDispatchChanged(event);
    await this.notifyMarketDispatchChanged(event);
    return code;
  }

  private async notifySourceImportDispatchChanged(event: ClaimedOutboxEvent) {
    if (event.eventType !== OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME) {
      return;
    }

    try {
      await notifySourcesChangedNow(this.client, event.workspaceId);
    } catch {
      workerLogger.warn("worker.sources.cache-notification-unavailable", {
        workspaceId: event.workspaceId,
      });
    }
  }

  private async notifyMarketDispatchChanged(event: ClaimedOutboxEvent) {
    if (
      event.eventType !== OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME &&
      event.eventType !==
        OPERATION_MARKET_CATALOG_REFRESH_REQUESTED_EVENT_NAME &&
      event.eventType !== OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME
    )
      return;
    try {
      if (
        event.eventType ===
          OPERATION_MARKET_VERIFICATION_REQUESTED_EVENT_NAME ||
        event.eventType === OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME
      ) {
        const payload =
          event.eventType === OPERATION_MARKET_GENERATION_REQUESTED_EVENT_NAME
            ? marketGenerationRequestedPayloadSchema.parse(event.payload)
            : marketVerificationRequestedPayloadSchema.parse(event.payload);
        await notifyMarketAnalysisChangedNow(
          this.client,
          event.workspaceId,
          payload.marketAnalysisId,
        );
        return;
      }
      await notifyCacheInvalidation([
        workspaceCacheTag(event.workspaceId, "market-analysis"),
      ]);
    } catch {
      workerLogger.warn(
        "worker.market-analysis.cache-notification-unavailable",
        {
          operationId: event.operationId,
          workspaceId: event.workspaceId,
        },
      );
    }
  }

  private async notifyAnalysisRunDispatchChanged(event: ClaimedOutboxEvent) {
    try {
      const run = await findAnalysisRunByOperationId(
        this.executor,
        event.workspaceId,
        event.operationId,
      );
      if (run) {
        await notifyEditorialChangedNow(this.client, event.workspaceId, run.id);
      }
    } catch {
      workerLogger.warn("worker.editorial.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private async notifyPresentationTranslationDispatchChanged(
    event: ClaimedOutboxEvent,
    code: DispatchChangeCode,
  ) {
    if (
      event.eventType !==
      OPERATION_PRESENTATION_TRANSLATION_REQUESTED_EVENT_NAME
    ) {
      return;
    }

    try {
      const request = await loadEditorialPresentationTranslationRequest(
        this.executor,
        event.workspaceId,
        event.operationId,
      );
      if (request.status !== "ready") return;

      await notifyEditorialTranslationDispatchChangedNow(
        this.client,
        event.workspaceId,
        {
          analysisRunId: request.analysisRunId,
          code,
          operationId: event.operationId,
          platformDraftIds: request.platformDraftIds,
        },
      );
    } catch {
      workerLogger.warn("worker.editorial.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private async notifyCopyDispatchChanged(
    event: ClaimedOutboxEvent,
    code: "dispatch_exhausted" | "queued",
  ) {
    if (event.eventType !== OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME) {
      return;
    }
    try {
      const context = await findCopyExecutionContext(
        this.executor,
        event.workspaceId,
        event.operationId,
      );
      if (context) {
        if (context.executionScope.kind === "market_analysis") {
          await notifyMarketDraftsChangedNow(
            this.client,
            event.workspaceId,
            context.executionScope.marketAnalysisId,
          );
        } else {
          await notifyDraftsChangedNow(this.client, event.workspaceId, {
            analysisRunId: context.executionScope.analysisRunId,
            code,
            operationId: event.operationId,
            platformDraftId: context.platformDraftId,
          });
        }
      }
    } catch {
      workerLogger.warn("worker.drafts.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private async notifyCopyVariantTranslationDispatchChanged(
    event: ClaimedOutboxEvent,
    code: DispatchChangeCode,
  ) {
    try {
      const request = await loadCopyVariantTranslationRequest(
        this.executor,
        event.workspaceId,
        event.operationId,
      );
      if (request.status !== "ready") return;

      await notifyDraftsChangedNow(this.client, event.workspaceId, {
        analysisRunId: request.analysisRunId,
        code,
        operationId: event.operationId,
        platformDraftId: request.source.platformDraftId,
      });
    } catch {
      workerLogger.warn("worker.drafts.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private async notifyImageDispatchChanged(
    event: ClaimedOutboxEvent,
    code: "dispatch_exhausted" | "queued",
  ) {
    if (event.eventType !== OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME) {
      return;
    }
    try {
      const context = await findImageExecutionContext(
        this.executor,
        event.workspaceId,
        event.operationId,
      );
      if (!context) return;
      const copy = await findCopyExecutionContext(
        this.executor,
        event.workspaceId,
        context.copyOperationId,
      );
      if (!copy) return;
      if (copy.executionScope.kind === "market_analysis") {
        await notifyMarketDraftsChangedNow(
          this.client,
          event.workspaceId,
          copy.executionScope.marketAnalysisId,
        );
      } else {
        await notifyDraftsChangedNow(this.client, event.workspaceId, {
          analysisRunId: copy.executionScope.analysisRunId,
          code,
          operationId: event.operationId,
          platformDraftId: context.platformDraftId,
        });
      }
    } catch {
      workerLogger.warn("worker.drafts.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private async notifyPublishingDispatchChanged(event: ClaimedOutboxEvent) {
    if (!this.isPublishingEvent(event)) return;
    const payload = event.payload as {
      publicationId?: unknown;
      scheduleId?: unknown;
    };
    if (typeof payload.publicationId !== "string") return;
    try {
      const actorId = await readPublicationOperationActor(
        this.executor,
        event.workspaceId,
        event.operationId,
      );
      const notification = await notifyPublishingChangedNow(
        this.client,
        event.workspaceId,
        actorId,
        {
          operationId: event.operationId,
          publicationId: payload.publicationId,
          scheduleId:
            typeof payload.scheduleId === "string" ? payload.scheduleId : null,
        },
      );
      if (
        notification.cacheInvalidation === "failed" ||
        notification.cacheInvalidation === "rejected"
      ) {
        workerLogger.warn("worker.publishing.cache-notification-unavailable", {
          operationId: event.operationId,
          workspaceId: event.workspaceId,
        });
      }
    } catch {
      workerLogger.warn("worker.publishing.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private isPublishingEvent(event: ClaimedOutboxEvent) {
    return (
      event.eventType === OPERATION_PUBLICATION_REQUESTED_EVENT_NAME ||
      event.eventType ===
        OPERATION_PUBLICATION_RECONCILIATION_REQUESTED_EVENT_NAME
    );
  }

  private isAnalysisRunEvent(event: ClaimedOutboxEvent) {
    return (
      event.eventType === OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME ||
      event.eventType === OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME
    );
  }
}
