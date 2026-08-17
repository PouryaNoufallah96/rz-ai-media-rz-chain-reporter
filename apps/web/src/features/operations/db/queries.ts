import "server-only";

import type { OperationLifecycle } from "@rz-chain-reporter/contracts";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { inWorkspace } from "@rz-chain-reporter/db/filters";

import { RECENT_TERMINAL_WINDOW_MS } from "../constants";

const TERMINAL_LIFECYCLES: OperationLifecycle[] = [
  "succeeded",
  "failed",
  "cancelled",
];

export async function listRecentOperations(
  executor: Executor,
  workspaceId: string,
) {
  const settledSince = new Date(Date.now() - RECENT_TERMINAL_WINDOW_MS);

  const rows = await executor.query.operation.findMany({
    columns: {
      commandType: true,
      createdAt: true,
      effectiveAt: true,
      id: true,
      lifecycle: true,
      updatedAt: true,
    },
    with: {
      attempts: {
        columns: { failureCode: true, outcome: true },
        orderBy: (attempt, { desc }) => desc(attempt.attemptNumber),
        where: (attempt) => inWorkspace(attempt, workspaceId),
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

  const summaries = rows.map(({ attempts, publish, ...operation }) => ({
    ...operation,
    attemptCount: attempts.length,
    failureCode: attempts[0]?.failureCode ?? null,
    latestAttemptOutcome: attempts[0]?.outcome ?? null,
    platform: publish?.platform ?? null,
  }));

  // Non-terminal first; Array.sort is stable, so the query order holds inside
  // each group.
  return summaries.sort(
    (a, b) => Number(isTerminal(a.lifecycle)) - Number(isTerminal(b.lifecycle)),
  );
}

function isTerminal(lifecycle: OperationLifecycle) {
  return TERMINAL_LIFECYCLES.includes(lifecycle);
}
