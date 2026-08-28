import assert from "node:assert/strict";

import { hashPublishingMediaGrant } from "@rz-chain-reporter/db/repositories/publishing-media-grant";
import {
  formatDestinationBindingReport,
  resolveDestinationBindings,
} from "@rz-chain-reporter/env/destination-bindings";

import { sanitizeRoute, scrubTransactionEvent } from "../lib/sentry-privacy";
import {
  type PublishingMediaGrantDependencies,
  streamPublishingMediaGrant,
} from "./publishing-media-grant";

const bytes = new TextEncoder().encode("verified-instagram-media");
const objectKey = "workspace/opaque-media-object";
const mimeType = "image/png";
const now = new Date("2026-08-27T00:00:00.000Z");

type GrantRecord = {
  acceptedAt: Date | null;
  expiresAt: Date;
  grantedMediaAssetId: string;
  mediaAssetId: string;
  revokedAt: Date | null;
  tokenHash: string;
  verified: boolean;
};

const rawTokens = {
  accepted: token(1),
  expired: token(2),
  mismatched: token(3),
  revoked: token(4),
  unverified: token(5),
  valid: token(6),
  wrong: token(7),
};
const rawTokenValues = new Set(Object.values(rawTokens));

const records = new Map<string, GrantRecord>();
const lookupInputs: string[] = [];

addRecord(rawTokens.accepted, {
  acceptedAt: new Date("2026-08-26T23:59:00.000Z"),
});
addRecord(rawTokens.expired, {
  expiresAt: new Date("2026-08-26T23:59:00.000Z"),
});
addRecord(rawTokens.mismatched, { grantedMediaAssetId: "other-media" });
addRecord(rawTokens.revoked, {
  revokedAt: new Date("2026-08-26T23:59:00.000Z"),
});
addRecord(rawTokens.unverified, { verified: false });
addRecord(rawTokens.valid);

const dependencies: PublishingMediaGrantDependencies = {
  async findGrant(tokenHash, readAt) {
    lookupInputs.push(tokenHash);
    const record = records.get(tokenHash);
    if (
      !record ||
      record.expiresAt <= readAt ||
      record.acceptedAt !== null ||
      record.revokedAt !== null ||
      !record.verified ||
      record.mediaAssetId !== record.grantedMediaAssetId
    ) {
      return null;
    }
    return {
      asset: {
        actualBytes: bytes.byteLength,
        mimeType,
        objectKey,
      },
    };
  },
  now: () => now,
  openRead: async (key) => {
    assert.equal(key, objectKey);
    return { contentLength: bytes.byteLength, stream: byteStream(bytes) };
  },
};

async function main() {
  const rejectedResponses = await Promise.all(
    [
      rawTokens.accepted,
      rawTokens.expired,
      rawTokens.mismatched,
      rawTokens.revoked,
      rawTokens.unverified,
      rawTokens.wrong,
    ].map((candidate) => streamPublishingMediaGrant(candidate, dependencies)),
  );
  assert.equal(
    rejectedResponses.every(({ status }) => status === 404),
    true,
  );

  const lookupCount = lookupInputs.length;
  assert.equal(
    (await streamPublishingMediaGrant("invalid", dependencies)).status,
    404,
  );
  assert.equal(lookupInputs.length, lookupCount);

  const validResponses = await Promise.all([
    streamPublishingMediaGrant(rawTokens.valid, dependencies),
    streamPublishingMediaGrant(rawTokens.valid, dependencies),
  ]);
  assert.equal(
    JSON.stringify(validResponses.map(({ headers }) => [...headers])).includes(
      objectKey,
    ),
    false,
  );
  await Promise.all(
    validResponses.map(async (response) => {
      assert.equal(response.status, 200);
      assert.deepEqual(new Uint8Array(await response.arrayBuffer()), bytes);
      assert.equal(response.headers.get("content-type"), mimeType);
      assert.equal(
        response.headers.get("content-length"),
        String(bytes.byteLength),
      );
      assert.match(response.headers.get("cache-control") ?? "", /no-store/);
      assert.equal(response.headers.get("location"), null);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("content-disposition"), null);
    }),
  );

  const validRecord = records.get(hashPublishingMediaGrant(rawTokens.valid));
  assert.ok(validRecord);
  validRecord.acceptedAt = now;
  assert.equal(
    (await streamPublishingMediaGrant(rawTokens.valid, dependencies)).status,
    404,
  );
  assert.equal(
    lookupInputs.some((value) => rawTokenValues.has(value)),
    false,
  );

  const routeCanary = `/api/publishing-media/${rawTokens.valid}`;
  const scrubbed = scrubTransactionEvent({
    type: "transaction",
    transaction: `GET ${routeCanary}?source=meta`,
    spans: [
      {
        data: {},
        description: `GET ${routeCanary}`,
        span_id: "0123456789abcdef",
        start_timestamp: 1,
        trace_id: "0123456789abcdef0123456789abcdef",
      },
    ],
  });
  assert.equal(JSON.stringify(scrubbed).includes(rawTokens.valid), false);
  assert.equal(sanitizeRoute(routeCanary), "/api/publishing-media/:grant");

  const enabledInstagram = resolveDestinationBindings(
    [
      {
        key: "instagram-account",
        platform: "instagram",
        enabled: true,
        retired: false,
      },
    ],
    {},
  );
  assert.equal(enabledInstagram.satisfied, false);
  assert.deepEqual(enabledInstagram.deployment, [
    { platform: "instagram", missing: ["system_user_access_token"] },
  ]);
  assert.match(formatDestinationBindingReport(enabledInstagram), /unbound/);
  assert.equal(
    formatDestinationBindingReport(enabledInstagram).includes(
      "META_INSTAGRAM_SYSTEM_USER_ACCESS_TOKEN",
    ),
    false,
  );

  const disabledInstagram = resolveDestinationBindings(
    [
      {
        key: "instagram-account",
        platform: "instagram",
        enabled: false,
        retired: false,
      },
    ],
    {},
  );
  assert.equal(disabledInstagram.satisfied, true);
  assert.equal(disabledInstagram.destinations[0]?.status, "inactive");

  console.log("publishing media grant probe passed");
}

main().catch(() => {
  console.error("publishing media grant probe failed");
  process.exitCode = 1;
});

function token(fill: number) {
  return Buffer.alloc(32, fill).toString("base64url");
}

function addRecord(
  rawToken: string,
  overrides: Partial<Omit<GrantRecord, "tokenHash">> = {},
) {
  const tokenHash = hashPublishingMediaGrant(rawToken);
  records.set(tokenHash, {
    acceptedAt: null,
    expiresAt: new Date("2026-08-27T00:05:00.000Z"),
    grantedMediaAssetId: "media",
    mediaAssetId: "media",
    revokedAt: null,
    tokenHash,
    verified: true,
    ...overrides,
  });
}

function byteStream(value: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}
