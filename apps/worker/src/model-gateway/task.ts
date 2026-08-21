import type { InvocationKey, ModelBackend } from "@rz-chain-reporter/contracts";
import {
  type CustomerTemplate,
  type ModelTaskKey,
  modelTaskKeySchema,
} from "@rz-chain-reporter/customer-template/schema";

import { ModelTaskConfigurationError } from "./errors";

export type ModelRoute = {
  backend: ModelBackend;
  model: string;
};

export function resolveModelTask(
  template: CustomerTemplate,
  taskKey: string,
  invocationKey: InvocationKey,
): { route: ModelRoute; taskKey: ModelTaskKey } {
  const parsedTaskKey = modelTaskKeySchema.safeParse(taskKey);

  if (!parsedTaskKey.success) {
    throw new ModelTaskConfigurationError(`unknown model task "${taskKey}"`);
  }

  const task = template.models?.tasks[parsedTaskKey.data];

  if (!task) {
    throw new ModelTaskConfigurationError(
      `model task "${parsedTaskKey.data}" is not configured`,
    );
  }

  if (invocationKey === "fallback") {
    if (!task.fallback) {
      throw new ModelTaskConfigurationError(
        `model task "${parsedTaskKey.data}" has no fallback route`,
      );
    }

    return { route: task.fallback, taskKey: parsedTaskKey.data };
  }

  return { route: task, taskKey: parsedTaskKey.data };
}
