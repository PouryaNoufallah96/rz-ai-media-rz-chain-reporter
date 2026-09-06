import assert from "node:assert/strict";
import type { RunConfiguration } from "@rz-chain-reporter/contracts";

import {
  telegramLanesPending,
  telegramZoneNotice,
} from "../src/features/editorial/lib/board-presentation";

const settled = new Date("2026-09-05T00:00:00.000Z");

const acquisition = (
  totalChannels: number,
  acquiredChannels: number,
  failures: number,
) => ({
  acquiredChannels,
  failures: Array.from({ length: failures }, () => ({})),
  totalChannels,
});

assert.equal(
  telegramZoneNotice(
    {
      completedAt: settled,
      kind: "news",
      telegramAcquisition: acquisition(3, 2, 1),
    },
    0,
  ),
  "no_candidates",
  "D4: a settled run whose Telegram channels yielded no lane must say so",
);

assert.equal(
  telegramZoneNotice(
    {
      completedAt: settled,
      kind: "news",
      telegramAcquisition: acquisition(3, 0, 3),
    },
    0,
  ),
  "acquisition_failed",
  "D6 precedes D4 when every channel failed",
);

assert.equal(
  telegramZoneNotice(
    {
      completedAt: settled,
      kind: "news",
      telegramAcquisition: acquisition(3, 2, 1),
    },
    1,
  ),
  null,
  "a run with Telegram lanes shows no empty notice",
);

assert.equal(
  telegramZoneNotice(
    {
      completedAt: null,
      kind: "news",
      telegramAcquisition: acquisition(3, 2, 1),
    },
    0,
  ),
  null,
  "an unsettled run must not claim the filter rejected everything",
);

assert.equal(
  telegramZoneNotice(
    {
      completedAt: settled,
      kind: "news",
      telegramAcquisition: acquisition(0, 0, 0),
    },
    0,
  ),
  null,
  "a run with no Telegram channel has no Telegram zone to report on",
);

assert.equal(
  telegramZoneNotice(
    {
      completedAt: settled,
      kind: "promo",
      telegramAcquisition: acquisition(3, 2, 1),
    },
    0,
  ),
  null,
  "a promo run has no Telegram candidates to report",
);

const newsRun = (sourceIds: readonly string[], completedAt: Date | null) => ({
  completedAt,
  configuration: {
    kind: "news" as const,
    sourceIds,
  } as RunConfiguration,
});

assert.equal(
  telegramLanesPending(newsRun(["rss-1", "tg-1"], null), ["tg-1"], false),
  true,
  "C1: a Telegram lane placeholder holds until the zone's lanes are final",
);

assert.equal(
  telegramLanesPending(newsRun(["rss-1", "tg-1"], null), ["tg-1"], true),
  false,
  "planned units mean filter-and-score already committed the Telegram routes",
);

assert.equal(
  telegramLanesPending(newsRun(["rss-1"], null), ["tg-1"], false),
  false,
  "a run that selected no Telegram source has no Telegram lane to await",
);

assert.equal(
  telegramLanesPending(newsRun(["tg-1"], settled), ["tg-1"], false),
  false,
  "a settled run shows its real lanes, never a placeholder",
);

assert.equal(
  telegramLanesPending(null, ["tg-1"], false),
  false,
  "a fresh workspace has no run to await",
);

process.stdout.write("PASS telegram zone notice\n");
