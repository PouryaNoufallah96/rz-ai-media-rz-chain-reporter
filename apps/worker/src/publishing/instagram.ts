import { randomBytes } from "node:crypto";
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
  unknownFailure,
} from "./port";

const instagramIdentifierSchema = z.string().trim().min(1).max(512);
const instagramStatusSchema = z.enum([
  "IN_PROGRESS",
  "FINISHED",
  "ERROR",
  "EXPIRED",
  "PUBLISHED",
]);

type InstagramCredential = {
  professionalAccountId: string;
  systemUserAccessToken: string;
};

type InstagramDependencies = {
  acceptGrant(grantId: string): Promise<void>;
  appUrl: string;
  credential: InstagramCredential;
  fetch: typeof fetch;
  issueGrant(
    request: PublishRequest,
    rawToken: string,
    expiresAt: Date,
  ): Promise<{ id: string }>;
  now?: () => number;
  request: PublishRequest;
  runtime: PublisherRuntime;
};

type ContainerStatusRead =
  | { status: z.infer<typeof instagramStatusSchema> }
  | { failure: ProviderFailure };

const GRAPH_ORIGIN = "https://graph.facebook.com";
const GRANT_LIFETIME_MS = 15 * 60_000;
const POLL_DELAYS_MS = [2_000, 2_000, 5_000, 5_000, 10_000] as const;
const MAX_POLL_DURATION_MS = 10 * 60_000;

export function createInstagramPublisher(
  input: InstagramDependencies,
): Publisher {
  const now = input.now ?? Date.now;
  const graphUrl = (path: string, query: Record<string, string>) => {
    const url = new URL(path, GRAPH_ORIGIN);
    if (url.origin !== GRAPH_ORIGIN) {
      throw new Error("INSTAGRAM_GRAPH_TARGET_INVALID");
    }
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    return url;
  };

  const readContainerStatus = async (
    containerId: string,
    callSite: string,
    attemptNumber: number,
  ): Promise<ContainerStatusRead> =>
    input.runtime.run(callSite, async (): Promise<ContainerStatusRead> => {
      const url = graphUrl(`/${containerId}`, {
        access_token: input.credential.systemUserAccessToken,
        fields: "status_code",
      });
      try {
        const response = await input.fetch(url);
        if (!response.ok) {
          return {
            failure: classifyInstagramFailure(
              response.status,
              "status",
              attemptNumber,
              response.headers,
              now(),
            ),
          } as const;
        }
        const status = projectStatus(await response.json());
        return status
          ? ({ status } as const)
          : ({
              failure: boundedRetry(
                unknownFailure(
                  "INSTAGRAM_CONTAINER_STATUS_UNKNOWN",
                  "provider",
                  "preparation_unknown",
                ),
                attemptNumber,
                now(),
              ),
            } as const);
      } catch (error) {
        return {
          failure: boundedRetry(
            unknownFailure(
              "INSTAGRAM_CONTAINER_STATUS_UNKNOWN",
              providerFailureClass(error),
              "preparation_unknown",
            ),
            attemptNumber,
            now(),
          ),
        } as const;
      }
    });

  return {
    platform: "instagram",
    async prepare(request) {
      const validation = await input.runtime.withMaterial(
        "instagram-validate-material",
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
      if (validation.status !== "ready" || !validation.hasMedia) {
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
      const knownContainer = await input.runtime.existingCheckpoint(
        request,
        "instagram_container",
      );
      if (knownContainer) {
        return {
          status: "prepared",
          prepared: {
            attempt,
            checkpoints: [knownContainer],
            containerId: knownContainer.providerReferenceId,
            platform: "instagram",
          },
        };
      }

      const capacity:
        | { status: "available" | "exhausted" }
        | { failure: ProviderFailure } = await input.runtime.run(
        "instagram-check-capacity",
        async () => {
          const url = graphUrl(
            `/${input.credential.professionalAccountId}/content_publishing_limit`,
            {
              access_token: input.credential.systemUserAccessToken,
              fields: "quota_usage,config",
            },
          );
          try {
            const response = await input.fetch(url);
            if (!response.ok) {
              return {
                failure: classifyInstagramFailure(
                  response.status,
                  "preparation",
                  attempt.number,
                  response.headers,
                  now(),
                ),
              };
            }
            const status = projectCapacity(await response.json());
            return status
              ? { status }
              : {
                  failure: boundedRetry(
                    unknownFailure(
                      "INSTAGRAM_CAPACITY_UNAVAILABLE",
                      "provider",
                      "preparation_unknown",
                    ),
                    attempt.number,
                    now(),
                  ),
                };
          } catch (error) {
            return {
              failure: boundedRetry(
                unknownFailure(
                  "INSTAGRAM_CAPACITY_UNAVAILABLE",
                  providerFailureClass(error),
                  "preparation_unknown",
                ),
                attempt.number,
                now(),
              ),
            };
          }
        },
      );
      if ("failure" in capacity) {
        return {
          status: "failed",
          attemptId: attempt.id,
          failure: capacity.failure,
        };
      }
      if (capacity.status === "exhausted") {
        return {
          status: "failed",
          attemptId: attempt.id,
          failure: boundedRetry(
            definiteFailure(
              "INSTAGRAM_RATE_LIMITED",
              "rate",
              "preparation",
              "retry_after_provider_time",
            ),
            attempt.number,
            now(),
          ),
        };
      }

      const container:
        | { grantId: string; id: string }
        | { failure: ProviderFailure } = await input.runtime.withMaterial(
        "instagram-prepare-container",
        async (material) => {
          const assembled = assemblePublishPayload({
            contentLocale: material.contentLocale,
            draft: material.draft,
            hasMedia: material.media !== null,
            platform: material.platform,
            source: material.source,
          });
          if (assembled.status !== "ready" || material.media === null) {
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
          const rawGrant = randomBytes(32).toString("base64url");
          const grant = await input.issueGrant(
            request,
            rawGrant,
            new Date(now() + GRANT_LIFETIME_MS),
          );
          const imageUrl = new URL(
            `/api/publishing-media/${rawGrant}`,
            input.appUrl,
          ).toString();
          const url = graphUrl(
            `/${input.credential.professionalAccountId}/media`,
            {
              access_token: input.credential.systemUserAccessToken,
              caption: assembled.text,
              image_url: imageUrl,
            },
          );
          try {
            const response = await input.fetch(url, { method: "POST" });
            if (!response.ok) {
              return {
                failure: classifyInstagramFailure(
                  response.status,
                  "preparation",
                  attempt.number,
                  response.headers,
                  now(),
                ),
              };
            }
            const id = projectIdentifier(await response.json(), "id");
            return id
              ? { grantId: grant.id, id }
              : {
                  failure: boundedRetry(
                    unknownFailure(
                      "INSTAGRAM_CONTAINER_PREPARATION_UNKNOWN",
                      "provider",
                      "preparation_unknown",
                    ),
                    attempt.number,
                    now(),
                  ),
                };
          } catch (error) {
            return {
              failure: boundedRetry(
                unknownFailure(
                  "INSTAGRAM_CONTAINER_PREPARATION_UNKNOWN",
                  providerFailureClass(error),
                  "preparation_unknown",
                ),
                attempt.number,
                now(),
              ),
            };
          }
        },
      );
      if ("failure" in container) {
        return {
          status: "failed",
          attemptId: attempt.id,
          failure: container.failure,
        };
      }
      await input.runtime.run("instagram-accept-media-grant", () =>
        input.acceptGrant(container.grantId),
      );
      return {
        status: "prepared",
        prepared: {
          attempt,
          checkpoints: [
            {
              kind: "instagram_grant",
              providerReferenceId: container.grantId,
            },
            {
              kind: "instagram_container",
              providerReferenceId: container.id,
            },
          ],
          containerId: container.id,
          platform: "instagram",
        },
      };
    },
    async publish(prepared) {
      if (prepared.platform !== "instagram") {
        throw new Error("INSTAGRAM_PREPARED_PAYLOAD_INVALID");
      }
      const pollDeadline = await input.runtime.run(
        "instagram-poll-deadline",
        async () => now() + MAX_POLL_DURATION_MS,
      );
      let pass = 0;
      let statusRead = await readContainerStatus(
        prepared.containerId,
        "instagram-read-container-initial",
        prepared.attempt.number,
      );
      while (
        ("status" in statusRead && statusRead.status === "IN_PROGRESS") ||
        ("failure" in statusRead &&
          statusRead.failure.next !== "operator_repair")
      ) {
        const remainingMs = pollDeadline - now();
        const delayMs = Math.min(
          POLL_DELAYS_MS[Math.min(pass, POLL_DELAYS_MS.length - 1)] ?? 10_000,
          Math.floor(remainingMs / 1_000) * 1_000,
        );
        if (delayMs <= 0) break;
        await input.runtime.sleep(`${delayMs}ms`);
        await input.runtime.renewLease();
        pass += 1;
        statusRead = await readContainerStatus(
          prepared.containerId,
          `instagram-read-container-${pass}`,
          prepared.attempt.number,
        );
      }
      if (
        ("status" in statusRead && statusRead.status === "IN_PROGRESS") ||
        "failure" in statusRead
      ) {
        return failed(
          prepared.attempt.id,
          "failure" in statusRead
            ? statusRead.failure
            : boundedRetry(
                definiteFailure(
                  "INSTAGRAM_CONTAINER_PROCESSING_DELAYED",
                  "provider",
                  "preparation",
                  "retry_preparation",
                ),
                prepared.attempt.number,
                now(),
              ),
        );
      }
      if (statusRead.status === "PUBLISHED") {
        return {
          status: "confirmed",
          attemptId: prepared.attempt.id,
          checkpoint: {
            kind: "instagram_media",
            providerReferenceId: prepared.containerId,
          },
          providerResultId: prepared.containerId,
        };
      }
      if (statusRead.status !== "FINISHED") {
        return failed(
          prepared.attempt.id,
          definiteFailure(
            statusRead.status === "EXPIRED"
              ? "INSTAGRAM_CONTAINER_EXPIRED"
              : "INSTAGRAM_CONTAINER_FAILED",
            "provider",
            "preparation",
          ),
        );
      }
      return input.runtime.run("instagram-final-effect", async () => {
        const url = graphUrl(
          `/${input.credential.professionalAccountId}/media_publish`,
          {
            access_token: input.credential.systemUserAccessToken,
            creation_id: prepared.containerId,
          },
        );
        if (!(await input.runtime.claimFinalEffect(prepared.attempt.id))) {
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "INSTAGRAM_DELIVERY_UNKNOWN",
              "transport",
              "delivery_unknown",
            ),
          );
        }
        try {
          const response = await input.fetch(url, { method: "POST" });
          if (!response.ok) {
            return failed(
              prepared.attempt.id,
              classifyInstagramFailure(
                response.status,
                "publication",
                prepared.attempt.number,
                response.headers,
                now(),
              ),
            );
          }
          const id = projectIdentifier(await response.json(), "id");
          if (!id) {
            return failed(
              prepared.attempt.id,
              unknownFailure(
                "INSTAGRAM_DELIVERY_UNKNOWN",
                "provider",
                "delivery_unknown",
              ),
            );
          }
          return {
            status: "confirmed",
            attemptId: prepared.attempt.id,
            checkpoint: { kind: "instagram_media", providerReferenceId: id },
            providerResultId: id,
          } satisfies PublishResult;
        } catch (error) {
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "INSTAGRAM_DELIVERY_UNKNOWN",
              providerFailureClass(error),
              "delivery_unknown",
            ),
          );
        }
      });
    },
    async reconcile(checkpoint) {
      if (checkpoint?.kind === "instagram_media") {
        return {
          status: "delivered",
          checkpoint,
          providerResultId: checkpoint.providerReferenceId,
        };
      }
      if (checkpoint?.kind !== "instagram_container") {
        return { status: "still_unknown" };
      }
      const status = await readContainerStatus(
        checkpoint.providerReferenceId,
        "instagram-reconcile-container",
        1,
      );
      if ("failure" in status) {
        return { status: "failed", failure: status.failure };
      }
      if (status.status === "PUBLISHED") {
        return {
          status: "delivered",
          checkpoint,
          providerResultId: checkpoint.providerReferenceId,
        };
      }
      return status.status === "ERROR" || status.status === "EXPIRED"
        ? { status: "not_delivered" }
        : { status: "still_unknown" };
    },
  };
}

function classifyInstagramFailure(
  status: number,
  scope: "preparation" | "publication" | "status",
  attemptNumber: number,
  headers?: Headers,
  now = Date.now(),
): ProviderFailure {
  const finalEffect = scope === "publication";
  const effectScope = finalEffect ? "publication" : "preparation";
  if (status === 400) {
    return definiteFailure("INSTAGRAM_REQUEST_INVALID", "invalid", effectScope);
  }
  if (status === 401) {
    return definiteFailure("INSTAGRAM_AUTH_FAILED", "auth", effectScope);
  }
  if (status === 403) {
    return definiteFailure(
      "INSTAGRAM_CAPABILITY_UNAVAILABLE",
      "permanent",
      effectScope,
    );
  }
  if (status === 429) {
    return boundedRetry(
      definiteFailure(
        "INSTAGRAM_RATE_LIMITED",
        "rate",
        effectScope,
        "retry_after_provider_time",
      ),
      attemptNumber,
      now,
      retryDelayMs(headers, now),
    );
  }
  if (finalEffect) {
    return unknownFailure(
      "INSTAGRAM_DELIVERY_UNKNOWN",
      status >= 500 ? "provider" : "transport",
      "delivery_unknown",
    );
  }
  return boundedRetry(
    unknownFailure(
      scope === "status"
        ? "INSTAGRAM_CONTAINER_STATUS_UNKNOWN"
        : "INSTAGRAM_CONTAINER_PREPARATION_UNKNOWN",
      status >= 500 ? "provider" : "transport",
      "preparation_unknown",
    ),
    attemptNumber,
    now,
  );
}

function projectCapacity(body: unknown) {
  const data = objectValue(body)?.data;
  const first = Array.isArray(data) ? objectValue(data[0]) : null;
  const configuration = objectValue(first?.config);
  const usage = z.number().nonnegative().safeParse(first?.quota_usage).data;
  const total = z
    .number()
    .positive()
    .safeParse(configuration?.quota_total).data;
  if (usage === undefined || total === undefined) return null;
  return usage < total ? "available" : "exhausted";
}

function projectStatus(body: unknown) {
  return (
    instagramStatusSchema.safeParse(objectValue(body)?.status_code).data ?? null
  );
}

function projectIdentifier(body: unknown, key: string) {
  return instagramIdentifierSchema.safeParse(objectValue(body)?.[key]).data;
}

function retryDelayMs(headers: Headers | undefined, now: number) {
  const value = headers?.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}
