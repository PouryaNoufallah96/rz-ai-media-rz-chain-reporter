import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";

import { createMinioStorage } from "../src/index";

type ProbeOperation =
  | "configuration"
  | "delete"
  | "get"
  | "head"
  | "list"
  | "openRead"
  | "put";

class StorageProbeError extends Error {
  constructor(readonly operation: ProbeOperation) {
    super(`Storage compatibility probe failed during ${operation}`);
  }
}

async function execute<T>(operation: ProbeOperation, effect: () => Promise<T>) {
  try {
    return await effect();
  } catch {
    throw new StorageProbeError(operation);
  }
}

function report(
  operation: ProbeOperation,
  metadata: Record<string, boolean | number | string>,
) {
  process.stdout.write(
    `${JSON.stringify({ operation, status: "pass", ...metadata })}\n`,
  );
}

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new StorageProbeError("configuration");
  }
  return value;
}

function storageConfig() {
  return {
    accessKeyId: requiredEnv("S3_ACCESS_KEY_ID"),
    bucket: requiredEnv("S3_BUCKET"),
    endpoint: requiredEnv("S3_ENDPOINT"),
    region: requiredEnv("S3_REGION"),
    secretAccessKey: requiredEnv("S3_SECRET_ACCESS_KEY"),
  };
}

async function readAll(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    receivedBytes += value.byteLength;
  }

  return { bytes: Buffer.concat(chunks), chunks: chunks.length, receivedBytes };
}

async function run() {
  const storage = createMinioStorage(storageConfig());
  const key = `storage-probe/${randomUUID()}`;
  const body = randomBytes(64);
  const contentType = "application/octet-stream";
  let uploaded = false;
  let deleted = false;

  try {
    await execute("put", () => storage.put(key, body, contentType));
    uploaded = true;
    report("put", { bytes: body.byteLength, forcePathStyle: true });

    const metadata = await execute("head", () => storage.head(key));
    assert.equal(metadata.size, body.byteLength);
    assert.equal(metadata.contentType, contentType);
    report("head", {
      bytes: metadata.size,
      contentType: metadata.contentType,
    });

    const object = await execute("get", () => storage.openRead(key));
    assert.equal(object.contentLength, body.byteLength);
    report("get", { bytes: object.contentLength, bodyPresent: true });

    const streamed = await execute("openRead", () => readAll(object.stream));
    assert.equal(streamed.receivedBytes, body.byteLength);
    assert.deepEqual(streamed.bytes, body);
    report("openRead", {
      bytes: streamed.receivedBytes,
      chunks: streamed.chunks,
      streamed: true,
    });

    const listed = await execute("list", () =>
      storage.list({ prefix: key, limit: 1 }),
    );
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]?.key, key);
    report("list", { bytes: listed.items[0]?.size ?? 0, objects: 1 });

    await execute("delete", () => storage.delete([key]));
    deleted = true;
    report("delete", { objects: 1 });
  } finally {
    if (uploaded && !deleted) {
      await execute("delete", () => storage.delete([key]));
    }
  }
}

run().catch((error: unknown) => {
  const operation =
    error instanceof StorageProbeError ? error.operation : "configuration";
  process.stderr.write(
    `${JSON.stringify({ operation, probe: "storage", status: "failed" })}\n`,
  );
  process.exitCode = 1;
});
