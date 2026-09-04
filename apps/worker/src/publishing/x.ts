import { createHmac, randomBytes } from "node:crypto";
import { assemblePublishPayload } from "@rz-chain-reporter/contracts";
import { z } from "zod";

import {
  boundedRetry,
  definiteFailure,
  failed,
  objectValue,
  type ProviderFailure,
  type Publisher,
  type PublisherRuntime,
  type PublishRequest,
  type PublishResult,
  providerFailureClass,
  type ReconciliationReference,
  unknownFailure,
} from "./port";
import { publishRasterForUpload } from "./publish-raster";

const xIdentifierSchema = z.string().trim().min(1).max(512);

type XCredential = {
  accessToken: string;
  accessTokenSecret: string;
  applicationKey: string;
  applicationSecret: string;
};

type XDependencies = {
  credential: XCredential;
  fetch: typeof fetch;
  reconciliationReference?: ReconciliationReference;
  request: PublishRequest;
  runtime: PublisherRuntime;
  nonce?: () => string;
  nowSeconds?: () => number;
};

const X_MEDIA_UPLOAD_URL = "https://upload.twitter.com/1.1/media/upload.json";
const X_POST_URL = "https://api.x.com/2/tweets";

export function createXPublisher(input: XDependencies): Publisher {
  const nonce = input.nonce ?? (() => randomBytes(16).toString("hex"));
  const nowSeconds = input.nowSeconds ?? (() => Math.floor(Date.now() / 1_000));
  const authorization = (method: string, url: string) =>
    oauthAuthorization(method, url, input.credential, nonce(), nowSeconds());

  return {
    platform: "x",
    async prepare(request) {
      const validation = await input.runtime.withMaterial(
        "x-validate-material",
        async (material) => ({
          hasMedia: material.media !== null,
          status: assemblePublishPayload({
            contentLocale: material.contentLocale,
            draft: material.draft,
            hasMedia: material.media !== null,
            platform: material.platform,
            source: material.source,
          }).status,
        }),
      );
      if (validation.status !== "ready") {
        return {
          status: "failed",
          attemptId: null,
          failure: definiteFailure(
            validation.status === "overflow"
              ? "PUBLISH_PAYLOAD_TOO_LONG"
              : "MEDIA_NOT_PUBLISHABLE",
            "invalid",
            "preparation",
            "none",
          ),
        };
      }

      const attempt = await input.runtime.beginAttempt(request);
      const prior = await input.runtime.existingCheckpoint(request, "x_media");
      if (prior) {
        return {
          status: "prepared",
          prepared: {
            attempt,
            checkpoints: [prior],
            mediaId: prior.providerReferenceId,
            platform: "x",
          },
        };
      }
      if (!validation.hasMedia) {
        return {
          status: "prepared",
          prepared: {
            attempt,
            checkpoints: [],
            mediaId: null,
            platform: "x",
          },
        };
      }

      const upload: { mediaId: string } | { failure: ProviderFailure } =
        await input.runtime.withMaterial("x-upload-media", async (material) => {
          if (!material.media) {
            return {
              failure: definiteFailure(
                "MEDIA_NOT_PUBLISHABLE",
                "invalid",
                "preparation",
                "none",
              ),
            };
          }
          let media: Uint8Array<ArrayBuffer>;
          try {
            media = await input.runtime.readMedia(material.media.objectKey);
          } catch (error) {
            return {
              failure: boundedRetry(
                definiteFailure(
                  "MEDIA_NOT_PUBLISHABLE",
                  providerFailureClass(error),
                  "preparation",
                  "retry_preparation",
                ),
                attempt.number,
                Date.now(),
              ),
            };
          }
          const raster = await publishRasterForUpload(
            media,
            material.media.mimeType,
          );
          if (!raster) {
            return {
              failure: definiteFailure(
                "MEDIA_NOT_PUBLISHABLE",
                "invalid",
                "preparation",
                "none",
              ),
            };
          }
          const form = new FormData();
          form.set(
            "media",
            new Blob([raster.bytes], { type: raster.mimeType }),
          );
          try {
            const response = await input.fetch(X_MEDIA_UPLOAD_URL, {
              body: form,
              headers: {
                authorization: authorization("POST", X_MEDIA_UPLOAD_URL),
              },
              method: "POST",
            });
            const body = await response.json().catch(() => null);
            if (!response.ok) {
              return {
                failure: classifyXFailure(
                  response.status,
                  "preparation",
                  attempt.number,
                  response.headers,
                ),
              };
            }
            const projected = projectIdentifier(body, "media_id_string");
            return projected
              ? { mediaId: projected }
              : {
                  failure: boundedRetry(
                    unknownFailure(
                      "X_MEDIA_PREPARATION_UNKNOWN",
                      "provider",
                      "preparation_unknown",
                    ),
                    attempt.number,
                    Date.now(),
                  ),
                };
          } catch (error) {
            return {
              failure: boundedRetry(
                unknownFailure(
                  "X_MEDIA_PREPARATION_UNKNOWN",
                  providerFailureClass(error),
                  "preparation_unknown",
                ),
                attempt.number,
                Date.now(),
              ),
            };
          }
        });
      if ("failure" in upload) {
        return {
          status: "failed",
          attemptId: attempt.id,
          failure: upload.failure,
        };
      }
      const checkpoint = {
        kind: "x_media" as const,
        providerReferenceId: upload.mediaId,
      };
      return {
        status: "prepared",
        prepared: {
          attempt,
          checkpoints: [checkpoint],
          mediaId: upload.mediaId,
          platform: "x",
        },
      };
    },
    async publish(prepared) {
      if (prepared.platform !== "x") {
        throw new Error("X_PREPARED_PAYLOAD_INVALID");
      }
      return input.runtime.withMaterial("x-final-effect", async (material) => {
        const assembled = assemblePublishPayload({
          contentLocale: material.contentLocale,
          draft: material.draft,
          hasMedia: material.media !== null,
          platform: material.platform,
          source: material.source,
        });
        if (assembled.status !== "ready") {
          return failed(
            prepared.attempt.id,
            definiteFailure(
              assembled.status === "overflow"
                ? "PUBLISH_PAYLOAD_TOO_LONG"
                : "MEDIA_NOT_PUBLISHABLE",
              "invalid",
              "publication",
              "none",
            ),
          );
        }
        if (!(await input.runtime.claimFinalEffect(prepared.attempt.id))) {
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "X_DELIVERY_UNKNOWN",
              "transport",
              "delivery_unknown",
            ),
          );
        }
        try {
          const response = await input.fetch(X_POST_URL, {
            body: JSON.stringify({
              text: assembled.text,
              ...(prepared.mediaId
                ? { media: { media_ids: [prepared.mediaId] } }
                : {}),
            }),
            headers: {
              authorization: authorization("POST", X_POST_URL),
              "content-type": "application/json",
            },
            method: "POST",
          });
          const body = await response.json().catch(() => null);
          if (!response.ok) {
            return failed(
              prepared.attempt.id,
              classifyXFailure(
                response.status,
                "publication",
                prepared.attempt.number,
                response.headers,
              ),
            );
          }
          const id = projectNestedIdentifier(body, "data", "id");
          if (!id) {
            return failed(
              prepared.attempt.id,
              unknownFailure(
                "X_DELIVERY_UNKNOWN",
                "provider",
                "delivery_unknown",
              ),
            );
          }
          return {
            status: "confirmed",
            attemptId: prepared.attempt.id,
            checkpoint: { kind: "x_post", providerReferenceId: id },
            providerResultId: id,
          } satisfies PublishResult;
        } catch (error) {
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "X_DELIVERY_UNKNOWN",
              providerFailureClass(error),
              "delivery_unknown",
            ),
          );
        }
      });
    },
    async reconcile(checkpoint) {
      if (checkpoint?.kind === "x_post") {
        return {
          status: "delivered",
          checkpoint,
          providerResultId: checkpoint.providerReferenceId,
        };
      }
      if (!input.reconciliationReference) return { status: "still_unknown" };
      const meUrl = "https://api.x.com/2/users/me";
      const me = await input.runtime.run<
        { id: string } | { failure: ProviderFailure }
      >("x-reconcile-account", async () => {
        try {
          const response = await input.fetch(meUrl, {
            headers: { authorization: authorization("GET", meUrl) },
          });
          if (!response.ok) {
            return {
              failure: classifyXReconciliationFailure(
                response.status,
                response.headers,
              ),
            } as const;
          }
          const id = projectNestedIdentifier(
            await response.json(),
            "data",
            "id",
          );
          return id
            ? { id }
            : { failure: xReconciliationReadFailure("provider") };
        } catch (error) {
          return {
            failure: xReconciliationReadFailure(providerFailureClass(error)),
          };
        }
      });
      if ("failure" in me) return { status: "failed", failure: me.failure };
      const timelineUrl = `https://api.x.com/2/users/${encodeURIComponent(me.id)}/tweets?max_results=10&tweet.fields=created_at`;
      const decision = await input.runtime.withMaterial<
        { candidate: string | null } | { failure: ProviderFailure }
      >("x-reconcile-timeline", async (material) => {
        const assembled = assemblePublishPayload({
          contentLocale: material.contentLocale,
          draft: material.draft,
          hasMedia: material.media !== null,
          platform: material.platform,
          source: material.source,
        });
        if (assembled.status !== "ready") {
          return {
            failure: definiteFailure(
              assembled.status === "overflow"
                ? "PUBLISH_PAYLOAD_TOO_LONG"
                : "MEDIA_NOT_PUBLISHABLE",
              "invalid",
              "preparation",
              "none",
            ),
          };
        }
        try {
          const response = await input.fetch(timelineUrl, {
            headers: { authorization: authorization("GET", timelineUrl) },
          });
          if (!response.ok) {
            return {
              failure: classifyXReconciliationFailure(
                response.status,
                response.headers,
              ),
            };
          }
          const candidates = projectTimeline(await response.json());
          return candidates
            ? {
                candidate: exactRecentTimelineCandidate(
                  assembled.text,
                  candidates,
                  input.reconciliationReference?.notBefore ?? new Date(0),
                ),
              }
            : { failure: xReconciliationReadFailure("provider") };
        } catch (error) {
          return {
            failure: xReconciliationReadFailure(providerFailureClass(error)),
          };
        }
      });
      if ("failure" in decision) {
        return { status: "failed", failure: decision.failure };
      }
      if (!decision.candidate) return { status: "still_unknown" };
      return {
        status: "delivered",
        checkpoint: {
          kind: "x_post",
          providerReferenceId: decision.candidate,
        },
        providerResultId: decision.candidate,
      };
    },
  };
}

export function classifyXFailure(
  status: number,
  scope: "preparation" | "publication",
  attemptNumber = 1,
  headers?: Headers,
  now = Date.now(),
): ProviderFailure {
  if (status === 400 || status === 422) {
    return definiteFailure("X_REQUEST_INVALID", "invalid", scope);
  }
  if (status === 401) {
    return definiteFailure("X_AUTH_FAILED", "auth", scope);
  }
  if (status === 402 || status === 403) {
    return definiteFailure("X_CAPABILITY_UNAVAILABLE", "permanent", scope);
  }
  if (status === 429) {
    return boundedRetry(
      definiteFailure(
        "X_RATE_LIMITED",
        "rate",
        scope,
        "retry_after_provider_time",
      ),
      attemptNumber,
      now,
      retryDelayMs(headers, now),
    );
  }
  if (status >= 300 && status < 500) {
    return definiteFailure("X_REQUEST_INVALID", "invalid", scope);
  }
  const failure = unknownFailure(
    scope === "publication"
      ? "X_DELIVERY_UNKNOWN"
      : "X_MEDIA_PREPARATION_UNKNOWN",
    status >= 500 ? "provider" : "transport",
    scope === "publication" ? "delivery_unknown" : "preparation_unknown",
  );
  return scope === "preparation"
    ? boundedRetry(failure, attemptNumber, now)
    : failure;
}

export function exactRecentTimelineCandidate(
  expectedText: string,
  candidates: readonly {
    createdAt: string | null;
    id: string;
    text: string;
  }[],
  notBefore: Date,
) {
  const lowerBound = notBefore.getTime();
  if (!Number.isFinite(lowerBound)) return null;
  const exact = candidates.filter(
    (candidate) =>
      candidate.text === expectedText &&
      candidate.createdAt !== null &&
      Date.parse(candidate.createdAt) >= lowerBound,
  );
  return exact.length === 1 ? (exact[0]?.id ?? null) : null;
}

export function oauthAuthorization(
  method: string,
  url: string,
  credential: XCredential,
  nonce: string,
  timestamp: number,
) {
  const parsed = new URL(url);
  const parameters = new Map<string, string>([
    ["oauth_consumer_key", credential.applicationKey],
    ["oauth_nonce", nonce],
    ["oauth_signature_method", "HMAC-SHA1"],
    ["oauth_timestamp", String(timestamp)],
    ["oauth_token", credential.accessToken],
    ["oauth_version", "1.0"],
  ]);
  for (const [key, value] of parsed.searchParams) parameters.set(key, value);
  const normalized = [...parameters]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join("&");
  const baseUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const signatureBase = `${method.toUpperCase()}&${encode(baseUrl)}&${encode(normalized)}`;
  const signingKey = `${encode(credential.applicationSecret)}&${encode(credential.accessTokenSecret)}`;
  const signature = createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");
  const oauth = [...parameters]
    .filter(([key]) => key.startsWith("oauth_"))
    .concat([["oauth_signature", signature]])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(", ");
  return `OAuth ${oauth}`;
}

function encode(value: string) {
  return encodeURIComponent(value).replace(
    /[!'()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function projectIdentifier(body: unknown, key: string) {
  const value = objectValue(body)?.[key];
  return xIdentifierSchema.safeParse(value).data;
}

function projectNestedIdentifier(body: unknown, parent: string, key: string) {
  return projectIdentifier(objectValue(body)?.[parent], key);
}

function projectTimeline(body: unknown) {
  const value = objectValue(body);
  if (!value) return null;
  const data = value.data;
  if (data === undefined) {
    const resultCount = z
      .int()
      .nonnegative()
      .safeParse(objectValue(value.meta)?.result_count).data;
    return resultCount === 0 ? [] : null;
  }
  if (!Array.isArray(data)) return null;
  const candidates: { createdAt: string; id: string; text: string }[] = [];
  for (const entry of data) {
    const value = objectValue(entry);
    const createdAt = z.iso
      .datetime({ offset: true })
      .safeParse(value?.created_at).data;
    const id = xIdentifierSchema.safeParse(value?.id).data;
    const text = z.string().safeParse(value?.text).data;
    if (!(createdAt && id && text)) return null;
    candidates.push({ createdAt, id, text });
  }
  return candidates;
}

function classifyXReconciliationFailure(
  status: number,
  headers?: Headers,
): ProviderFailure {
  if (status === 400 || status === 422) {
    return definiteFailure("X_REQUEST_INVALID", "invalid", "preparation");
  }
  if (status === 401) {
    return definiteFailure("X_AUTH_FAILED", "auth", "preparation");
  }
  if (status === 402 || status === 403) {
    return definiteFailure(
      "X_CAPABILITY_UNAVAILABLE",
      "permanent",
      "preparation",
    );
  }
  if (status === 429) {
    const now = Date.now();
    return boundedRetry(
      definiteFailure(
        "X_RATE_LIMITED",
        "rate",
        "preparation",
        "retry_after_provider_time",
      ),
      1,
      now,
      retryDelayMs(headers, now),
    );
  }
  if (status >= 300 && status < 500) {
    return definiteFailure("X_REQUEST_INVALID", "invalid", "preparation");
  }
  return xReconciliationReadFailure(status >= 500 ? "provider" : "transport");
}

function xReconciliationReadFailure(
  failureClass: ProviderFailure["class"],
): ProviderFailure {
  return boundedRetry(
    unknownFailure("X_DELIVERY_UNKNOWN", failureClass, "delivery_unknown"),
    1,
    Date.now(),
  );
}

function retryDelayMs(headers: Headers | undefined, now: number) {
  if (!headers) return undefined;
  const retryAfter = headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(0, date - now);
  }
  const resetSeconds = Number(headers.get("x-rate-limit-reset"));
  return Number.isFinite(resetSeconds)
    ? Math.max(0, resetSeconds * 1_000 - now)
    : undefined;
}
