import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import { resolveDestinationCredential } from "@rz-chain-reporter/env/destination-bindings";

import { createInstagramPublisher } from "./instagram";
import type {
  Publisher,
  PublisherRuntime,
  PublishRequest,
  ReconciliationReference,
} from "./port";
import {
  PROVIDER_REQUEST_TIMEOUT_MS,
  PROVIDER_RESPONSE_MAX_BYTES,
} from "./port";
import { createTelegramPublisher } from "./telegram";
import { createXPublisher } from "./x";

type TemplateDestination = CustomerTemplate["destinationAccounts"][number];

type PublisherFactoryInput = {
  acceptInstagramGrant(grantId: string): Promise<void>;
  appUrl?: string;
  destination: TemplateDestination;
  fetch?: typeof fetch;
  issueInstagramGrant(
    request: PublishRequest,
    rawToken: string,
    expiresAt: Date,
  ): Promise<{ id: string }>;
  reconciliationReference?: ReconciliationReference;
  request: PublishRequest;
  runtimeEnv: Record<string, string | undefined>;
  runtime: PublisherRuntime;
};

export function createPublisher(input: PublisherFactoryInput): Publisher {
  const credential = resolveDestinationCredential(
    input.destination,
    input.runtimeEnv,
  );
  const baseFetch = input.fetch ?? fetch;
  const providerFetch: typeof fetch = async (resource, init) => {
    const timeout = AbortSignal.timeout(PROVIDER_REQUEST_TIMEOUT_MS);
    const controller = new AbortController();
    const signal = AbortSignal.any(
      [init?.signal, timeout, controller.signal].filter(
        (candidate): candidate is AbortSignal => candidate !== undefined,
      ),
    );
    const response = await baseFetch(resource, {
      ...init,
      redirect: "error",
      signal,
    });
    return readBoundedResponse(response, controller);
  };

  switch (credential.platform) {
    case "telegram":
      return createTelegramPublisher({
        credential,
        fetch: providerFetch,
        runtime: input.runtime,
      });
    case "x":
      return createXPublisher({
        credential,
        fetch: providerFetch,
        reconciliationReference: input.reconciliationReference,
        request: input.request,
        runtime: input.runtime,
      });
    case "instagram": {
      if (!input.appUrl) throw new Error("INSTAGRAM_PUBLIC_ORIGIN_UNBOUND");
      return createInstagramPublisher({
        acceptGrant: input.acceptInstagramGrant,
        appUrl: input.appUrl,
        credential,
        fetch: providerFetch,
        issueGrant: input.issueInstagramGrant,
        request: input.request,
        runtime: input.runtime,
      });
    }
  }
}

async function readBoundedResponse(
  response: Response,
  controller: AbortController,
): Promise<Response> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > PROVIDER_RESPONSE_MAX_BYTES
  ) {
    controller.abort();
    await response.body?.cancel().catch(() => undefined);
    throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const read = await reader.read();
      if (read.done) break;
      totalBytes += read.value.byteLength;
      if (totalBytes > PROVIDER_RESPONSE_MAX_BYTES) {
        controller.abort();
        await reader.cancel().catch(() => undefined);
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(read.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
