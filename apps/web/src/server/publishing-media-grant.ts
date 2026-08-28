import { hashPublishingMediaGrant } from "@rz-chain-reporter/db/repositories/publishing-media-grant";
import type { StorageObjectStream } from "@rz-chain-reporter/storage";

const GRANT_TOKEN = /^[A-Za-z0-9_-]{43}$/;

type GrantedAsset = {
  actualBytes: number | null;
  mimeType: string;
  objectKey: string;
};

export type PublishingMediaGrantDependencies = {
  findGrant: (
    tokenHash: string,
    now: Date,
  ) => Promise<{ asset: GrantedAsset } | null>;
  now: () => Date;
  openRead: (objectKey: string) => Promise<StorageObjectStream | null>;
};

export async function streamPublishingMediaGrant(
  rawGrant: string,
  dependencies: PublishingMediaGrantDependencies,
) {
  if (!GRANT_TOKEN.test(rawGrant)) return grantNotFound();

  const found = await dependencies.findGrant(
    hashPublishingMediaGrant(rawGrant),
    dependencies.now(),
  );
  if (!found || found.asset.actualBytes === null) return grantNotFound();

  const opened = await dependencies.openRead(found.asset.objectKey);
  if (!opened) return grantNotFound();
  if (
    opened.contentLength !== undefined &&
    opened.contentLength !== found.asset.actualBytes
  ) {
    await opened.stream.cancel();
    return grantNotFound();
  }

  return new Response(opened.stream, {
    headers: {
      "cache-control": "no-store, max-age=0",
      "content-length": String(found.asset.actualBytes),
      "content-type": found.asset.mimeType,
      "x-content-type-options": "nosniff",
    },
  });
}

function grantNotFound() {
  return new Response(null, {
    status: 404,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
