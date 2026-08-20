import { createMinioStorage } from "./minio";
import type { MinioStorageConfig, Storage } from "./types";

export { createMinioStorage } from "./minio";
export type {
  MinioStorageConfig,
  Storage,
  StorageObjectMetadata,
  StorageObjectStream,
} from "./types";

let storage: Storage | undefined;

export function getStorage(config: MinioStorageConfig): Storage {
  storage ??= createMinioStorage(config);
  return storage;
}
