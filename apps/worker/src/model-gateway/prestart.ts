import type { ModelBackend } from "@rz-chain-reporter/contracts";
import {
  type CustomerTemplate,
  IMAGE_GENERATION_TASK_PREFIX,
  type ModelTaskKey,
  modelTaskKeySchema,
} from "@rz-chain-reporter/customer-template/schema";

import { ModelBindingError } from "./errors";
import { resolveModelTask } from "./task";
import type { ModelBindings } from "./types";

function workerModelTasks(template: CustomerTemplate): ModelTaskKey[] {
  return Object.keys(template.models.tasks).map((taskKey) =>
    modelTaskKeySchema.parse(taskKey),
  );
}

export function assertModelCapabilities(
  template: CustomerTemplate,
  bindings: ModelBindings,
) {
  for (const taskKey of workerModelTasks(template)) {
    const primary = resolveModelTask(template, taskKey, "primary").route;
    assertRouteBinding(taskKey, primary.backend, bindings);
    assertRouteCapability(taskKey, primary.backend);

    const fallback = template.models.tasks[taskKey]?.fallback;
    if (fallback) {
      assertRouteBinding(taskKey, fallback.backend, bindings);
      assertRouteCapability(taskKey, fallback.backend);
    }
  }
}

function assertRouteCapability(taskKey: ModelTaskKey, backend: ModelBackend) {
  if (
    taskKey.startsWith(IMAGE_GENERATION_TASK_PREFIX) &&
    backend !== "remote"
  ) {
    throw new ModelBindingError(
      `model task "${taskKey}" selects a local backend, but image generation requires a remote backend`,
    );
  }
}

function assertRouteBinding(
  taskKey: ModelTaskKey,
  backend: ModelBackend,
  bindings: ModelBindings,
) {
  const bound =
    backend === "remote"
      ? bindings.OPENROUTER_API_KEY !== undefined
      : bindings.OLLAMA_BASE_URL !== undefined;

  if (!bound) {
    throw new ModelBindingError(
      `model task "${taskKey}" selects an unbound ${backend} backend`,
    );
  }
}
