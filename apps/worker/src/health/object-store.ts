import { storageFromBindings } from "@rz-chain-reporter/storage";

import { workerEnv } from "../runtime/env";

const BUCKET_PROBE_TIMEOUT_MS = 3_000;

export class ObjectStoreUnreachableError extends Error {
  readonly code = "OBJECT_STORE_UNREACHABLE";

  constructor(cause?: unknown) {
    super("object store bucket is not reachable");
    this.name = "ObjectStoreUnreachableError";
    this.cause = cause;
  }
}

export async function checkObjectStoreReachable() {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ObjectStoreUnreachableError()),
      BUCKET_PROBE_TIMEOUT_MS,
    );
  });

  try {
    await Promise.race([
      storageFromBindings(workerEnv).list({ prefix: "", limit: 1 }),
      deadline,
    ]);
  } catch (error) {
    throw error instanceof ObjectStoreUnreachableError
      ? error
      : new ObjectStoreUnreachableError(error);
  } finally {
    clearTimeout(timer);
  }
}
