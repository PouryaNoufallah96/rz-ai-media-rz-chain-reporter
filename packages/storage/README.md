# `@rz-chain-reporter/storage`

The object-storage seam. One interface, one S3-compatible driver.

Framework-free — no `server-only`, so the web application and the worker both
import it.

## The interface

```ts
interface Storage {
  put(key, body, contentType): Promise<void>;
  head(key): Promise<StorageObjectMetadata>;
  openRead(key): Promise<StorageObjectStream>;
  list({ prefix, cursor, limit }): Promise<StorageObjectListPage>;
  delete(keys): Promise<void>;
  getSignedUrl(key, expiresInSeconds): Promise<string>;
}
```

**There is no presigned-upload variant.** The signed URL wraps a read only, so the
browser can be handed a read URL and never an upload URL. Uploads go through
authenticated application code.

## Behaviour worth knowing

**Reads stream.** `openRead` returns a web stream and never buffers, so a large
object does not sit in memory on its way to a response.

**Partial batch failures are detected.** A batch delete that reports any per-object
error throws rather than reporting success.

**A missing size or body throws** rather than returning something ambiguous.

**List limits are validated** — a non-integer or out-of-range limit is refused.

**Path-style addressing is fixed**, because the deployed store does not do
virtual-hosted-style addressing.

## Binding

The five environment values are read as a set. If any is missing,
`storageFromBindings` throws `ObjectStoreUnboundError` — a loud failure, never a
silent fallback. That error code is part of the shared error vocabulary, so
callers can declare it.

The client is memoised on **the exact values it was built from** rather than on
first call, so changed bindings correctly rebuild the client.

`isMissingStorageObject(error)` recognises the two error names the SDK raises for
a missing object, which is what lets a route return `404` instead of `500`.

## What this package deliberately does not do

**No key construction.** Every method takes the caller's key verbatim. Namespacing
is the consumer's responsibility, which keeps this package free of domain
knowledge.

**No checksums.** Verification — magic bytes, declared size, digest — happens in the
media verification pipeline where the lifecycle state lives, not in the driver.

**No bucket creation.** The bucket is provisioned by deployment, not by application
code.

## The probe

`scripts/storage-probe.ts` exercises the whole port against a real endpoint in one
lifecycle: put, head, open and drain, compare bytes, list, delete — with a
best-effort cleanup. It prints one JSON line per step and names the failing
operation on error.

Run it directly with the five storage variables set.

## Related

[`../../documentation/architecture/containers.md`](../../documentation/architecture/containers.md)
