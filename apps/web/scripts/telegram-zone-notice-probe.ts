import assert from "node:assert/strict";

import { telegramZoneNotice } from "../src/features/editorial/lib/board-presentation";

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

process.stdout.write("PASS telegram zone notice\n");
