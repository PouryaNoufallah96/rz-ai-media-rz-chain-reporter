import assert from "node:assert/strict";
import { AdapterInvocationError } from "@rz-chain-reporter/model-gateway/errors";
import { createOllamaAdapter } from "@rz-chain-reporter/model-gateway/ollama";
import { createOpenRouterAdapter } from "@rz-chain-reporter/model-gateway/openrouter";
import { diagnoseProviderCall } from "@rz-chain-reporter/model-gateway/usage";
import { APICallError } from "ai";

const LOCAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function apiError(statusCode: number) {
  return new APICallError({
    message: "synthetic",
    requestBodyValues: {},
    statusCode,
    url: "https://example.invalid",
  });
}

function proveHttpClassification() {
  for (const status of [100, 200, 302, 399, 600]) {
    assert.equal(diagnoseProviderCall(apiError(status)), undefined);
  }
  assert.equal(
    diagnoseProviderCall(apiError(422))?.code,
    "PROVIDER_REJECTED_4XX",
  );
  assert.equal(diagnoseProviderCall(apiError(503))?.code, "PROVIDER_5XX");
}

async function proveObservedNoImageIdentity() {
  const adapter = createOpenRouterAdapter("synthetic", {
    fetch: async () =>
      new Response(JSON.stringify({ data: [] }), {
        headers: {
          "content-type": "application/json",
          "x-generation-id": "gen-no-image",
        },
      }),
  });

  await assert.rejects(
    adapter.generateImage({
      deadlineMs: 5_000,
      model: "synthetic/image",
      prompt: "synthetic",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AdapterInvocationError);
      assert.equal(error.kind, "failed");
      assert.equal(error.observation.generationId, "gen-no-image");
      assert.equal(error.observation.finishReason, "NO_IMAGE_RETURNED");
      return true;
    },
  );
}

async function proveAmbiguousSuccessfulParseFailure() {
  const adapter = createOpenRouterAdapter("synthetic", {
    fetch: async () =>
      new Response(JSON.stringify({ unexpected: true }), {
        headers: {
          "content-type": "application/json",
          "x-generation-id": "gen-invalid-success",
        },
      }),
  });

  await assert.rejects(
    adapter.generateImage({
      deadlineMs: 5_000,
      model: "synthetic/image",
      prompt: "synthetic",
    }),
    (error: unknown) => {
      assert.ok(error instanceof AdapterInvocationError);
      assert.equal(error.kind, "unknown");
      assert.equal(error.observation.generationId, "gen-invalid-success");
      return true;
    },
  );
}

async function proveSuccessfulImageDoesNotWaitForAccounting() {
  let calls = 0;
  const adapter = createOpenRouterAdapter("synthetic", {
    fetch: async () => {
      calls += 1;
      return new Response(
        JSON.stringify({
          data: [{ b64_json: LOCAL_PNG.toString("base64") }],
        }),
        {
          headers: {
            "content-type": "application/json",
            "x-generation-id": "gen-aborted-lookup",
          },
        },
      );
    },
  });
  const generated = await adapter.generateImage({
    deadlineMs: 20_000,
    model: "synthetic/image",
    prompt: "synthetic",
  });
  assert.equal(calls, 1);
  assert.equal(generated.observation.generationId, "gen-aborted-lookup");
  assert.equal(generated.observation.costAuthority, "unknown");
  assert.deepEqual(Buffer.from(generated.bytes), LOCAL_PNG);
}

async function proveLocalEmbedding() {
  const adapter = createOllamaAdapter("http://ollama.invalid", {
    fetch: async (input, init) => {
      assert.equal(String(input), "http://ollama.invalid/v1/embeddings");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        encoding_format: "float",
        input: ["first", "second"],
        model: "synthetic-embedding",
      });
      return new Response(
        JSON.stringify({
          data: [{ embedding: [1, 2] }, { embedding: [3, 4] }],
          usage: { prompt_tokens: 7 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  assert.ok(adapter.embedMany);
  const embedded = await adapter.embedMany({
    deadlineMs: 5_000,
    model: "synthetic-embedding",
    values: ["first", "second"],
  });
  assert.deepEqual(embedded.embeddings, [
    [1, 2],
    [3, 4],
  ]);
  assert.deepEqual(embedded.observation, {
    costAuthority: "local",
    generationId: null,
    promptTokens: 7,
    resolvedModel: "synthetic-embedding",
    totalTokens: 7,
  });
}

async function main() {
  proveHttpClassification();
  await proveObservedNoImageIdentity();
  await proveAmbiguousSuccessfulParseFailure();
  await proveSuccessfulImageDoesNotWaitForAccounting();
  await proveLocalEmbedding();
  console.log("model-gateway probe passed");
}

await main();
