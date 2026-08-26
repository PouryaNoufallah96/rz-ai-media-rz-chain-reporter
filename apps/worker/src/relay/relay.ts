import {
  OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME,
  OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME,
  OPERATION_COPY_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
  OPERATION_SOURCE_IMPORT_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { findAnalysisRunByOperationId } from "@rz-chain-reporter/db/repositories/analysis-run";
import { findCopyExecutionContext } from "@rz-chain-reporter/db/repositories/copy-generation";
import { findImageExecutionContext } from "@rz-chain-reporter/db/repositories/image-generation";
import {
  claimOutboxEvents,
  markOutboxDispatched,
  markOutboxFailed,
} from "@rz-chain-reporter/db/repositories/outbox-relay";

import type { WorkerInngestClient } from "../inngest/client";
import {
  createInngestEvent,
  OutboxEventContractError,
} from "../inngest/events";
import { workerLogger } from "../logging/logger";
import { abortableDelay } from "../runtime/delay";
import { notifyDraftsChangedNow } from "../web-cache/drafts";
import { notifyEditorialChangedNow } from "../web-cache/editorial";
import {
  notifySourcesCacheChanged,
  notifySourcesChangedNow,
} from "../web-cache/sources";

type ClaimedOutboxEvent = Awaited<ReturnType<typeof claimOutboxEvents>>[number];

const BATCH_SIZE = 5;
const LEASE_DURATION_MS = 120_000;
const MAX_ATTEMPTS = 8;
const MAX_BACKOFF_MS = 60_000;
const POLL_INTERVAL_MS = 500;

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
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly executor: Executor,
    private readonly workspaceId: string,
    private readonly client: WorkerInngestClient,
    claimedBy: string,
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
            changed: await this.dispatch(event),
            event,
          })),
        );
        const completed = dispatches.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        await Promise.allSettled(
          completed
            .filter(
              ({ changed, event }) => changed && this.isAnalysisRunEvent(event),
            )
            .map(({ event }) => this.notifyAnalysisRunDispatchChanged(event)),
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

  private async dispatch(event: ClaimedOutboxEvent) {
    try {
      await this.client.send(createInngestEvent(event));
      const result = await markOutboxDispatched(
        this.executor,
        this.workspaceId,
        {
          id: event.id,
          claimedBy: this.claimedBy,
        },
      );

      if (result.status === "not_owned") {
        workerLogger.warn("worker.relay.lease-lost", {
          eventType: event.eventType,
          outboxId: event.id,
        });
        return false;
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
      return true;
    } catch (error) {
      const failure = failureCode(error);
      const exhausted =
        failure.terminal || event.dispatchAttemptCount >= MAX_ATTEMPTS;
      const backoffMs = nextBackoffMs(
        event.dispatchAttemptCount,
        MAX_BACKOFF_MS,
      );
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
        return false;
      }

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
      await this.notifyCopyDispatchChanged(
        event,
        exhausted ? "dispatch_exhausted" : "queued",
      );
      await this.notifyImageDispatchChanged(
        event,
        exhausted ? "dispatch_exhausted" : "queued",
      );
      return true;
    }
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
        await notifyDraftsChangedNow(this.client, event.workspaceId, {
          analysisRunId: context.analysisRunId,
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
      await notifyDraftsChangedNow(this.client, event.workspaceId, {
        analysisRunId: copy.analysisRunId,
        code,
        operationId: event.operationId,
        platformDraftId: context.platformDraftId,
      });
    } catch {
      workerLogger.warn("worker.drafts.cache-notification-unavailable", {
        operationId: event.operationId,
        workspaceId: event.workspaceId,
      });
    }
  }

  private isAnalysisRunEvent(event: ClaimedOutboxEvent) {
    return (
      event.eventType === OPERATION_ANALYSIS_RUN_REQUESTED_EVENT_NAME ||
      event.eventType === OPERATION_ANALYSIS_RUN_CANCELLED_EVENT_NAME
    );
  }
}
