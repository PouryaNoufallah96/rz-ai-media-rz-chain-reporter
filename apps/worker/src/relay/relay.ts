import type { Executor } from "@rz-chain-reporter/db/executor";
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

type ClaimedOutboxEvent = Awaited<ReturnType<typeof claimOutboxEvents>>[number];

const BATCH_SIZE = 20;
const LEASE_DURATION_MS = 30_000;
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

        for (const event of events) {
          await this.dispatch(event);
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
        return;
      }

      workerLogger.info("worker.relay.dispatched", {
        attempt: event.dispatchAttemptCount,
        eventType: event.eventType,
        operationId: event.operationId,
        outboxId: event.id,
        workspaceId: event.workspaceId,
      });
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
        return;
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
    }
  }
}
