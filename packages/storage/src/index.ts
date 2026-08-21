import { createMinioStorage } from "./minio";
import type { MinioStorageConfig, Storage } from "./types";

export { createMinioStorage } from "./minio";
export type {
  MinioStorageConfig,
  Storage,
  StorageObjectListPage,
  StorageObjectMetadata,
  StorageObjectStream,
} from "./types";

export class ObjectStoreUnboundError extends Error {
  readonly code = "OBJECT_STORE_UNBOUND";

  constructor() {
    super("OBJECT_STORE_UNBOUND");
    this.name = "ObjectStoreUnboundError";
  }
}

export type StorageBindings = {
  S3_ACCESS_KEY_ID?: string;
  S3_BUCKET?: string;
  S3_ENDPOINT?: string;
  S3_REGION?: string;
  S3_SECRET_ACCESS_KEY?: string;
};

let storage: Storage | undefined;
let storageKey: string | undefined;

// Bindings are process-wide, so the client is memoized on the exact values it
// was built from rather than on first call.
export function storageFromBindings(bindings: StorageBindings): Storage {
  const {
    S3_ACCESS_KEY_ID,
    S3_BUCKET,
    S3_ENDPOINT,
    S3_REGION,
    S3_SECRET_ACCESS_KEY,
  } = bindings;
  if (
    !S3_ACCESS_KEY_ID ||
    !S3_BUCKET ||
    !S3_ENDPOINT ||
    !S3_REGION ||
    !S3_SECRET_ACCESS_KEY
  ) {
    throw new ObjectStoreUnboundError();
  }

  const config: MinioStorageConfig = {
    accessKeyId: S3_ACCESS_KEY_ID,
    bucket: S3_BUCKET,
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    secretAccessKey: S3_SECRET_ACCESS_KEY,
  };
  const key = `${S3_ENDPOINT}/${S3_BUCKET}/${S3_REGION}/${S3_ACCESS_KEY_ID}`;
  if (!storage || storageKey !== key) {
    storage = createMinioStorage(config);
    storageKey = key;
  }
  return storage;
}
