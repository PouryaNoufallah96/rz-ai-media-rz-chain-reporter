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
  type PublishResult,
  providerFailureClass,
  unknownFailure,
} from "./port";
import { publishRasterForUpload } from "./publish-raster";

const telegramSuccessSchema = z.strictObject({
  messageId: z.int(),
});

const telegramErrorSchema = z.strictObject({
  errorCode: z.int(),
  migrateToChatId: z.union([z.string(), z.number()]).optional(),
  retryAfter: z.int().positive().optional(),
});

type TelegramCredential = {
  botToken: string;
  channel: string;
};

type TelegramDependencies = {
  credential: TelegramCredential;
  fetch: typeof fetch;
  runtime: PublisherRuntime;
};

export function createTelegramPublisher({
  credential,
  fetch: providerFetch,
  runtime,
}: TelegramDependencies): Publisher {
  return {
    platform: "telegram",
    async prepare(request) {
      const validation = await runtime.withMaterial(
        "telegram-validate-material",
        async (material) => {
          const assembled = assemblePublishPayload({
            contentLocale: material.contentLocale,
            draft: material.draft,
            hasMedia: material.media !== null,
            platform: material.platform,
            source: material.source,
          });
          return {
            status: assembled.status,
            method: material.media === null ? "sendMessage" : "sendPhoto",
          } as const;
        },
      );
      if (validation.status === "overflow") {
        return {
          status: "failed",
          attemptId: null,
          failure: definiteFailure(
            "PUBLISH_PAYLOAD_TOO_LONG",
            "invalid",
            "preparation",
            "none",
          ),
        };
      }
      if (validation.status !== "ready") {
        return {
          status: "failed",
          attemptId: null,
          failure: definiteFailure(
            "MEDIA_NOT_PUBLISHABLE",
            "invalid",
            "preparation",
            "none",
          ),
        };
      }

      return {
        status: "prepared",
        prepared: {
          attempt: await runtime.beginAttempt(request),
          checkpoints: [],
          method: validation.method,
          platform: "telegram",
        },
      };
    },
    async publish(prepared) {
      if (prepared.platform !== "telegram") {
        throw new Error("TELEGRAM_PREPARED_PAYLOAD_INVALID");
      }
      return runtime.withMaterial("telegram-final-effect", async (material) => {
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
        let media: Uint8Array<ArrayBuffer> | null = null;
        if (material.media) {
          try {
            media = await runtime.readMedia(material.media.objectKey);
          } catch (error) {
            return failed(
              prepared.attempt.id,
              boundedRetry(
                definiteFailure(
                  "MEDIA_NOT_PUBLISHABLE",
                  providerFailureClass(error),
                  "preparation",
                  "retry_preparation",
                ),
                prepared.attempt.number,
                Date.now(),
              ),
            );
          }
        }
        let mimeType = material.media?.mimeType ?? null;
        if (media && mimeType) {
          const raster = await publishRasterForUpload(media, mimeType);
          if (!raster) {
            return failed(
              prepared.attempt.id,
              definiteFailure(
                "MEDIA_NOT_PUBLISHABLE",
                "invalid",
                "publication",
                "none",
              ),
            );
          }
          media = raster.bytes;
          mimeType = raster.mimeType;
        }
        const url = `https://api.telegram.org/bot${credential.botToken}/${prepared.method}`;
        const init = telegramRequest({
          chatId: credential.channel,
          link: assembled.telegramLink,
          method: prepared.method,
          mimeType,
          media,
          text: assembled.text,
        });
        if (!(await runtime.claimFinalEffect(prepared.attempt.id))) {
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "TELEGRAM_DELIVERY_UNKNOWN",
              "transport",
              "delivery_unknown",
            ),
          );
        }
        let response: Response;
        try {
          response = await providerFetch(url, init);
        } catch (error) {
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "TELEGRAM_DELIVERY_UNKNOWN",
              providerFailureClass(error),
              "delivery_unknown",
            ),
          );
        }
        const body = await response.json().catch(() => null);
        if (response.ok) {
          const success = projectTelegramSuccess(body);
          if (success) {
            const providerResultId = String(success.messageId);
            return {
              status: "confirmed",
              attemptId: prepared.attempt.id,
              checkpoint: {
                kind: "telegram_message",
                providerReferenceId: providerResultId,
              },
              providerResultId,
            } satisfies PublishResult;
          }
          return failed(
            prepared.attempt.id,
            unknownFailure(
              "TELEGRAM_DELIVERY_UNKNOWN",
              "provider",
              "delivery_unknown",
            ),
          );
        }
        return failed(
          prepared.attempt.id,
          classifyTelegramFailure(
            response.status,
            body,
            prepared.attempt.number,
          ),
        );
      });
    },
    async reconcile() {
      return { status: "still_unknown" };
    },
  };
}

function classifyTelegramFailure(
  status: number,
  body: unknown,
  attemptNumber: number,
): ProviderFailure {
  const detail = projectTelegramError(body);
  if (status === 429) {
    return boundedRetry(
      definiteFailure(
        "TELEGRAM_RATE_LIMITED",
        "rate",
        "publication",
        "retry_after_provider_time",
      ),
      attemptNumber,
      Date.now(),
      detail?.retryAfter === undefined ? undefined : detail.retryAfter * 1_000,
    );
  }
  if (detail?.migrateToChatId !== undefined) {
    return definiteFailure(
      "TELEGRAM_CHANNEL_MIGRATED",
      "permanent",
      "publication",
    );
  }
  if (status === 400) {
    return definiteFailure(
      "TELEGRAM_REQUEST_INVALID",
      "invalid",
      "publication",
    );
  }
  if (status === 401) {
    return definiteFailure("TELEGRAM_AUTH_FAILED", "auth", "publication");
  }
  if (status === 403) {
    return definiteFailure(
      "TELEGRAM_POSTING_FORBIDDEN",
      "permanent",
      "publication",
    );
  }
  return unknownFailure(
    "TELEGRAM_DELIVERY_UNKNOWN",
    status >= 500 ? "provider" : "transport",
    "delivery_unknown",
  );
}

function telegramRequest(
  input:
    | {
        chatId: string;
        link: { length: number; offset: number; url: string } | null;
        media: Uint8Array<ArrayBuffer> | null;
        method: "sendMessage";
        mimeType: string | null;
        text: string;
      }
    | {
        chatId: string;
        link: { length: number; offset: number; url: string } | null;
        media: Uint8Array<ArrayBuffer> | null;
        method: "sendPhoto";
        mimeType: string | null;
        text: string;
      },
) {
  const entities = input.link
    ? [{ ...input.link, type: "text_link" as const }]
    : undefined;
  if (input.method === "sendMessage") {
    return {
      body: JSON.stringify({
        chat_id: input.chatId,
        entities,
        text: input.text,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    } satisfies RequestInit;
  }
  if (!input.media || !input.mimeType) {
    throw new Error("TELEGRAM_MEDIA_MISSING");
  }
  const form = new FormData();
  form.set("chat_id", input.chatId);
  form.set("caption", input.text);
  if (entities) form.set("caption_entities", JSON.stringify(entities));
  form.set("photo", new Blob([input.media], { type: input.mimeType }));
  return { body: form, method: "POST" } satisfies RequestInit;
}

function projectTelegramSuccess(body: unknown) {
  const value = objectValue(body);
  const result = objectValue(value?.result);
  return telegramSuccessSchema.safeParse({ messageId: result?.message_id })
    .data;
}

function projectTelegramError(body: unknown) {
  const value = objectValue(body);
  const parameters = objectValue(value?.parameters);
  return telegramErrorSchema.safeParse({
    errorCode: value?.error_code,
    migrateToChatId: parameters?.migrate_to_chat_id,
    retryAfter: parameters?.retry_after,
  }).data;
}
