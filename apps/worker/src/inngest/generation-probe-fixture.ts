import type { InvocationKey } from "@rz-chain-reporter/contracts";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  finalizeUsage,
  finalizeUsageWithResult,
  insertPendingUsage,
} from "@rz-chain-reporter/db/repositories/ai-usage-event";

import { ModelGatewayInvocationError } from "@rz-chain-reporter/model-gateway/errors";
import type { ModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import { resolveModelTask } from "@rz-chain-reporter/model-gateway/task";
import type { StructuredModelInvocation } from "@rz-chain-reporter/model-gateway/types";

export type GenerationProbeMode = "fallback" | "invalid-output" | "real";

export function createGenerationProbeFixture(options: {
  executor: Executor;
  mode: Exclude<GenerationProbeMode, "real">;
  template: CustomerTemplate;
}): Pick<ModelGateway, "invokeStructured"> {
  return {
    async invokeStructured(input) {
      if (options.mode === "invalid-output") {
        assertStructuredOutputFails(input.schema);
        const usageEventId = await recordFailure(
          options.executor,
          options.template,
          input,
          "primary",
        );
        throw new ModelGatewayInvocationError("STRUCTURED_OUTPUT_INVALID", {
          usageEventId,
        });
      }

      await recordFailure(options.executor, options.template, input, "primary");
      assertStructuredOutputFails(input.schema);
      await recordFailure(options.executor, options.template, input, "retry-1");

      const route = resolveModelTask(
        options.template,
        input.taskKey,
        "fallback",
      );
      const pending = await insertPendingUsage(
        options.executor,
        input.workspaceId,
        {
          apiKind: "chat",
          backend: route.route.backend,
          invocationKey: "fallback",
          operationAttemptId: input.operationAttemptId,
          operationId: input.operationId,
          providerGateway:
            route.route.backend === "remote" ? "openrouter" : "ollama",
          requestedModel: route.route.model,
          taskKey: route.taskKey,
        },
      );

      if (!pending.inserted) {
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }

      const parsed = input.schema.safeParse({ ok: true });
      if (!parsed.success) {
        await finalizeUsage(options.executor, input.workspaceId, {
          costAuthority: route.route.backend === "local" ? "local" : "unknown",
          id: pending.event.id,
          resolvedModel: route.route.model,
          status: "failed",
        });
        throw new ModelGatewayInvocationError("STRUCTURED_OUTPUT_INVALID", {
          usageEventId: pending.event.id,
        });
      }

      const finalized = await finalizeUsageWithResult(
        options.executor,
        input.workspaceId,
        {
          costAuthority: route.route.backend === "local" ? "local" : "unknown",
          id: pending.event.id,
          resolvedModel: route.route.model,
          status: "succeeded",
        },
        (tx) => input.persistResult(tx, parsed.data),
      );

      if (finalized.status !== "updated") {
        throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
          ambiguous: true,
          usageEventId: pending.event.id,
        });
      }

      return { output: parsed.data, usageEventId: pending.event.id };
    },
  };
}

function assertStructuredOutputFails(
  schema: Parameters<ModelGateway["invokeStructured"]>[0]["schema"],
) {
  if (schema.safeParse({ ok: false }).success) {
    throw new Error(
      "generation probe invalid-output fixture unexpectedly validated",
    );
  }
}

async function recordFailure<TOutput>(
  executor: Executor,
  template: CustomerTemplate,
  input: StructuredModelInvocation<TOutput>,
  invocationKey: Exclude<InvocationKey, "fallback">,
) {
  const route = resolveModelTask(template, input.taskKey, invocationKey);
  const pending = await insertPendingUsage(executor, input.workspaceId, {
    apiKind: "chat",
    backend: route.route.backend,
    invocationKey,
    operationAttemptId: input.operationAttemptId,
    operationId: input.operationId,
    providerGateway: route.route.backend === "remote" ? "openrouter" : "ollama",
    requestedModel: route.route.model,
    taskKey: route.taskKey,
  });

  if (!pending.inserted) {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId: pending.event.id,
    });
  }

  const finalized = await finalizeUsage(executor, input.workspaceId, {
    costAuthority: route.route.backend === "local" ? "local" : "unknown",
    id: pending.event.id,
    resolvedModel: route.route.model,
    status: "failed",
  });

  if (finalized.status !== "updated") {
    throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
      ambiguous: true,
      usageEventId: pending.event.id,
    });
  }

  return pending.event.id;
}
