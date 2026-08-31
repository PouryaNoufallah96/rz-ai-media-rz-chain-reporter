import assert from "node:assert/strict";

import { DRAFT_CHANGE_CODES } from "@rz-chain-reporter/contracts";

import { cardSheetDraftChangeKey } from "../src/features/editorial/lib/editorial-freshness";
import {
  OPERATIONS_ACTIVE_REFETCH_INTERVAL_MS,
  operationsSnapshotRefetchInterval,
} from "../src/features/operations/lib/operations-list-query";
import {
  requestRealtimeRefresh,
  settleRealtimeRefresh,
  transitionRealtimeConnection,
} from "../src/lib/realtime-freshness";

const analysisRunId = "019b76da-a800-7000-8000-000000000001";
const platformDraftId = "019b76da-a800-7000-8000-000000000002";
const operationId = "019b76da-a800-7000-8000-000000000003";

const message = (code: (typeof DRAFT_CHANGE_CODES)[number]) => ({
  analysisRunId,
  code,
  occurredAt: "2026-08-30T10:00:00.000Z",
  operationId,
  platformDraftId,
  schemaVersion: 1 as const,
});

for (const code of DRAFT_CHANGE_CODES) {
  const key = cardSheetDraftChangeKey(
    message(code),
    analysisRunId,
    platformDraftId,
    null,
  );
  assert.equal(key !== null, !code.startsWith("unit_"), code);
}

assert.equal(
  cardSheetDraftChangeKey(
    message("succeeded"),
    analysisRunId,
    operationId,
    null,
  ),
  null,
);
assert.equal(
  cardSheetDraftChangeKey(
    message("succeeded"),
    operationId,
    platformDraftId,
    null,
  ),
  null,
);
assert.equal(
  cardSheetDraftChangeKey(
    { code: "succeeded" },
    analysisRunId,
    platformDraftId,
    null,
  ),
  null,
);
assert.equal(
  cardSheetDraftChangeKey(message("running"), analysisRunId, platformDraftId, {
    lifecycle: "queued",
    operationId,
  }),
  null,
);
assert.equal(
  cardSheetDraftChangeKey(message("running"), analysisRunId, platformDraftId, {
    lifecycle: "settling",
    operationId,
  }),
  null,
);
assert.equal(
  cardSheetDraftChangeKey(
    message("succeeded"),
    analysisRunId,
    platformDraftId,
    { lifecycle: "succeeded", operationId },
  ),
  null,
);
assert.equal(
  cardSheetDraftChangeKey(message("running"), analysisRunId, platformDraftId, {
    lifecycle: "running",
    operationId: platformDraftId,
  }),
  `${operationId}:running`,
);

let queue = requestRealtimeRefresh("idle");
assert.deepEqual(queue, { queue: "refreshing", start: true });
queue = requestRealtimeRefresh(queue.queue);
assert.deepEqual(queue, { queue: "trailing", start: false });
queue = requestRealtimeRefresh(queue.queue);
assert.deepEqual(queue, { queue: "trailing", start: false });
queue = settleRealtimeRefresh(queue.queue);
assert.deepEqual(queue, { queue: "refreshing", start: true });
queue = settleRealtimeRefresh(queue.queue);
assert.deepEqual(queue, { queue: "idle", start: false });

let connection = transitionRealtimeConnection(
  { active: false, needsCatchUp: false },
  ["open"],
);
assert.deepEqual(connection, {
  connection: { active: true, needsCatchUp: false },
  catchUp: false,
});
connection = transitionRealtimeConnection(connection.connection, ["open"]);
assert.deepEqual(connection, {
  connection: { active: true, needsCatchUp: false },
  catchUp: false,
});
connection = transitionRealtimeConnection(connection.connection, ["closed"]);
assert.deepEqual(connection, {
  connection: { active: false, needsCatchUp: true },
  catchUp: false,
});
connection = transitionRealtimeConnection(connection.connection, ["open"]);
assert.deepEqual(connection, {
  connection: { active: true, needsCatchUp: false },
  catchUp: true,
});
connection = transitionRealtimeConnection(connection.connection, ["paused"]);
assert.deepEqual(connection, {
  connection: { active: false, needsCatchUp: true },
  catchUp: false,
});
connection = transitionRealtimeConnection(connection.connection, ["open"]);
assert.deepEqual(connection, {
  connection: { active: true, needsCatchUp: false },
  catchUp: true,
});

const coldPaused = transitionRealtimeConnection(
  { active: false, needsCatchUp: false },
  ["paused"],
);
assert.deepEqual(coldPaused, {
  connection: { active: false, needsCatchUp: true },
  catchUp: false,
});
assert.deepEqual(
  transitionRealtimeConnection(coldPaused.connection, ["open"]),
  {
    connection: { active: true, needsCatchUp: false },
    catchUp: true,
  },
);

const coldError = transitionRealtimeConnection(
  { active: false, needsCatchUp: false },
  ["error"],
);
assert.deepEqual(coldError, {
  connection: { active: false, needsCatchUp: true },
  catchUp: false,
});
assert.deepEqual(transitionRealtimeConnection(coldError.connection, ["open"]), {
  connection: { active: true, needsCatchUp: false },
  catchUp: true,
});

const partialConnection = transitionRealtimeConnection(
  { active: false, needsCatchUp: false },
  ["open", "connecting"],
);
assert.deepEqual(partialConnection, {
  connection: { active: false, needsCatchUp: false },
  catchUp: false,
});

assert.equal(operationsSnapshotRefetchInterval(undefined), false);
assert.equal(
  operationsSnapshotRefetchInterval([
    { lifecycle: "succeeded" },
    { lifecycle: "failed" },
  ]),
  false,
);
assert.equal(
  operationsSnapshotRefetchInterval([
    { lifecycle: "succeeded" },
    { lifecycle: "running" },
  ]),
  OPERATIONS_ACTIVE_REFETCH_INTERVAL_MS,
);

console.log("editorial freshness policy probe passed");
