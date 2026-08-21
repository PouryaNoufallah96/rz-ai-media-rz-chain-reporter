import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import type { CustomerTemplate } from "@rz-chain-reporter/customer-template/schema";
import { createDb, DB_PROBE_TIMEOUT_MS } from "@rz-chain-reporter/db";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { NonRetriableError } from "inngest";

import {
  assertAppliedIdentity,
  type InstallationIdentity,
} from "../identity/assert";
import { resolveArtifactRoot } from "../runtime/artifact-root";
import { workerEnv } from "../runtime/env";

export type WorkerRuntime = {
  db: Executor;
  identity: InstallationIdentity;
  template: CustomerTemplate;
};

export function openWorkerRuntime() {
  const loaded = loadCustomerTemplate(
    resolveArtifactRoot(import.meta.url),
    workerEnv.CUSTOMER_TEMPLATE_KEY,
  );
  const database = createDb(workerEnv.DATABASE_URL, {
    connectionTimeoutMillis: DB_PROBE_TIMEOUT_MS,
  });
  return {
    database,
    identity: {
      customerTemplateKey: workerEnv.CUSTOMER_TEMPLATE_KEY,
      fingerprint: loaded.fingerprint,
    },
    template: loaded.template,
  };
}

export async function assertWorkspace(
  runtime: Pick<WorkerRuntime, "db" | "identity">,
  workspaceId?: string,
) {
  const installation = await assertAppliedIdentity(
    runtime.db,
    runtime.identity,
  );
  if (workspaceId !== undefined && installation.workspaceId !== workspaceId) {
    throw new NonRetriableError("worker workspace mismatch");
  }
  return installation;
}
