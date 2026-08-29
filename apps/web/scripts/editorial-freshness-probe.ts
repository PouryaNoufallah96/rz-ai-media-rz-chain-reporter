import assert from "node:assert/strict";

import { DRAFT_CHANGE_CODES } from "@rz-chain-reporter/contracts";

import { cardSheetDraftChangeKey } from "../src/features/editorial/lib/editorial-freshness";

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

console.log("editorial freshness policy probe passed");
