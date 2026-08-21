import "server-only";

import {
  type AttemptOutcome,
  type OperationLifecycle,
  operationCommandKind,
  type UsageStatus,
} from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";

import { RECENT_TERMINAL_WINDOW_MS } from "../constants";
import type { OperationSummary } from "../schemas/operation-summary";

const TERMINAL_LIFECYCLES: OperationLifecycle[] = [
  "succeeded",
  "failed",
  "cancelled",
];

// `unknown` is settled for the timeline but stays in the list until it is
// resolved, so it is deliberately absent from TERMINAL_LIFECYCLES.
const SETTLED_LIFECYCLES: OperationLifecycle[] = [
  ...TERMINAL_LIFECYCLES,
  "unknown",
];

const USAGE_OUTCOME: Record<UsageStatus, AttemptOutcome | null> = {
  pending: null,
  succeeded: "succeeded",
  failed: "failed_terminal",
  cancelled: "failed_terminal",
  unknown: "ambiguous",
};

export async function listRecentOperations(
  executor: Executor,
  workspaceId: string,
): Promise<OperationSummary[]> {
  const settledSince = new Date(Date.now() - RECENT_TERMINAL_WINDOW_MS);

  const rows = await executor.query.operation.findMany({
    columns: {
      commandType: true,
      createdAt: true,
      effectiveAt: true,
      id: true,
      lifecycle: true,
      updatedAt: true,
      version: true,
    },
    with: {
      attempts: {
        columns: {
          createdAt: true,
          failureCode: true,
          id: true,
          outcome: true,
          updatedAt: true,
        },
        with: {
          usageEvents: {
            columns: {
              id: true,
              invocationKey: true,
              occurredAt: true,
              status: true,
            },
            orderBy: (usage, { asc }) => asc(usage.occurredAt),
            where: (usage) => inWorkspace(usage, workspaceId),
          },
        },
        orderBy: (attempt, { desc }) => desc(attempt.attemptNumber),
        where: (attempt) => inWorkspace(attempt, workspaceId),
      },
      outboxEvents: {
        columns: {
          dispatchAttemptCount: true,
          dispatchedAt: true,
          exhaustedAt: true,
          id: true,
          nextAttemptAt: true,
        },
        limit: 1,
        orderBy: (event, { asc }) => asc(event.createdAt),
        where: (event) => inWorkspace(event, workspaceId),
      },
      publish: { columns: { platform: true } },
    },
    where: (operation, { and, gte, notInArray, or }) =>
      and(
        inWorkspace(operation, workspaceId),
        or(
          notInArray(operation.lifecycle, TERMINAL_LIFECYCLES),
          gte(operation.updatedAt, settledSince),
        ),
      ),
    orderBy: (operation, { desc }) => [
      desc(operation.createdAt),
      desc(operation.id),
    ],
  });

  const summaries = rows.map(
    ({ attempts, outboxEvents, publish, ...operation }) => {
      const outbox = outboxEvents[0];
      const chronologicalAttempts = attempts.toReversed();

      return {
        ...operation,
        attemptCount: attempts.length,
        dispatch: outbox ? dispatchOf(outbox) : null,
        failureCode: attempts[0]?.failureCode ?? null,
        latestAttemptOutcome: attempts[0]?.outcome ?? null,
        platform: publish?.platform ?? null,
        timeline: timelineOf(operation, outbox, chronologicalAttempts),
      };
    },
  );

  // Non-terminal first; Array.sort is stable, so the query order holds inside
  // each group.
  return summaries.sort(
    (a, b) => Number(isTerminal(a.lifecycle)) - Number(isTerminal(b.lifecycle)),
  );
}

type OutboxSnapshot = {
  dispatchAttemptCount: number;
  dispatchedAt: Date | null;
  exhaustedAt: Date | null;
  id: string;
  nextAttemptAt: Date;
};

type UsageSnapshot = {
  id: string;
  invocationKey: NonNullable<OperationSummary["timeline"][number]["slot"]>;
  occurredAt: Date;
  status: UsageStatus;
};

type AttemptSnapshot = {
  createdAt: Date;
  id: string;
  outcome: OperationSummary["latestAttemptOutcome"];
  updatedAt: Date;
  usageEvents: UsageSnapshot[];
};

function dispatchOf(outbox: OutboxSnapshot): OperationSummary["dispatch"] {
  if (outbox.exhaustedAt) {
    return { nextAttemptAt: outbox.nextAttemptAt, state: "exhausted" };
  }

  if (outbox.dispatchedAt) {
    return { nextAttemptAt: outbox.nextAttemptAt, state: "dispatched" };
  }

  return {
    nextAttemptAt: outbox.nextAttemptAt,
    state: outbox.dispatchAttemptCount > 0 ? "delayed" : "undispatched",
  };
}

function timelineOf(
  operation: Pick<
    OperationSummary,
    | "commandType"
    | "createdAt"
    | "effectiveAt"
    | "id"
    | "lifecycle"
    | "updatedAt"
  >,
  outbox: OutboxSnapshot | undefined,
  attempts: AttemptSnapshot[],
): OperationSummary["timeline"] {
  const timeline: OperationSummary["timeline"] = [
    {
      at: operation.createdAt,
      kind: "received",
      outcome: null,
      slot: null,
      sourceId: operation.id,
    },
  ];

  if (outbox?.dispatchedAt) {
    timeline.push({
      at: outbox.dispatchedAt,
      kind: "dispatched",
      outcome: null,
      slot: null,
      sourceId: outbox.id,
    });
  }

  for (const attempt of attempts) {
    timeline.push({
      at: attempt.createdAt,
      kind: "started",
      outcome: null,
      slot: null,
      sourceId: attempt.id,
    });

    for (const usage of attempt.usageEvents) {
      timeline.push({
        at: usage.occurredAt,
        kind: "modelCall",
        outcome: USAGE_OUTCOME[usage.status],
        slot: usage.invocationKey,
        sourceId: usage.id,
      });
    }

    if (
      operationCommandKind(operation.commandType) === "scheduled-effect-probe"
    ) {
      timeline.push({
        at: operation.effectiveAt,
        kind: "waiting",
        outcome: null,
        slot: null,
        sourceId: attempt.id,
      });
      if (attempt.outcome) {
        timeline.push({
          at: attempt.updatedAt,
          kind: "effectRecorded",
          outcome: attempt.outcome,
          slot: null,
          sourceId: attempt.id,
        });
      }
    }
  }

  if (SETTLED_LIFECYCLES.includes(operation.lifecycle)) {
    timeline.push({
      at: operation.updatedAt,
      kind: "settled",
      outcome: attempts.at(-1)?.outcome ?? null,
      slot: null,
      sourceId: operation.id,
    });
  }

  return timeline;
}

function isTerminal(lifecycle: OperationLifecycle) {
  return TERMINAL_LIFECYCLES.includes(lifecycle);
}
