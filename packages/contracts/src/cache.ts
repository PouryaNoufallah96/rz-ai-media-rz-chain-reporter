import { z } from "zod";

export const CACHE_INVALIDATION_PATH = "/api/internal/cache-invalidation";
export const CACHE_INVALIDATION_SIGNATURE_HEADER = "x-chainreporter-signature";
export const CACHE_INVALIDATION_TIMESTAMP_HEADER = "x-chainreporter-timestamp";
export const CACHE_INVALIDATION_MAX_SKEW_MS = 5 * 60_000;

export const WORKSPACE_CACHE_ENTITIES = [
  "installation",
  "sources",
  "usage",
  "editorial",
] as const;

export type WorkspaceCacheEntity = (typeof WORKSPACE_CACHE_ENTITIES)[number];

export function workspaceCacheTag(
  workspaceId: string,
  entity: WorkspaceCacheEntity,
) {
  return `workspace:${workspaceId}:${entity}` as const;
}

const MAX_CACHE_TAG_BYTES = 256;

const CACHE_TAG_PATTERN = /^[A-Za-z0-9][A-Za-z0-9:_.-]{0,255}$/;

const cacheTagSchema = z.string().regex(CACHE_TAG_PATTERN);

export const CACHE_INVALIDATION_MAX_TAGS = 64;

const TAG_JSON_OVERHEAD_BYTES = 16;
const REQUEST_ENVELOPE_BYTES = 64;

export const CACHE_INVALIDATION_MAX_BODY_BYTES =
  CACHE_INVALIDATION_MAX_TAGS *
    (MAX_CACHE_TAG_BYTES + TAG_JSON_OVERHEAD_BYTES) +
  REQUEST_ENVELOPE_BYTES;

export const cacheInvalidationRequestSchema = z.strictObject({
  tags: z.array(cacheTagSchema).min(1).max(CACHE_INVALIDATION_MAX_TAGS),
});

export type CacheInvalidationRequest = z.infer<
  typeof cacheInvalidationRequestSchema
>;

export const cacheInvalidationResponseSchema = z.strictObject({
  status: z.literal("accepted"),
  tags: z.array(
    z.strictObject({ tag: cacheTagSchema, revalidated: z.boolean() }),
  ),
});

export type CacheInvalidationResponse = z.infer<
  typeof cacheInvalidationResponseSchema
>;
