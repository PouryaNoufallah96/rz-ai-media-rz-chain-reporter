export interface StorageObjectStream {
  contentLength?: number;
  stream: ReadableStream<Uint8Array>;
}

export interface StorageObjectMetadata {
  contentType?: string;
  size: number;
}

export interface StorageObjectListPage {
  items: Array<{
    key: string;
    lastModified: Date;
    size: number;
  }>;
  nextCursor?: string;
}

export interface Storage {
  delete(keys: string[]): Promise<void>;
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
  head(key: string): Promise<StorageObjectMetadata>;
  list(input: {
    prefix: string;
    cursor?: string;
    limit: number;
  }): Promise<StorageObjectListPage>;
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
