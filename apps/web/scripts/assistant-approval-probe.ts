import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { fileURLToPath } from "node:url";
import type { TextStreamUIMessage } from "@rz-chain-reporter/model-gateway/types";
import { tool } from "ai";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { z } from "zod";

import { streamSynthesis as streamSdkSynthesis } from "../../../packages/model-gateway/src/generate";
import type { RunApprovalDependencies } from "../src/features/assistant/lib/command-admission.server";

const childFlag = "--assistant-approval-child";
const origin = "http://localhost:3001";
const approvalSecret = "probe-only-assistant-approval-secret-32-chars";

async function main() {
  if (!process.argv.includes(childFlag)) {
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        childFlag,
      ],
      {
        env: {
          ...process.env,
          APP_URL: origin,
          ASSISTANT_APPROVAL_SECRET: approvalSecret,
          BETTER_AUTH_SECRET: "probe-only-better-auth-secret-32-characters",
          BETTER_AUTH_URL: origin,
          CUSTOMER_TEMPLATE_KEY: "chainreporter",
          DATABASE_URL: "postgresql://probe:probe@127.0.0.1:1/probe",
        },
        stdio: "inherit",
      },
    );
    process.exitCode = child.status ?? 1;
    return;
  }

  mock.module("next/root-params", {
    exports: { locale: async () => "en" },
  });
  mock.module("../src/i18n/navigation", {
    exports: {
      redirect() {
        throw new Error("assistant approval probe never redirects");
      },
    },
  });

  const [boundary, admission, envelopeModule, history] = await Promise.all([
    import("../src/app/api/chat/request-boundary"),
    import("../src/features/assistant/lib/command-admission.server"),
    import("../src/features/assistant/lib/approval-envelope.server"),
    import("../src/features/assistant/lib/local-history"),
  ]);
  const signedStream = await probeSdkSignedStream(
    envelopeModule.verifySdkRunApproval,
  );

  const requestSchema = z.strictObject({ action: z.literal("probe") });
  const identity: { actorId: string; workspaceId: string } = {
    actorId: "assistant-approval-probe",
    workspaceId: randomUUID(),
  };
  let identityLookups = 0;
  let admissions = 0;
  const providerCalls = 0;

  const resolveIdentity = async () => {
    identityLookups += 1;
    return { userId: identity.actorId, workspaceId: identity.workspaceId };
  };
  const rejectBeforeWork = async (
    request: Request,
    expectedStatus: number,
    resolve: () => Promise<{
      userId: string;
      workspaceId: string;
    } | null> = resolveIdentity,
  ) => {
    const result = await boundary.readAssistantRequest(request, requestSchema, {
      appOrigin: origin,
      resolveIdentity: resolve,
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.response.status, expectedStatus);
    assert.equal(
      result.response.headers.get("cache-control"),
      "private, no-store",
    );
    assert.equal(admissions, 0);
    assert.equal(providerCalls, 0);
  };

  await rejectBeforeWork(jsonRequest("{}", "https://cross-origin.test"), 403);
  assert.equal(identityLookups, 0);
  await rejectBeforeWork(
    new Request(`${origin}/api/chat/approve`, {
      body: "{}",
      headers: { "content-type": "text/plain", origin },
      method: "POST",
    }),
    415,
  );
  assert.equal(identityLookups, 0);
  await rejectBeforeWork(jsonRequest("{}"), 401, async () => null);
  await rejectBeforeWork(
    new Request(`${origin}/api/chat/approve`, {
      headers: { "content-type": "application/json", origin },
      method: "POST",
    }),
    400,
  );
  await rejectBeforeWork(jsonRequest("{"), 400);
  await rejectBeforeWork(
    jsonRequest(JSON.stringify("x".repeat(33 * 1024))),
    413,
  );

  const accepted = await boundary.readAssistantRequest(
    jsonRequest(JSON.stringify({ action: "probe" })),
    requestSchema,
    { appOrigin: origin, resolveIdentity },
  );
  assert.equal(accepted.ok, true);
  if (accepted.ok) admissions += 1;
  assert.equal(providerCalls, 0);

  admissions = 0;
  const configuration = {
    kind: "promo" as const,
    models: ["probe-model"],
    platforms: ["telegram" as const],
    promo: {
      brands: ["probe-brand"],
      prompts: { "probe-brand": "Prepare the launch" },
    },
  };
  const toolInput = { kind: "promo" as const };
  const sdkApproval = signedSdkApproval("promo", "fresh");
  const recovered = new Map<
    string,
    { analysisRunId: string; operationId: string; requestHash: string }
  >();
  let now = Date.now();
  let revalidations = 0;
  let starts = 0;
  let templateCurrent = true;
  let resolvedConfiguration = configuration;
  const resultIds = {
    analysisRunId: randomUUID(),
    operationId: randomUUID(),
  };
  const dependencies: RunApprovalDependencies = {
    async findRecovered(_identity: typeof identity, idempotencyKey: string) {
      return recovered.get(idempotencyKey) ?? null;
    },
    now: () => now,
    async revalidate() {
      revalidations += 1;
    },
    async resolveConfiguration() {
      return {
        status: "valid" as const,
        configuration: resolvedConfiguration,
      };
    },
    async startRun(input) {
      starts += 1;
      const prior = recovered.get(input.idempotencyKey);
      if (prior) return { status: "replayed" as const, ...prior };
      const created = {
        ...resultIds,
        requestHash: envelopeModule.approvalConfigurationHash(
          input.configuration,
        ),
      };
      recovered.set(input.idempotencyKey, created);
      return { status: "created" as const, ...created };
    },
    async templateMatches() {
      return templateCurrent;
    },
  };

  const prepared = await admission.prepareRunApproval(
    identity,
    { configuration, sdkApproval, toolInput },
    dependencies,
  );
  assert.equal(prepared.status, "prepared");
  if (prepared.status !== "prepared") return;
  assert.equal(starts, 0);
  assert.equal(
    envelopeModule.verifyRunApproval(prepared.envelope, identity).status,
    "valid",
  );
  assert.equal(
    envelopeModule.verifyRunApproval(prepared.envelope.payload, identity)
      .status,
    "invalid",
  );
  assert.equal(
    envelopeModule.verifyRunApproval(prepared.envelope, {
      ...identity,
      actorId: "another-operator",
    }).status,
    "invalid",
  );
  assert.equal(
    envelopeModule.verifyRunApproval(prepared.envelope, {
      ...identity,
      workspaceId: randomUUID(),
    }).status,
    "invalid",
  );
  assert.equal(
    envelopeModule.verifyRunApproval(
      {
        ...prepared.envelope,
        payload: {
          ...prepared.envelope.payload,
          configuration: {
            ...configuration,
            promo: {
              ...configuration.promo,
              prompts: { "probe-brand": "Tampered" },
            },
          },
        },
      },
      identity,
    ).status,
    "invalid",
  );

  const editedConfiguration = {
    ...configuration,
    promo: {
      ...configuration.promo,
      prompts: { "probe-brand": "Edited launch" },
    },
  };
  resolvedConfiguration = editedConfiguration;
  const edited = await admission.prepareRunApproval(
    identity,
    { configuration: editedConfiguration, sdkApproval, toolInput },
    dependencies,
  );
  assert.equal(edited.status, "prepared");
  if (edited.status !== "prepared") return;
  assert.notEqual(
    edited.envelope.payload.configurationHash,
    prepared.envelope.payload.configurationHash,
  );
  assert.notEqual(
    edited.envelope.payload.idempotencyKey,
    prepared.envelope.payload.idempotencyKey,
  );
  assert.equal(starts, 0);

  resolvedConfiguration = configuration;
  const first = await admission.approveRun(
    identity,
    prepared.envelope,
    dependencies,
  );
  assert.equal(first.status, "created");
  assert.equal(starts, 1);
  assert.equal(revalidations, 1);
  const replay = await admission.approveRun(
    identity,
    prepared.envelope,
    dependencies,
  );
  assert.deepEqual(
    { ...replay, status: "created" },
    { ...first, status: "created" },
  );
  assert.equal(starts, 1);

  const concurrentPrepared = await admission.prepareRunApproval(
    identity,
    {
      configuration,
      sdkApproval: signedSdkApproval("promo", "concurrent"),
      toolInput,
    },
    dependencies,
  );
  assert.equal(concurrentPrepared.status, "prepared");
  if (concurrentPrepared.status !== "prepared") return;
  let concurrentLookups = 0;
  const concurrentDependencies = {
    ...dependencies,
    async findRecovered(
      requestedIdentity: typeof identity,
      idempotencyKey: string,
    ) {
      concurrentLookups += 1;
      if (concurrentLookups <= 2) {
        await Promise.resolve();
        return null;
      }
      return dependencies.findRecovered(requestedIdentity, idempotencyKey);
    },
  };
  const concurrent = await Promise.all([
    admission.approveRun(
      identity,
      concurrentPrepared.envelope,
      concurrentDependencies,
    ),
    admission.approveRun(
      identity,
      concurrentPrepared.envelope,
      concurrentDependencies,
    ),
  ]);
  const [firstConcurrent, secondConcurrent] = concurrent;
  if (
    !firstConcurrent ||
    !secondConcurrent ||
    !(
      firstConcurrent.status === "created" ||
      firstConcurrent.status === "replayed"
    ) ||
    !(
      secondConcurrent.status === "created" ||
      secondConcurrent.status === "replayed"
    )
  ) {
    throw new Error("concurrent approvals did not settle");
  }
  assert.equal(
    new Set([firstConcurrent.analysisRunId, secondConcurrent.analysisRunId])
      .size,
    1,
  );
  assert.equal(
    new Set([firstConcurrent.operationId, secondConcurrent.operationId]).size,
    1,
  );

  now = concurrentPrepared.envelope.payload.expiresAt + 1;
  const recoveredAfterExpiry = await admission.approveRun(
    identity,
    concurrentPrepared.envelope,
    dependencies,
  );
  assert.equal(recoveredAfterExpiry.status, "replayed");

  now = Date.now();
  const expiredPrepared = await admission.prepareRunApproval(
    identity,
    {
      configuration,
      sdkApproval: signedSdkApproval("promo", "expired"),
      toolInput,
    },
    dependencies,
  );
  assert.equal(expiredPrepared.status, "prepared");
  if (expiredPrepared.status !== "prepared") return;
  now = expiredPrepared.envelope.payload.expiresAt + 1;
  assert.equal(
    (
      await admission.approveRun(
        identity,
        expiredPrepared.envelope,
        dependencies,
      )
    ).status,
    "expired",
  );

  now = Date.now();
  const stalePrepared = await admission.prepareRunApproval(
    identity,
    {
      configuration,
      sdkApproval: signedSdkApproval("promo", "stale"),
      toolInput,
    },
    dependencies,
  );
  assert.equal(stalePrepared.status, "prepared");
  if (stalePrepared.status !== "prepared") return;
  resolvedConfiguration = editedConfiguration;
  assert.equal(
    (await admission.approveRun(identity, stalePrepared.envelope, dependencies))
      .status,
    "stale",
  );
  resolvedConfiguration = configuration;

  const driftPrepared = await admission.prepareRunApproval(
    identity,
    {
      configuration,
      sdkApproval: signedSdkApproval("promo", "drift"),
      toolInput,
    },
    dependencies,
  );
  assert.equal(driftPrepared.status, "prepared");
  if (driftPrepared.status !== "prepared") return;
  templateCurrent = false;
  assert.equal(
    (await admission.approveRun(identity, driftPrepared.envelope, dependencies))
      .status,
    "template_drift",
  );
  templateCurrent = true;

  const badSdk = {
    ...sdkApproval,
    signature: `${sdkApproval.signature.slice(0, -1)}x`,
  };
  assert.equal(envelopeModule.verifySdkRunApproval(badSdk, toolInput), false);
  assert.equal(
    (
      await admission.prepareRunApproval(
        identity,
        { configuration, sdkApproval: badSdk, toolInput },
        dependencies,
      )
    ).status,
    "invalid",
  );

  const legacyPayload = [
    sdkApproval.approvalId,
    sdkApproval.toolCallId,
    "start_run",
    digest({ kind: "promo" }),
  ].join("\n");
  const legacySdk = {
    ...sdkApproval,
    signature: createHmac("sha256", approvalSecret)
      .update(legacyPayload)
      .digest("base64url"),
  };
  assert.equal(
    envelopeModule.verifySdkRunApproval(legacySdk, toolInput),
    false,
  );

  const localStorage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorage,
  });
  const historyKey = history.historyKey(identity.workspaceId, identity.actorId);
  localStorage.setItem(historyKey, JSON.stringify(prepared.envelope));
  history.clearHistory(historyKey);
  assert.equal(localStorage.getItem(historyKey), null);

  process.stdout.write(
    `${JSON.stringify({
      approval: {
        actorWorkspaceBound: true,
        cancelledBeforeAdmission: true,
        clearRemovesLocalHistory: true,
        editReissuesIdentity: true,
        expiredBeforeAdmission: true,
        recoveredAfterExpiry: true,
        responseLossReplay: true,
        sdkCurrentFormatOnly: true,
        sdkSignedStream: signedStream,
        staleConfigurationRejected: true,
        tamperRejected: true,
        templateDriftRejected: true,
        twoTabStableResult: true,
        unsignedHistoryRejected: true,
      },
      boundary: {
        admissionCallsOnRejectedRequests: 0,
        privateNoStore: true,
        providerCallsOnRejectedRequests: providerCalls,
        rejected: [
          "cross-origin",
          "wrong-content-type",
          "unauthenticated",
          "empty",
          "malformed",
          "oversized",
        ],
      },
    })}\n`,
  );
}

async function probeSdkSignedStream(
  verifySdkRunApproval: (
    approval: { approvalId: string; signature: string; toolCallId: string },
    input: { kind: "promo" },
  ) => boolean,
) {
  const toolInput = { kind: "promo" as const };
  const tools = {
    start_run: tool({
      inputSchema: z.strictObject({ kind: z.enum(["news", "promo"]) }),
    }),
  };
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start", warnings: [] },
          {
            type: "tool-call",
            toolCallId: "signed-start-run",
            toolName: "start_run",
            input: JSON.stringify(toolInput),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: undefined },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 0, reasoning: 0 },
            },
          },
        ],
      }),
    },
  });
  const synthesis = await streamSdkSynthesis<
    typeof tools,
    TextStreamUIMessage<typeof tools>
  >(
    model,
    {
      activeTools: ["start_run"],
      bindAgentTools: (settings) => ({ ...settings, tools }),
      deadlineMs: 2_000,
      instructions: "Request approval for the typed tool.",
      maxOutputTokens: 64,
      model: "probe-model",
      onStepEnd: async () => undefined,
      onStepStart: async () => undefined,
      prompt: "Prepare one promo run.",
      telemetry: {
        operationAttemptId: randomUUID(),
        operationId: randomUUID(),
        usageEventId: "probe",
      },
      toolApproval: { start_run: "user-approval" },
      toolApprovalSecret: approvalSecret,
    },
    () => ({ costAuthority: "unknown" }),
  );

  let approval:
    | { approvalId: string; signature: string; toolCallId: string }
    | undefined;
  const reader = synthesis.uiStream.getReader();
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (chunk.value.type !== "tool-approval-request") continue;
    assert.ok(chunk.value.signature);
    approval = {
      approvalId: chunk.value.approvalId,
      signature: chunk.value.signature,
      toolCallId: chunk.value.toolCallId,
    };
  }

  assert.ok(approval);
  assert.equal(verifySdkRunApproval(approval, toolInput), true);
  return true;
}

function jsonRequest(body: string, requestOrigin = origin) {
  return new Request(`${origin}/api/chat/approve`, {
    body,
    headers: {
      "content-type": "application/json",
      origin: requestOrigin,
    },
    method: "POST",
  });
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value: unknown) {
  return createHash("sha256").update(canonical(value)).digest("base64url");
}

function signedSdkApproval(kind: "news" | "promo", suffix: string) {
  const approvalId = `approval-${suffix}`;
  const toolCallId = `tool-call-${suffix}`;
  const payload = JSON.stringify([
    "ai-sdk-tool-approval-v1",
    approvalId,
    toolCallId,
    "start_run",
    digest({ kind }),
  ]);
  return {
    approvalId,
    signature: createHmac("sha256", approvalSecret)
      .update(payload)
      .digest("base64url"),
    toolCallId,
  };
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
