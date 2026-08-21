import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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
    async list(input) {
      if (
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      ) {
        throw new Error("Storage list limit must be between 1 and 100");
      }
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: input.cursor,
          MaxKeys: input.limit,
          Prefix: input.prefix,
        }),
      );
      return {
        items: (result.Contents ?? []).flatMap((item) =>
          item.Key !== undefined &&
          item.LastModified !== undefined &&
          item.Size !== undefined
            ? [
                {
                  key: item.Key,
                  lastModified: item.LastModified,
                  size: item.Size,
                },
              ]
            : [],
        ),
        nextCursor: result.NextContinuationToken,
      };
    },
    async delete(keys) {
      if (keys.length === 0) {
        return;
      }
      const result = await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: keys.map((key) => ({ Key: key })) },
        }),
      );
      if (result.Errors && result.Errors.length > 0) {
        throw new Error("Storage failed to delete one or more objects");
      }
    },
  };
}
