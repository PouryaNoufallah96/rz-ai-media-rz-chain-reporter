import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  MAX_REFERENCE_IMAGE_BYTES,
  MEDIA_UPLOAD_CONFIRMED_EVENT_NAME,
  REFERENCE_IMAGE_KIND,
} from "@rz-chain-reporter/contracts";
import { createDb } from "@rz-chain-reporter/db";
import { executeDraftRevisionCommand } from "@rz-chain-reporter/db/repositories/draft-revision";
import {
  claimMediaValidation,
  createMediaUploadIntent,
  getMediaAsset,
  markMediaUploaded,
  resolveMediaAssetObjectOwnership,
} from "@rz-chain-reporter/db/repositories/media-asset";
import { imageGeneration } from "@rz-chain-reporter/db/schema/image-generation";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import type {
  Storage,
  StorageObjectListPage,
} from "@rz-chain-reporter/storage";
import dotenv from "dotenv";
import { and, asc, eq, sql } from "drizzle-orm";
import sharp from "sharp";

import { createInngestClient } from "./client";
import { createMediaUploadVerificationFunction } from "./media-upload-function";
import { cleanupMediaAsset, verifyMediaUpload } from "./media-verification";
import type { WorkerRuntime } from "./runtime";
import { reconcileStorage } from "./storage-reconciliation";

dotenv.config({ path: "../../.env" });

const configuredDatabaseUrl = process.env.DATABASE_URL;
if (!configuredDatabaseUrl) throw new Error("DATABASE_URL is required");
const databaseUrl: string = configuredDatabaseUrl;
const databaseTarget = new URL(databaseUrl);
if (
  !["127.0.0.1", "localhost", "::1"].includes(databaseTarget.hostname) ||
  !["/rz-chain-reporter", "/rz_chain_reporter_lifecycle_probe"].includes(
    databaseTarget.pathname,
  )
) {
  throw new Error(
    "media verification probe requires the local project database",
  );
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type StoredObject = {
  bytes: Uint8Array;
  contentType: string;
  lastModified: Date;
};

class ProbeStorage implements Storage {
  readonly deleted: string[] = [];
  readonly objects = new Map<string, StoredObject>();
  headCalls = 0;
  listCalls = 0;
  readonly listCursors: Array<string | undefined> = [];
  openReadCalls = 0;
  signedUrlCalls = 0;
  transientHeadFailures = 0;
  transientListFailures = 0;

  async delete(keys: string[]) {
    for (const key of keys) {
      this.objects.delete(key);
      this.deleted.push(key);
    }
  }

  async getSignedUrl(_key: string, _expiresInSeconds: number): Promise<string> {
    this.signedUrlCalls += 1;
    throw new Error("probe forbids signed URLs");
  }

  async head(key: string) {
    this.headCalls += 1;
    if (this.transientHeadFailures > 0) {
      this.transientHeadFailures -= 1;
      throw new Error("transient storage failure");
    }
    const object = this.required(key);
    return { contentType: object.contentType, size: object.bytes.byteLength };
  }

  async list(input: {
    prefix: string;
    cursor?: string;
    limit: number;
  }): Promise<StorageObjectListPage> {
    this.listCalls += 1;
    this.listCursors.push(input.cursor);
    if (this.transientListFailures > 0) {
      this.transientListFailures -= 1;
      throw new Error("transient storage list failure");
    }
    const keys = [...this.objects.keys()]
      .filter(
        (key) =>
          key.startsWith(input.prefix) && (!input.cursor || key > input.cursor),
      )
      .sort()
      .slice(0, input.limit);
    return {
      items: keys.map((key) => {
        const object = this.required(key);
        return {
          key,
          lastModified: object.lastModified,
          size: object.bytes.byteLength,
        };
      }),
      nextCursor: keys.length === input.limit ? keys.at(-1) : undefined,
    };
  }

  async openRead(key: string) {
    this.openReadCalls += 1;
    const bytes = this.required(key).bytes;
    return {
      contentLength: bytes.byteLength,
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    this.objects.set(key, {
      bytes: new Uint8Array(body),
      contentType,
      lastModified: new Date(),
    });
  }

  private required(key: string) {
    const object = this.objects.get(key);
    if (object) return object;
    const error = new Error("object missing");
    error.name = "NoSuchKey";
    throw error;
  }
}

const database = createDb(databaseUrl, { max: 12 });
const storage = new ProbeStorage();
const ids = {
  actor: `media-probe-${randomUUID()}`,
  analysisOperation: randomUUID(),
  analysisRun: randomUUID(),
  analysisUnit: randomUUID(),
  brand: randomUUID(),
  copyAttempt: randomUUID(),
  copyGeneration: randomUUID(),
  copyUnit: randomUUID(),
  copyVariant: randomUUID(),
  draft: randomUUID(),
  imageOperation: randomUUID(),
  promo: randomUUID(),
  revision: randomUUID(),
  retryOperation: randomUUID(),
  verificationOperation: randomUUID(),
  verifiedOperation: randomUUID(),
  workspace: randomUUID(),
};
const createdMediaIds: string[] = [];
const observed: string[] = [];

try {
  await insertFixture();
  await proveTerminalFailureSettlement();
  await proveTransientVerificationRetry();
  await proveVerification();
  await proveCleanupAttachmentRace();
  await proveReconciliation();
  await proveReconciliationListRetry();
  await proveCommitUncertainty();
  assert.equal(storage.signedUrlCalls, 0);
  observed.push("no-presigned-path");
  console.log(`media verification probe passed: ${observed.join(", ")}`);
} finally {
  await cleanupFixture().catch(() => undefined);
  await database.close();
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function proveTerminalFailureSettlement() {
  const uploaded = await createUploaded({ bytes: await paddedPng(4096) });
  await insertVerificationOperation(ids.verificationOperation, uploaded.id);
  const claimed = await claimMediaValidation(database.db, ids.workspace, {
    id: uploaded.id,
    version: uploaded.version,
  });
  assert.equal(claimed.status, "updated");

  const client = createInngestClient(
    `media-verification-probe-${randomUUID()}`,
  );
  const runtime = {
    db: database.db,
    identity: {
      customerTemplateKey: "probe",
      fingerprint: "probe",
    },
  } satisfies Pick<WorkerRuntime, "db" | "identity">;
  const verification = createMediaUploadVerificationFunction(client, runtime);
  const published: string[] = [];
  const step = {
    realtime: {
      publish: async (id: string) => {
        published.push(id);
      },
    },
    run: async (_id: string, execute: () => Promise<unknown>) => execute(),
  };
  const descriptor = verification as unknown as {
    opts: { onFailure?: unknown; retries?: number };
    onFailureFn: (input: {
      event: {
        data: {
          error: { message: string };
          run_id: string;
          event: {
            data: {
              mediaAssetId: string;
              operationId: string;
              schemaVersion: 1;
              workspaceId: string;
            };
          };
        };
      };
      step: typeof step;
    }) => Promise<void>;
  };
  assert.equal(descriptor.opts.retries, 2);
  assert.equal(typeof descriptor.opts.onFailure, "function");
  const onFailure = descriptor.onFailureFn;
  assert.equal(typeof onFailure, "function");
  const failedRunId = randomUUID();

  const failedEvent = {
    event: {
      data: {
        error: { message: "storage token=must-not-persist" },
        run_id: failedRunId,
        event: {
          data: {
            mediaAssetId: uploaded.id,
            operationId: ids.verificationOperation,
            schemaVersion: 1 as const,
            workspaceId: ids.workspace,
          },
        },
      },
    },
    step,
  };
  await onFailure(failedEvent);
  await onFailure(failedEvent);

  const verified = await createUploaded({ bytes: await paddedPng(4096) });
  assert.deepEqual(
    await verifyMediaUpload(database.db, storage, ids.workspace, verified.id),
    { status: "verified" },
  );
  await insertVerificationOperation(ids.verifiedOperation, verified.id);
  const verifiedRunId = randomUUID();
  const verifiedEvent = {
    event: {
      data: {
        error: { message: "commit response lost token=must-not-persist" },
        run_id: verifiedRunId,
        event: {
          data: {
            mediaAssetId: verified.id,
            operationId: ids.verifiedOperation,
            schemaVersion: 1 as const,
            workspaceId: ids.workspace,
          },
        },
      },
    },
    step,
  };
  await onFailure(verifiedEvent);
  await onFailure(verifiedEvent);

  const [terminal] = await database.db
    .select({ lifecycle: operation.lifecycle })
    .from(operation)
    .where(eq(operation.id, ids.verificationOperation));
  assert.equal(terminal?.lifecycle, "failed");
  assert.equal(
    (await getMediaAsset(database.db, ids.workspace, uploaded.id))?.lifecycle,
    "uploaded",
  );
  const attempts = await database.db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(eq(operationAttempt.operationId, ids.verificationOperation));
  assert.deepEqual(attempts, [
    {
      failureCode: "INTERNAL_SERVER_ERROR",
      outcome: "failed_terminal",
    },
  ]);
  const [verifiedTerminal] = await database.db
    .select({ lifecycle: operation.lifecycle })
    .from(operation)
    .where(eq(operation.id, ids.verifiedOperation));
  assert.equal(verifiedTerminal?.lifecycle, "succeeded");
  const verifiedAttempts = await database.db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(eq(operationAttempt.operationId, ids.verifiedOperation));
  assert.deepEqual(verifiedAttempts, [
    { failureCode: null, outcome: "succeeded" },
  ]);
  assert.deepEqual(published, [
    `publish-${ids.verificationOperation}-3-failed-status`,
    `publish-${ids.verificationOperation}-3-failed-status`,
    `publish-${ids.verifiedOperation}-3-succeeded-status`,
    `publish-${ids.verifiedOperation}-3-succeeded-status`,
  ]);

  const mismatchedOperationId = randomUUID();
  const mismatchedBound = await createUploaded({
    bytes: await paddedPng(4096),
  });
  const mismatchedEventAsset = await createUploaded({
    bytes: await paddedPng(4096),
  });
  await insertVerificationOperation(mismatchedOperationId, mismatchedBound.id);
  await onFailure({
    event: {
      data: {
        error: { message: "controlled pre-claim failure" },
        run_id: randomUUID(),
        event: {
          data: {
            mediaAssetId: mismatchedEventAsset.id,
            operationId: mismatchedOperationId,
            schemaVersion: 1,
            workspaceId: ids.workspace,
          },
        },
      },
    },
    step,
  });
  const [mismatched] = await database.db
    .select({ lifecycle: operation.lifecycle })
    .from(operation)
    .where(eq(operation.id, mismatchedOperationId));
  assert.equal(mismatched?.lifecycle, "queued");
  assert.equal(
    (
      await database.db
        .select({ id: operationAttempt.id })
        .from(operationAttempt)
        .where(eq(operationAttempt.operationId, mismatchedOperationId))
    ).length,
    0,
  );
  observed.push(
    "terminal-failure-settlement-idempotent",
    "verified-commit-recovered-as-success",
    "terminal-onfailure-realtime-repaired",
    "mismatched-failure-event-ignored",
  );
}

async function proveTransientVerificationRetry() {
  const uploaded = await createUploaded({ bytes: await paddedPng(4096) });
  await insertVerificationOperation(ids.retryOperation, uploaded.id);
  const client = createInngestClient(`media-retry-probe-${randomUUID()}`);
  const runtime = {
    db: database.db,
    identity: {
      customerTemplateKey: "probe",
      fingerprint: "probe",
    },
  } satisfies Pick<WorkerRuntime, "db" | "identity">;
  const verification = createMediaUploadVerificationFunction(client, runtime, {
    assertRuntimeWorkspace: async () => undefined,
    storage: () => storage,
  });
  const published: string[] = [];
  let expireLeaseBeforeVerification = false;
  const step = {
    realtime: {
      publish: async (id: string) => {
        published.push(id);
      },
    },
    run: async (id: string, execute: () => Promise<unknown>) => {
      if (expireLeaseBeforeVerification && id === "verify-media-upload-1") {
        expireLeaseBeforeVerification = false;
        await database.db
          .update(operation)
          .set({ leaseExpiresAt: new Date(Date.now() - 1) })
          .where(eq(operation.id, ids.retryOperation));
      }
      return execute();
    },
  };
  const handler = (
    verification as unknown as {
      fn: (input: {
        attempt: number;
        event: {
          data: {
            mediaAssetId: string;
            operationId: string;
            schemaVersion: 1;
            workspaceId: string;
          };
        };
        runId: string;
        step: typeof step;
      }) => Promise<unknown>;
    }
  ).fn;
  const event = {
    data: {
      mediaAssetId: uploaded.id,
      operationId: ids.retryOperation,
      schemaVersion: 1 as const,
      workspaceId: ids.workspace,
    },
  };
  const runId = randomUUID();
  const initialHeadCalls = storage.headCalls;
  const initialOpenReadCalls = storage.openReadCalls;
  storage.transientHeadFailures = 1;

  await assert.rejects(
    handler({ attempt: 0, event, runId, step }),
    (error: unknown) =>
      error instanceof Error && error.message === "INTERNAL_SERVER_ERROR",
  );
  assert.equal(
    (await getMediaAsset(database.db, ids.workspace, uploaded.id))?.lifecycle,
    "validating",
  );
  const [running] = await database.db
    .select({
      attemptSeq: operation.attemptSeq,
      claimedBy: operation.claimedBy,
      lifecycle: operation.lifecycle,
    })
    .from(operation)
    .where(eq(operation.id, ids.retryOperation));
  assert.deepEqual(running, {
    attemptSeq: 1,
    claimedBy: `media-upload-verification:${runId}`,
    lifecycle: "running",
  });

  expireLeaseBeforeVerification = true;
  await assert.rejects(
    handler({ attempt: 1, event, runId, step }),
    (error: unknown) =>
      error instanceof Error && error.message === "TRANSIENT_CONFLICT",
  );
  assert.equal(
    (await getMediaAsset(database.db, ids.workspace, uploaded.id))?.lifecycle,
    "verified",
  );
  const [expired] = await database.db
    .select({ lifecycle: operation.lifecycle })
    .from(operation)
    .where(eq(operation.id, ids.retryOperation));
  assert.equal(expired?.lifecycle, "running");

  const retried = (await handler({
    attempt: 2,
    event,
    runId,
    step,
  })) as { lifecycle: string | null; status: string };
  assert.equal(retried.status, "replayed");
  assert.equal(retried.lifecycle, "succeeded");
  assert.equal(
    (await getMediaAsset(database.db, ids.workspace, uploaded.id))?.lifecycle,
    "verified",
  );
  assert.equal(storage.headCalls - initialHeadCalls, 2);
  assert.equal(storage.openReadCalls - initialOpenReadCalls, 1);

  const attempts = await database.db
    .select({
      attemptNumber: operationAttempt.attemptNumber,
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(eq(operationAttempt.operationId, ids.retryOperation))
    .orderBy(asc(operationAttempt.attemptNumber));
  assert.deepEqual(attempts, [
    {
      attemptNumber: 1,
      failureCode: "INTERNAL_SERVER_ERROR",
      outcome: "failed_retryable",
    },
    {
      attemptNumber: 2,
      failureCode: "INTERNAL_SERVER_ERROR",
      outcome: "failed_retryable",
    },
    { attemptNumber: 3, failureCode: null, outcome: "succeeded" },
  ]);

  const replayed = (await handler({
    attempt: 2,
    event,
    runId,
    step,
  })) as { status: string };
  assert.equal(replayed.status, "terminal");
  assert.equal(storage.headCalls - initialHeadCalls, 2);
  assert.equal(storage.openReadCalls - initialOpenReadCalls, 1);
  assert.equal(
    (
      await database.db
        .select({ id: operationAttempt.id })
        .from(operationAttempt)
        .where(eq(operationAttempt.operationId, ids.retryOperation))
    ).length,
    3,
  );
  assert.deepEqual(published, [
    `publish-${ids.retryOperation}-5-succeeded-status`,
    `publish-${ids.retryOperation}-5-succeeded-status`,
  ]);
  observed.push(
    "transient-storage-retry-resumes-validation",
    "expired-lease-settlement-rejected",
    "retry-attempt-ledger-owned",
    "terminal-replay-repairs-realtime-without-duplicate-effect",
  );
}

async function insertVerificationOperation(
  operationId: string,
  assetId: string,
) {
  await database.db.execute(sql`insert into operation
    (id, workspace_id, actor, command_type, idempotency_key, request_hash,
     lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
      values (${operationId}, ${ids.workspace}, ${ids.actor},
        ${MEDIA_UPLOAD_CONFIRMED_EVENT_NAME}, ${assetId}, ${assetId}, 'queued', now(),
        0, 1, now(), now())`);
}

async function paddedPng(size: number) {
  const base = await sharp({
    create: {
      width: 8,
      height: 8,
      channels: 3,
      background: { r: 32, g: 64, b: 96 },
    },
  })
    .png()
    .toBuffer();
  assert(base.byteLength < size);
  const bytes = Buffer.alloc(size);
  base.copy(bytes);
  return bytes;
}

async function createUploaded(input: {
  bytes: Uint8Array;
  declaredBytes?: number;
  declaredMimeType?: string;
  kind?: string;
  lastModified?: Date;
}) {
  const id = randomUUID();
  const objectKey = `${ids.workspace}/uploads/${id}`;
  const declaredMimeType = input.declaredMimeType ?? "image/png";
  await storage.put(objectKey, input.bytes, declaredMimeType);
  const stored = storage.objects.get(objectKey);
  if (stored && input.lastModified) stored.lastModified = input.lastModified;
  const pending = await createMediaUploadIntent(database.db, ids.workspace, {
    id,
    objectKey,
    kind: input.kind ?? REFERENCE_IMAGE_KIND,
    mimeType: declaredMimeType,
    declaredBytes: input.declaredBytes ?? input.bytes.byteLength,
    checksum: digest(input.bytes),
    uploadExpiresAt: new Date(Date.now() + 60_000),
  });
  const uploaded = await markMediaUploaded(database.db, ids.workspace, {
    id,
    version: pending.version,
  });
  assert.equal(uploaded.status, "updated");
  createdMediaIds.push(id);
  return uploaded.asset;
}

async function proveVerification() {
  const exactBytes = await paddedPng(MAX_REFERENCE_IMAGE_BYTES);
  const exact = await createUploaded({ bytes: exactBytes });
  assert.deepEqual(
    await verifyMediaUpload(database.db, storage, ids.workspace, exact.id),
    { status: "verified" },
  );
  const exactRow = await getMediaAsset(database.db, ids.workspace, exact.id);
  assert.equal(exactRow?.actualBytes, MAX_REFERENCE_IMAGE_BYTES);
  assert(exactRow?.cleanupAfter);
  observed.push("exact-900-kib");

  const oversized = await createUploaded({
    bytes: Buffer.alloc(MAX_REFERENCE_IMAGE_BYTES + 1),
  });
  const oversizedResult = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    oversized.id,
  );
  assert.equal(oversizedResult.status, "rejected");
  assert.equal(oversizedResult.reason, "FILE_TOO_LARGE");
  observed.push("900-kib-plus-one");

  const mimeMismatch = await createUploaded({
    bytes: await paddedPng(4096),
    declaredMimeType: "image/jpeg",
  });
  const mimeResult = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    mimeMismatch.id,
  );
  assert.equal(mimeResult.status, "rejected");
  assert.equal(mimeResult.reason, "DECLARED_MIME_MISMATCH");

  const declaredMismatch = await createUploaded({
    bytes: await paddedPng(4096),
    declaredBytes: 4095,
  });
  const declaredResult = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    declaredMismatch.id,
  );
  assert.equal(declaredResult.status, "rejected");
  assert.equal(declaredResult.reason, "DECLARED_BYTES_MISMATCH");

  const malformed = await createUploaded({ bytes: Buffer.alloc(1024, 7) });
  const malformedResult = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    malformed.id,
  );
  assert.equal(malformedResult.status, "rejected");
  assert.equal(malformedResult.reason, "IMAGE_MALFORMED");

  const wrongDimension = await sharp({
    create: {
      width: 4097,
      height: 1,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  const dimensionAsset = await createUploaded({ bytes: wrongDimension });
  const dimensionResult = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    dimensionAsset.id,
  );
  assert.equal(dimensionResult.status, "rejected");
  assert.equal(dimensionResult.reason, "IMAGE_MALFORMED");

  const excessPixels = await sharp({
    create: {
      width: 4001,
      height: 4000,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .png()
    .toBuffer();
  const pixelAsset = await createUploaded({ bytes: excessPixels });
  const pixelResult = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    pixelAsset.id,
  );
  assert.equal(pixelResult.status, "rejected");
  assert.equal(pixelResult.reason, "IMAGE_MALFORMED");

  const ordinary = await createUploaded({
    bytes: await paddedPng(4096),
    kind: "image",
  });
  const verifiedFrom = Date.now();
  assert.deepEqual(
    await verifyMediaUpload(database.db, storage, ids.workspace, ordinary.id),
    { status: "verified" },
  );
  const ordinaryRow = await getMediaAsset(
    database.db,
    ids.workspace,
    ordinary.id,
  );
  const ordinaryDeadline = ordinaryRow?.cleanupAfter?.getTime();
  assert(ordinaryDeadline);
  assert(ordinaryDeadline > verifiedFrom + 6 * ONE_DAY_MS);
  assert(ordinaryDeadline <= Date.now() + 7 * ONE_DAY_MS);
  observed.push(
    "mime-decode-dimension-pixel-checks",
    "unattached-image-expiry",
  );
}

async function proveCleanupAttachmentRace() {
  const reference = await createUploaded({ bytes: await paddedPng(4096) });
  const verified = await verifyMediaUpload(
    database.db,
    storage,
    ids.workspace,
    reference.id,
  );
  assert.equal(verified.status, "verified");
  await database.db
    .update(mediaAsset)
    .set({ cleanupAfter: new Date(Date.now() - 1000) })
    .where(eq(mediaAsset.id, reference.id));
  const eligible = await getMediaAsset(
    database.db,
    ids.workspace,
    reference.id,
  );
  assert(eligible);

  let releaseAttachment: (() => void) | undefined;
  let attachmentLockedResolve: (() => void) | undefined;
  const attachmentLocked = new Promise<void>((resolve) => {
    attachmentLockedResolve = resolve;
  });
  const attachmentRelease = new Promise<void>((resolve) => {
    releaseAttachment = resolve;
  });
  const attaching = database.db.transaction(async (tx) => {
    const [locked] = await tx
      .select()
      .from(mediaAsset)
      .where(
        and(
          eq(mediaAsset.workspaceId, ids.workspace),
          eq(mediaAsset.id, reference.id),
        ),
      )
      .for("update");
    assert.equal(locked?.lifecycle, "verified");
    attachmentLockedResolve?.();
    await attachmentRelease;
    await tx.insert(imageGeneration).values({
      operationId: ids.imageOperation,
      workspaceId: ids.workspace,
      draftRevisionId: ids.revision,
      modelOptionKey: "probe",
      referenceMediaAssetId: reference.id,
    });
    await tx
      .update(mediaAsset)
      .set({ cleanupAfter: null, version: (locked?.version ?? 0) + 1 })
      .where(eq(mediaAsset.id, reference.id));
  });
  await attachmentLocked;
  const cleaning = cleanupMediaAsset(
    database.db,
    storage,
    ids.workspace,
    eligible,
  );
  releaseAttachment?.();
  await attaching;
  assert.equal((await cleaning).status, "attached");
  assert(storage.objects.has(reference.objectKey));
  observed.push("attach-cleanup-row-lock");

  const cleanupWinner = await createUploaded({ bytes: await paddedPng(4096) });
  assert.equal(
    (
      await verifyMediaUpload(
        database.db,
        storage,
        ids.workspace,
        cleanupWinner.id,
      )
    ).status,
    "verified",
  );
  const cleanupWinnerRow = await getMediaAsset(
    database.db,
    ids.workspace,
    cleanupWinner.id,
  );
  assert(cleanupWinnerRow);
  await database.db
    .update(mediaAsset)
    .set({ cleanupAfter: new Date(Date.now() - 1000) })
    .where(eq(mediaAsset.id, cleanupWinner.id));
  const refreshedWinner = await getMediaAsset(
    database.db,
    ids.workspace,
    cleanupWinner.id,
  );
  assert(refreshedWinner);
  assert.equal(
    (
      await cleanupMediaAsset(
        database.db,
        storage,
        ids.workspace,
        refreshedWinner,
      )
    ).status,
    "removed",
  );
  const removed = await getMediaAsset(
    database.db,
    ids.workspace,
    cleanupWinner.id,
  );
  assert.equal(removed?.lifecycle, "expired");
  assert(removed?.objectRemovedAt);

  const adoptable = await createUploaded({
    bytes: await paddedPng(4096),
    kind: "image",
  });
  assert.equal(
    (await verifyMediaUpload(database.db, storage, ids.workspace, adoptable.id))
      .status,
    "verified",
  );
  assert(
    (await getMediaAsset(database.db, ids.workspace, adoptable.id))
      ?.cleanupAfter,
  );
  const adopted = await executeDraftRevisionCommand(
    database.db,
    ids.workspace,
    {
      actorId: ids.actor,
      commandKind: "adopt_image",
      expectedActive: { id: ids.revision, version: 1 },
      expectedImageIntentVersion: 0,
      finalMediaAssetId: adoptable.id,
      idempotencyKey: `media-probe-adopt-${adoptable.id}`,
      platformDraftId: ids.draft,
      requestHash: `media-probe-adopt-${adoptable.id}`,
    },
  );
  assert.equal(adopted.status, "updated");
  assert(
    "revision" in adopted &&
      adopted.revision.selectedFinalMediaAssetId === adoptable.id,
  );
  const adoptedRow = await getMediaAsset(
    database.db,
    ids.workspace,
    adoptable.id,
  );
  assert.equal(adoptedRow?.cleanupAfter, null);

  await database.db
    .update(mediaAsset)
    .set({ cleanupAfter: new Date(Date.now() - 1000) })
    .where(eq(mediaAsset.id, adoptable.id));
  const staleDeadline = await getMediaAsset(
    database.db,
    ids.workspace,
    adoptable.id,
  );
  assert(staleDeadline);
  assert.equal(
    (
      await cleanupMediaAsset(
        database.db,
        storage,
        ids.workspace,
        staleDeadline,
      )
    ).status,
    "attached",
  );
  assert(storage.objects.has(adoptable.objectKey));
  await database.db
    .update(mediaAsset)
    .set({ cleanupAfter: null })
    .where(eq(mediaAsset.id, adoptable.id));
  observed.push("adopt-clears-expiry", "attached-image-cleanup-fenced");
}

async function proveReconciliation() {
  const id = randomUUID();
  const objectKey = `${ids.workspace}/uploads/${id}`;
  const bytes = await paddedPng(4096);
  await storage.put(objectKey, bytes, "image/png");
  await createMediaUploadIntent(database.db, ids.workspace, {
    id,
    objectKey,
    kind: REFERENCE_IMAGE_KIND,
    mimeType: "image/png",
    declaredBytes: bytes.byteLength,
    checksum: digest(bytes),
    uploadExpiresAt: new Date(Date.now() - 1000),
  });
  createdMediaIds.push(id);
  const orphanKey = `${ids.workspace}/uploads/${randomUUID()}`;
  await storage.put(orphanKey, bytes, "image/png");
  const orphan = storage.objects.get(orphanKey);
  if (orphan) orphan.lastModified = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const result = await reconcileStorage(database.db, storage, ids.workspace, {
    now: new Date(),
  });
  assert(result.candidatesObserved > 0);
  assert.equal(storage.objects.has(objectKey), false);
  assert.equal(storage.objects.has(orphanKey), false);
  observed.push("cleanup-reconciliation");
}

async function proveReconciliationListRetry() {
  const objectCursor = `${ids.workspace}/uploads/${randomUUID()}`;
  const cursor = Buffer.from(
    JSON.stringify({ db: null, market: null, objects: objectCursor }),
  ).toString("base64url");
  const initialListCalls = storage.listCalls;
  storage.transientListFailures = 1;
  await assert.rejects(
    reconcileStorage(database.db, storage, ids.workspace, {
      cursor,
      now: new Date(),
    }),
    /transient storage list failure/,
  );
  const retried = await reconcileStorage(database.db, storage, ids.workspace, {
    cursor,
    now: new Date(),
  });
  assert.equal(storage.listCalls - initialListCalls, 2);
  assert.deepEqual(storage.listCursors.slice(-2), [objectCursor, objectCursor]);
  assert.equal(retried.nextCursor, undefined);
  observed.push("storage-list-failure-retried-with-same-cursor");
}

async function proveCommitUncertainty() {
  const committedId = createdMediaIds[0];
  assert(committedId);
  const committed = await getMediaAsset(
    database.db,
    ids.workspace,
    committedId,
  );
  assert(committed);
  const committedOwnership = await resolveMediaAssetObjectOwnership(
    database.db,
    ids.workspace,
    committed.objectKey,
  );
  assert.equal(committedOwnership.status, "committed");
  assert(storage.objects.has(committed.objectKey));

  const absentKey = `${ids.workspace}/uploads/${randomUUID()}`;
  await storage.put(absentKey, Buffer.alloc(1), "image/png");
  const absentOwnership = await resolveMediaAssetObjectOwnership(
    database.db,
    ids.workspace,
    absentKey,
  );
  assert.equal(absentOwnership.status, "absent");
  await storage.delete([absentKey]);
  assert.equal(storage.deleted.at(-1), absentKey);

  const uncertainKey = `${ids.workspace}/uploads/${randomUUID()}`;
  await storage.put(uncertainKey, Buffer.alloc(1), "image/png");
  const unavailable = createDb(databaseUrl, { max: 1 });
  await unavailable.close();
  const uncertainOwnership = await resolveMediaAssetObjectOwnership(
    unavailable.db,
    ids.workspace,
    uncertainKey,
  );
  assert.deepEqual(uncertainOwnership, {
    status: "uncertain",
    objectKey: uncertainKey,
  });
  assert(storage.objects.has(uncertainKey));
  observed.push(
    "committed-ack-lost-retained",
    "proven-absence-compensated",
    "uncertain-read-retained-opaque-key",
  );
}

async function insertFixture() {
  const statements = [
    sql`insert into "user" (id, name, email, email_verified, created_at, updated_at)
        values (${ids.actor}, 'Media Probe', ${`${ids.actor}@example.invalid`}, true, now(), now())`,
    sql`insert into workspace (id, name, created_at, updated_at)
        values (${ids.workspace}, ${`Media Probe ${ids.workspace}`}, now(), now())`,
    sql`insert into media_brand
      (id, workspace_id, key, name, sort_order, created_at, updated_at)
        values (${ids.brand}, ${ids.workspace}, 'media-probe', 'Media Probe', 1, now(), now())`,
    sql`insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash,
       lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
        values (${ids.analysisOperation}, ${ids.workspace}, ${ids.actor},
          'media-probe-analysis', 'analysis', 'analysis', 'succeeded', now(), 0, 1,
          now(), now())`,
    sql`insert into analysis_run
      (id, workspace_id, kind, operation_id, configuration,
       template_fingerprint, semantic_status, started_at, created_at, updated_at)
        values (${ids.analysisRun}, ${ids.workspace}, 'news', ${ids.analysisOperation},
          '{}'::jsonb, 'probe', 'skipped', now(), now(), now())`,
    sql`insert into analysis_model_unit
      (id, workspace_id, analysis_run_id, media_brand_id, model_option_key,
       task_key, status, created_at, updated_at)
        values (${ids.analysisUnit}, ${ids.workspace}, ${ids.analysisRun}, ${ids.brand},
          'probe', 'probe', 'pending', now(), now())`,
    sql`insert into promo_idea
      (id, workspace_id, analysis_model_unit_id, rank, title, description,
       angle, created_at, updated_at)
        values (${ids.promo}, ${ids.workspace}, ${ids.analysisUnit}, 1, 'Probe',
          'Probe', 'Probe', now(), now())`,
    sql`insert into platform_draft
      (id, workspace_id, media_brand_id, platform, promo_idea_id,
       lane_position, version, created_at, updated_at)
        values (${ids.draft}, ${ids.workspace}, ${ids.brand}, 'x', ${ids.promo}, 1, 1,
          now(), now())`,
    sql`insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash,
       lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
        values (${ids.copyGeneration}, ${ids.workspace}, ${ids.actor},
          'media-probe-copy', 'copy', 'copy', 'succeeded', now(), 0, 1, now(), now())`,
    sql`insert into copy_generation
      (operation_id, workspace_id, platform_draft_id, requested_content_locale,
       model_option_key, force_article_refresh, limited,
       customer_template_fingerprint, brand_policy_fingerprint, prompt_version,
       configuration_version, created_at, updated_at)
        values (${ids.copyGeneration}, ${ids.workspace}, ${ids.draft}, 'en', 'probe',
          false, false, 'probe', 'probe', 'probe', 'probe', now(), now())`,
    sql`insert into operation_attempt
      (id, workspace_id, operation_id, attempt_number, outcome, created_at, updated_at)
        values (${ids.copyAttempt}, ${ids.workspace}, ${ids.copyGeneration}, 1,
          'succeeded', now(), now())`,
    sql`insert into copy_generation_unit
      (id, workspace_id, copy_generation_id, variant_key, status,
       operation_attempt_id, created_at, updated_at)
        values (${ids.copyUnit}, ${ids.workspace}, ${ids.copyGeneration}, 'probe',
          'succeeded', ${ids.copyAttempt}, now(), now())`,
    sql`insert into copy_variant
      (id, workspace_id, copy_generation_unit_id, content_locale, headline,
       body, hashtags, created_at)
        values (${ids.copyVariant}, ${ids.workspace}, ${ids.copyUnit}, 'en', 'Probe',
          'Probe', array['#probe'], now())`,
    sql`insert into draft_revision
      (id, workspace_id, platform_draft_id, revision_number, content_locale,
       headline, body, hashtags, originating_copy_variant_id, authored_by,
       created_at)
        values (${ids.revision}, ${ids.workspace}, ${ids.draft}, 1, 'en', 'Probe',
          'Probe', array['#probe'], ${ids.copyVariant}, ${ids.actor}, now())`,
    sql`update platform_draft
      set active_revision_id = ${ids.revision}, revision_version = 1, updated_at = now()
      where id = ${ids.draft} and workspace_id = ${ids.workspace}`,
    sql`insert into operation
      (id, workspace_id, actor, command_type, idempotency_key, request_hash,
       lifecycle, effective_at, attempt_seq, version, created_at, updated_at)
        values (${ids.imageOperation}, ${ids.workspace}, ${ids.actor},
          'media-probe-image', 'image', 'image', 'queued', now(), 0, 1, now(), now())`,
  ];
  await database.db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(statement);
  });
}

async function cleanupFixture() {
  const statements = [
    sql`update platform_draft set active_revision_id = null
      where id = ${ids.draft} and workspace_id = ${ids.workspace}`,
    sql`delete from draft_revision_command_receipt
      where workspace_id = ${ids.workspace}`,
    sql`delete from image_generation where workspace_id = ${ids.workspace}`,
    sql`delete from draft_revision where workspace_id = ${ids.workspace}`,
    sql`delete from media_asset where workspace_id = ${ids.workspace}`,
    sql`delete from copy_variant where workspace_id = ${ids.workspace}`,
    sql`delete from copy_generation_unit where workspace_id = ${ids.workspace}`,
    sql`delete from operation_attempt where workspace_id = ${ids.workspace}`,
    sql`delete from copy_generation where workspace_id = ${ids.workspace}`,
    sql`delete from platform_draft where workspace_id = ${ids.workspace}`,
    sql`delete from promo_idea where workspace_id = ${ids.workspace}`,
    sql`delete from analysis_model_unit where workspace_id = ${ids.workspace}`,
    sql`delete from analysis_run where workspace_id = ${ids.workspace}`,
    sql`delete from operation where workspace_id = ${ids.workspace}`,
    sql`delete from media_brand where workspace_id = ${ids.workspace}`,
    sql`delete from workspace where id = ${ids.workspace}`,
    sql`delete from "user" where id = ${ids.actor}`,
  ];
  await database.db.transaction(async (tx) => {
    for (const statement of statements) await tx.execute(statement);
  });
}
