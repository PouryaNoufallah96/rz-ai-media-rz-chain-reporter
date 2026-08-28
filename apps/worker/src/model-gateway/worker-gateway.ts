import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  createModelGateway,
  type ModelGateway,
} from "@rz-chain-reporter/model-gateway/gateway";
import type {
  ModelAdapter,
  ModelBindings,
  RemoteModelAdapter,
} from "@rz-chain-reporter/model-gateway/types";

import {
  assertAppliedIdentity,
  type InstallationIdentity,
} from "../identity/assert";
import { workerLogger } from "../logging/logger";

export function createWorkerModelGateway(options: {
  adapters?: { local?: ModelAdapter; remote?: RemoteModelAdapter };
  bindings: ModelBindings;
  executor: Executor;
  identity: InstallationIdentity;
  template: CustomerTemplate;
}): ModelGateway {
  return createModelGateway({
    ...options,
    assertTemplateCurrent: async (workspaceId) => {
      const current = await assertAppliedIdentity(
        options.executor,
        options.identity,
      );

      if (current.workspaceId !== workspaceId) {
        throw new Error("template applied to a different workspace");
      }
    },
    logger: workerLogger,
  });
}
