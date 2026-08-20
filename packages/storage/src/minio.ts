import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type { MinioStorageConfig, Storage } from "./types";

export function createMinioStorage(config: MinioStorageConfig): Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: true,
  });
  const bucket = config.bucket;

  return {
    async put(key, body, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
        }),
      );
    },
    getSignedUrl(key, expiresInSeconds) {
      return getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: key }),
        { expiresIn: expiresInSeconds },
      );
    },
    async openRead(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (!result.Body) {
        throw new Error(`Storage object ${key} returned no body`);
      }
      return {
        stream: result.Body.transformToWebStream(),
        contentLength: result.ContentLength,
      };
    },
    async head(key) {
      const result = await client.send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      if (result.ContentLength === undefined) {
        throw new Error(`Storage object ${key} reported no size`);
      }
      return { size: result.ContentLength, contentType: result.ContentType };
    },
    async delete(keys) {
      if (keys.length === 0) {
        return;
      }
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })) },
        }),
      );
    },
  };
}
