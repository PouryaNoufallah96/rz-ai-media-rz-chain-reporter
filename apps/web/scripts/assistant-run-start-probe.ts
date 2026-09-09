import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import {
  canonicalRunConfiguration,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import { createDb } from "@rz-chain-reporter/db";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { workspace } from "@rz-chain-reporter/db/schema/workspace";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import { createModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import type {
  EmbeddingAdapterInput,
  EmbeddingAdapterResult,
  ImageAdapterInput,
  ImageAdapterResult,
  RemoteModelAdapter,
  StructuredAdapterInput,
  StructuredAdapterResult,
  TextStreamAdapterInput,
  TextStreamAdapterResult,
  TextStreamModelInvocation,
  TextStreamUIMessage,
} from "@rz-chain-reporter/model-gateway/types";
import {
  type InferUIMessageChunk,
  type ToolSet,
  tool,
  type UIMessage,
} from "ai";
import dotenv from "dotenv";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import {
  hasRpcMutationInvalidation,
  rpcMutationInvalidationTags,
} from "../src/server/rpc/mutation-invalidation";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const target = new URL(MIGRATION_DATABASE_URL);
assert.ok(
  target.hostname === "127.0.0.1" || target.hostname === "localhost",
  "assistant gateway probe requires a loopback PostgreSQL target",
);
assert.equal(
  target.pathname.slice(1),
  "rz-chain-reporter",
  "assistant gateway probe requires the project-owned database",
);

const workspaceId = randomUUID();
const actorId = `assistant-gateway-probe-${randomUUID()}`;
const completeOperationId = randomUUID();
const completeAttemptId = randomUUID();
const interruptedOperationId = randomUUID();
const interruptedAttemptId = randomUUID();
const rollback = new Error("EXPECTED_ASSISTANT_GATEWAY_PROBE_ROLLBACK");
const database = createDb(MIGRATION_DATABASE_URL, { max: 2, pipeline: true });
const { template } = loadCustomerTemplate(
  resolve(process.cwd(), "../.."),
  "chainreporter",
);
const tools = {
  start_run: tool({
    inputSchema: z.strictObject({ kind: z.enum(["news", "promo"]) }),
  }),
};

const configuration = {
  kind: "promo" as const,
  models: ["probe-model"],
  platforms: ["telegram" as const],
  promo: {
    brands: ["probe-brand"],
    prompts: { "probe-brand": "Prepare the launch" },
  },
};
const reorderedConfiguration = {
  platforms: ["telegram" as const],
  promo: {
    prompts: { "probe-brand": "Prepare the launch" },
    brands: ["probe-brand"],
  },
  models: ["probe-model"],
  kind: "promo" as const,
};
const changedConfiguration = {
  ...configuration,
  promo: {
    ...configuration.promo,
    prompts: { "probe-brand": "Changed launch" },
  },
};
async function main() {
  if (process.argv.includes("--promo-brand-eligibility")) {
    try {
      await probePromoBrandEligibility();
    } finally {
      await database.close();
    }
    return;
  }

  assert.equal(
    hashConfiguration(configuration),
    hashConfiguration(reorderedConfiguration),
  );
  assert.notEqual(
    hashConfiguration(configuration),
    hashConfiguration(changedConfiguration),
  );
  assert.equal(hasRpcMutationInvalidation(["editorial", "startRun"]), true);
  assert.equal(hasRpcMutationInvalidation(["auth", "session"]), false);
  assert.deepEqual(
    rpcMutationInvalidationTags(["editorial", "startRun"], workspaceId),
    [
      workspaceCacheTag(workspaceId, "editorial"),
      workspaceCacheTag(workspaceId, "drafts"),
    ],
  );

  try {
    await assert.rejects(
      database.db.transaction(async (tx) => {
        await tx.insert(user).values({
          id: actorId,
          email: `${actorId}@example.test`,
          name: "Assistant Gateway Probe",
        });
        await tx.insert(workspace).values({
          id: workspaceId,
          name: `Assistant Gateway Probe ${workspaceId}`,
        });
        await tx.insert(operation).values([
          {
            actor: actorId,
            commandType: "assistant-gateway-probe-complete",
            id: completeOperationId,
            idempotencyKey: completeOperationId,
            lifecycle: "running",
            requestHash: completeOperationId,
            workspaceId,
          },
          {
            actor: actorId,
            commandType: "assistant-gateway-probe-interrupted",
            id: interruptedOperationId,
            idempotencyKey: interruptedOperationId,
            lifecycle: "running",
            requestHash: interruptedOperationId,
            workspaceId,
          },
        ]);
        await tx.insert(operationAttempt).values([
          {
            attemptNumber: 1,
            id: completeAttemptId,
            operationId: completeOperationId,
            workspaceId,
          },
          {
            attemptNumber: 1,
            id: interruptedAttemptId,
            operationId: interruptedOperationId,
            workspaceId,
          },
        ]);

        const completedGateway = createModelGateway({
          adapters: { remote: new SynthesisAdapter("complete") },
          assertTemplateCurrent: async () => undefined,
          bindings: {},
          executor: tx,
          logger: { warn: () => undefined },
          template,
        });
        const completed = await completedGateway.streamSynthesis<
          typeof tools,
          TextStreamUIMessage<typeof tools>
        >(synthesisInput(completeOperationId, completeAttemptId));
        await drain(completed.uiStream);
        assert.equal(completed.usageEventIds().length, 3);

        const completedUsage = await tx
          .select({
            callIndex: aiUsageEvent.callIndex,
            costAuthority: aiUsageEvent.costAuthority,
            invocationKey: aiUsageEvent.invocationKey,
            status: aiUsageEvent.status,
          })
          .from(aiUsageEvent)
          .where(eq(aiUsageEvent.operationAttemptId, completeAttemptId))
          .orderBy(asc(aiUsageEvent.callIndex));
        assert.deepEqual(completedUsage, [
          {
            callIndex: 0,
            costAuthority: "unknown",
            invocationKey: "primary",
            status: "succeeded",
          },
          {
            callIndex: 1,
            costAuthority: "unknown",
            invocationKey: "primary",
            status: "failed",
          },
          {
            callIndex: 2,
            costAuthority: "unknown",
            invocationKey: "primary",
            status: "unknown",
          },
        ]);

        const interruptedGateway = createModelGateway({
          adapters: { remote: new SynthesisAdapter("interrupted") },
          assertTemplateCurrent: async () => undefined,
          bindings: {},
          executor: tx,
          logger: { warn: () => undefined },
          template,
        });
        const interrupted = await interruptedGateway.streamSynthesis<
          typeof tools,
          TextStreamUIMessage<typeof tools>
        >(synthesisInput(interruptedOperationId, interruptedAttemptId));
        const interruptedReader = interrupted.uiStream.getReader();
        assert.equal((await interruptedReader.read()).done, false);
        await assert.rejects(
          interruptedReader.cancel("probe-interruption"),
          /EXPECTED_ADAPTER_CANCEL_FAILURE/,
        );
        assert.equal(interrupted.usageEventIds().length, 1);

        const interruptedUsage = await tx
          .select({
            callIndex: aiUsageEvent.callIndex,
            costAuthority: aiUsageEvent.costAuthority,
            invocationKey: aiUsageEvent.invocationKey,
            status: aiUsageEvent.status,
          })
          .from(aiUsageEvent)
          .where(eq(aiUsageEvent.operationAttemptId, interruptedAttemptId));
        assert.deepEqual(interruptedUsage, [
          {
            callIndex: 0,
            costAuthority: "unknown",
            invocationKey: "primary",
            status: "cancelled",
          },
        ]);

        process.stdout.write(
          `${JSON.stringify({
            canonicalConfigurationIdentity: true,
            gateway: {
              failedAttemptRecorded: true,
              interruptedAttemptRecorded: true,
              typedToolRegistry: Object.keys(tools),
              unknownCostRecorded: true,
              unknownOutcomeRecorded: true,
              usageRows: completedUsage.length + interruptedUsage.length,
            },
            invalidationTags: rpcMutationInvalidationTags(
              ["editorial", "startRun"],
              workspaceId,
            ),
            unrelatedMutationUntouched: true,
          })}\n`,
        );
        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );

    const residue = await database.db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, workspaceId));
    assert.equal(residue.length, 0);
  } finally {
    await database.close();
  }
}

async function probePromoBrandEligibility() {
  const [{ resolveRunConfiguration }, { customerEditorial }] =
    await Promise.all([
      import("../src/server/rpc/routers/editorial"),
      import("../src/lib/customer-template.server"),
    ]);
  const disabled = customerEditorial.brands.find(
    (brand) => !brand.promoEnabled,
  );
  const eligible = customerEditorial.brands.find((brand) => brand.promoEnabled);
  const model = customerEditorial.models[0];
  const platform = customerEditorial.platforms[0];
  assert.ok(disabled, "probe template requires a Promo-disabled brand");
  assert.ok(eligible, "probe template requires a Promo-enabled brand");
  assert.ok(model, "probe template requires a model");
  assert.ok(platform, "probe template requires a platform");

  const candidate = (brand: string) => ({
    kind: "promo" as const,
    models: [model.key],
    platforms: [platform],
    promo: {
      brands: [brand],
      prompts: { [brand]: "Prepare the launch" },
    },
  });
  const rejected = await resolveRunConfiguration(
    database.db,
    workspaceId,
    candidate(disabled.key),
  );
  assert.equal(rejected.status, "invalid");
  assert.equal(rejected.issues[0]?.message, "PROMO_BRAND_DISABLED");

  const accepted = await resolveRunConfiguration(
    database.db,
    workspaceId,
    candidate(eligible.key),
  );
  assert.equal(accepted.status, "valid");
  assert.equal(accepted.configuration.kind, "promo");
  assert.deepEqual(accepted.configuration.promo.brands, [eligible.key]);
  process.stdout.write(
    `${JSON.stringify({
      disabledBrandRejected: disabled.key,
      eligibleBrandAccepted: eligible.key,
      status: "passed",
    })}\n`,
  );
}

function synthesisInput(
  operationId: string,
  operationAttemptId: string,
): TextStreamModelInvocation<typeof tools> {
  return {
    deadlineMs: 2_000,
    bindAgentTools: (settings) => ({ ...settings, tools }),
    instructions: "Use the typed tool.",
    invocationKey: "primary" as const,
    maxOutputTokens: 64,
    operationAttemptId,
    operationId,
    prompt: "Prepare one run.",
    taskKey: "assistant-synthesis" as const,
    workspaceId,
  };
}

function hashConfiguration(value: typeof configuration) {
  return createHash("sha256")
    .update(canonicalRunConfiguration(value))
    .digest("hex");
}

async function drain<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  while (!(await reader.read()).done) {}
}

class SynthesisAdapter implements RemoteModelAdapter {
  constructor(private readonly scenario: "complete" | "interrupted") {}

  async embedMany(
    _input: EmbeddingAdapterInput,
  ): Promise<EmbeddingAdapterResult> {
    throw new Error("unexpected embedding call");
  }

  async generateImage(_input: ImageAdapterInput): Promise<ImageAdapterResult> {
    throw new Error("unexpected image call");
  }

  async generateStructured<TOutput>(
    _input: StructuredAdapterInput<TOutput>,
  ): Promise<StructuredAdapterResult<TOutput>> {
    throw new Error("unexpected structured call");
  }

  async streamText<
    TOOLS extends ToolSet,
    UI_MESSAGE extends UIMessage = TextStreamUIMessage<TOOLS>,
  >(
    input: TextStreamAdapterInput<TOOLS>,
  ): Promise<TextStreamAdapterResult<UI_MESSAGE>> {
    await input.onStepStart(0);
    if (this.scenario === "interrupted") {
      return {
        uiStream: new ReadableStream<InferUIMessageChunk<UI_MESSAGE>>({
          start(controller) {
            controller.enqueue({ type: "start" });
          },
          cancel() {
            throw new Error("EXPECTED_ADAPTER_CANCEL_FAILURE");
          },
        }),
      };
    }

    await input.onStepEnd(0, {
      costAuthority: "unknown",
      finishReason: "stop",
    });
    await input.onStepStart(1);
    await input.onStepEnd(1, {
      costAuthority: "unknown",
      failureRetryable: false,
      finishReason: "error",
    });
    await input.onStepStart(2);
    return {
      uiStream: new ReadableStream({
        start(controller) {
          controller.close();
        },
      }),
    };
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
