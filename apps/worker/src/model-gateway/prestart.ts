import type { ModelBackend } from "@rz-chain-reporter/contracts";
import type {
  CustomerTemplate,
  ModelTaskKey,
} from "@rz-chain-reporter/customer-template/schema";

import { ModelBindingError } from "./errors";
import { resolveModelTask } from "./task";
import type { ModelBindings } from "./types";

const WORKER_MODEL_TASKS = [
  "generation-probe",
  "keyword-embedding",
  "enrichment-brief",
] as const satisfies readonly ModelTaskKey[];

export function assertModelCapabilities(
  template: CustomerTemplate,
  bindings: ModelBindings,
) {
  for (const taskKey of WORKER_MODEL_TASKS) {
    const primary = resolveModelTask(template, taskKey, "primary").route;
    assertRouteBinding(taskKey, primary.backend, bindings);
    assertEmbeddingRoute(taskKey, primary.backend);

    const fallback = template.models?.tasks[taskKey]?.fallback;
    if (fallback) {
      assertRouteBinding(taskKey, fallback.backend, bindings);
      assertEmbeddingRoute(taskKey, fallback.backend);
    }
  }
}

function assertEmbeddingRoute(taskKey: ModelTaskKey, backend: ModelBackend) {
  if (taskKey === "keyword-embedding" && backend === "local") {
    throw new ModelBindingError(
      `model task "${taskKey}" selects a local backend, which has no embedding adapter`,
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
