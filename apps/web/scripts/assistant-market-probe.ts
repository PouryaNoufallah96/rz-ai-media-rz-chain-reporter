import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { mock } from "node:test";
import { asSchema } from "ai";

const approvalSecret = "probe-only-assistant-approval-secret-32-chars";

if (!process.env.ASSISTANT_MARKET_PROBE_CHILD) {
  const child = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--conditions=react-server",
      "--import",
      "tsx",
      import.meta.filename,
    ],
    {
      env: {
        ...process.env,
        APP_URL: "http://127.0.0.1:3001",
        ASSISTANT_APPROVAL_SECRET: approvalSecret,
        ASSISTANT_MARKET_PROBE_CHILD: "1",
        BETTER_AUTH_SECRET: "probe-only-better-auth-secret-32-characters",
        BETTER_AUTH_URL: "http://127.0.0.1:3001",
        CUSTOMER_TEMPLATE_KEY: "chainreporter",
        DATABASE_URL: "postgresql://probe:probe@127.0.0.1:1/probe",
      },
      stdio: "inherit",
    },
  );
  process.exitCode = child.status ?? 1;
} else {
  void run().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}

async function run() {
  const templateFingerprint = "a".repeat(64);
  mock.module("../src/lib/customer-template.server", {
    exports: { customerTemplateFingerprint: templateFingerprint },
  });

  const [schemas, signer, intent, registry, history] = await Promise.all([
    import("../src/features/assistant/schemas/approval"),
    import("../src/features/assistant/lib/approval-envelope.server"),
    import("../src/features/assistant/lib/market-intent"),
    import("../src/features/assistant/lib/tool-registry.server"),
    import("../src/features/assistant/lib/local-history"),
  ]);

  const instrumentId = randomUUID();
  const workspaceId = randomUUID();
  const identity = { actorId: "market-probe-operator", workspaceId };
  const naturalInput = schemas.assistantMarketToolInputSchema.parse({
    action: "create",
    comparisonCatalogIdentities: [],
    period: "24h",
    primaryInstrumentRefs: ["MGC"],
  });
  const resolved = intent.resolveMarketToolInput(naturalInput, [
    {
      id: instrumentId,
      key: "gold-futures",
      name: "Micro Gold Futures",
      symbol: "MGC",
    },
  ]);
  assert.deepEqual(resolved, {
    input: {
      action: "create",
      comparisonCatalogIdentities: [],
      period: "24h",
      primaryInstrumentIds: [instrumentId],
    },
    question: null,
  });
  if (!resolved.input) throw new Error("natural input did not resolve");
  assert.equal(
    intent.nextMarketQuestion(intent.selectionValues(resolved.input)),
    "scale",
  );
  for (const duplicateInput of [
    { primaryInstrumentIds: [instrumentId, instrumentId] },
    { primaryInstrumentRefs: ["MGC", "Micro Gold Futures"] },
  ]) {
    assert.deepEqual(
      intent.resolveMarketToolInput(
        schemas.assistantMarketToolInputSchema.parse({
          action: "create",
          ...duplicateInput,
        }),
        [
          {
            id: instrumentId,
            key: "gold-futures",
            name: "Micro Gold Futures",
            symbol: "MGC",
          },
        ],
      ),
      { input: null, question: "primaryInstrumentIds" },
    );
  }
  assert.deepEqual(
    intent.resolveMarketToolInput(
      schemas.assistantMarketToolInputSchema.parse({
        action: "create",
        comparisonCatalogIdentities: ["binance:BTCUSDT", "binance:BTCUSDT"],
        primaryInstrumentIds: [instrumentId],
      }),
      [
        {
          id: instrumentId,
          key: "gold-futures",
          name: "Micro Gold Futures",
          symbol: "MGC",
        },
      ],
    ),
    { input: null, question: "comparisonCatalogIdentities" },
  );

  const retiredMarketActions = [
    "update_request",
    "approve_chart",
    "retry_chart",
    "save_chart_default",
    "approve_story",
    "approve_design",
    "generate",
    "retry_finalization",
    "approve_final",
    "prepare_platform",
    "retry_captions",
    "finish",
  ];
  for (const action of retiredMarketActions) {
    assert.equal(
      schemas.assistantMarketToolInputSchema.safeParse({
        action,
        analysisId: randomUUID(),
      }).success,
      false,
      `${action} must be rejected by the live tool schema`,
    );
  }
  for (const action of [
    "load-editorial",
    "prepare-editorial",
    "approve-editorial",
    "load-publishing",
    "prepare-publishing",
    "approve-publishing",
  ]) {
    assert.equal(
      schemas.assistantApprovalRequestSchema.safeParse({ action }).success,
      false,
      `${action} must be rejected by the strict approval route schema`,
    );
  }

  const registeredMarket = registry.assistantToolRegistry({
    marketEnabled: true,
  }).market_action;
  if (!registeredMarket) throw new Error("market tool was not registered");
  const marketSchema = await asSchema(registeredMarket.inputSchema).jsonSchema;
  assert.equal(marketSchema.type, "object");
  assert.deepEqual(marketSchema.properties?.action, {
    const: "create",
    type: "string",
  });
  assert.deepEqual(
    Object.keys(registry.assistantToolRegistry({ marketEnabled: false })),
    ["start_run"],
  );
  assert.deepEqual(
    Object.keys(registry.assistantToolRegistry({ marketEnabled: true })),
    ["start_run", "market_action"],
  );

  const toolInput = schemas.assistantMarketToolInputSchema.parse({
    action: "create",
    comparisonCatalogIdentities: [],
    contentLocale: "en",
    outputFormat: "portrait",
    period: "24h",
    primaryInstrumentIds: [instrumentId],
    scale: "relative",
  });
  const sdkApproval = signedSdkApproval(toolInput);
  const command = schemas.assistantMarketCommandSchema.parse({
    action: "create",
    input: {
      brandingInstrumentId: instrumentId,
      comparisonCatalogIdentities: [],
      contentLocale: "en",
      idempotencyKey: randomUUID(),
      outputFormat: "portrait",
      period: "24h",
      primaryInstrumentIds: [instrumentId],
      scale: "relative",
    },
  });
  for (const input of [
    {
      ...command.input,
      primaryInstrumentIds: [instrumentId, instrumentId],
    },
    {
      ...command.input,
      comparisonCatalogIdentities: ["binance:BTCUSDT", "binance:BTCUSDT"],
    },
  ]) {
    assert.equal(
      schemas.assistantMarketCommandSchema.safeParse({
        action: "create",
        input,
      }).success,
      false,
      "duplicate Market selections must not enter a signed command",
    );
  }
  const values = schemas.assistantMarketValuesSchema.parse({
    brandingInstrumentId: instrumentId,
    comparisonCatalogIdentities: [],
    contentLocale: "en",
    outputFormat: "portrait",
    period: "24h",
    primaryInstrumentIds: [instrumentId],
    scale: "relative",
  });
  const envelope = signer.issueMarketApproval({
    ...identity,
    command,
    materialHash: createHash("sha256")
      .update(JSON.stringify(command))
      .digest("hex"),
    sdkApproval,
    toolInput,
    values,
  });
  assert.equal(signer.verifyMarketApproval(envelope, identity).status, "valid");
  assert.equal(
    signer.verifyMarketApproval(envelope, {
      ...identity,
      actorId: "foreign-operator",
    }).status,
    "invalid",
  );
  assert.equal(
    signer.verifyMarketApproval(
      {
        ...envelope,
        payload: {
          ...envelope.payload,
          values: { ...envelope.payload.values, scale: "absolute" },
        },
      },
      identity,
    ).status,
    "invalid",
  );
  assert.equal(signer.verifySdkMarketApproval(sdkApproval, toolInput), true);

  const storage = new MemoryStorage();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  const key = history.historyKey(workspaceId, identity.actorId);
  storage.setItem(
    key,
    JSON.stringify({
      schemaVersion: 2,
      expiresAt: Date.now() + 60_000,
      messages: [
        {
          id: "legacy",
          role: "assistant",
          metadata: { createdAt: Date.now() },
          parts: [
            {
              type: "tool-editorial_action",
              toolCallId: "retired-editorial",
              state: "approval-requested",
              input: { action: "cancel_run", analysisRunId: randomUUID() },
              approval: { id: "old", signature: "old" },
            },
            {
              type: "tool-market_action",
              toolCallId: "retired-market",
              state: "approval-requested",
              input: { action: "approve_story", analysisId: randomUUID() },
              approval: { id: "old", signature: "old" },
            },
            { type: "text", text: "Retained explanation" },
          ],
        },
      ],
    }),
  );
  const restored = history.readHistory(key);
  assert.deepEqual(restored[0]?.parts, [
    { type: "text", text: "Retained explanation" },
  ]);

  process.stdout.write(
    `${JSON.stringify({
      marketCreateOnly: true,
      retiredActionsRejected: retiredMarketActions.length,
      retiredApprovalRoutesRejected: 6,
      strictSignedApproval: true,
      templateConditionalRegistry: true,
      legacyHistoryDropped: true,
    })}\n`,
  );
}

function signedSdkApproval(toolInput: unknown) {
  const approvalId = "market-probe-approval";
  const toolCallId = "market-probe-call";
  const inputDigest = createHash("sha256")
    .update(canonical(toolInput))
    .digest("base64url");
  const payload = JSON.stringify([
    "ai-sdk-tool-approval-v1",
    approvalId,
    toolCallId,
    "market_action",
    inputDigest,
  ]);
  return {
    approvalId,
    signature: createHmac("sha256", approvalSecret)
      .update(payload)
      .digest("base64url"),
    toolCallId,
  };
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

class MemoryStorage implements Storage {
  readonly values = new Map<string, string>();
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
