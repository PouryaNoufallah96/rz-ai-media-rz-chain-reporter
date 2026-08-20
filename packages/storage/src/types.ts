export interface StorageObjectStream {
  contentLength?: number;
  stream: ReadableStream<Uint8Array>;
}

export interface StorageObjectMetadata {
  contentType?: string;
  size: number;
}

export interface Storage {
  delete(keys: string[]): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<StorageObjectMetadata>;
  openRead(key: string): Promise<StorageObjectStream>;
  put(key: string, body: Uint8Array, contentType: string): Promise<void>;
}

export interface MinioStorageConfig {
  accessKeyId: string;
  bucket: string;
  endpoint: string;
  region: string;
  secretAccessKey: string;
}
