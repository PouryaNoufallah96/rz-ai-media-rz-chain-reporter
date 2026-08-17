import "server-only";

import type { Executor } from "@rz-chain-reporter/db/executor";

// ADR 0005: one deployment serves one customer and holds exactly one workspace
// row, so the installation's workspace is read from the database rather than
// configured, seeded or carried on the request. Anything else is a
// provisioning fault and fails here rather than silently scoping a query to
// the wrong installation. Pre-Phase-3: membership and per-operator
// authorization arrive with the workspaceProcedure rung, so every signed-in
// operator still sees this one installation.
export async function resolveInstallationWorkspaceId(executor: Executor) {
  const [workspace, extra] = await executor.query.workspace.findMany({
    columns: { id: true },
    limit: 2,
  });

  if (!workspace) {
    throw new Error("No workspace row: this deployment is not provisioned");
  }
  if (extra) {
    throw new Error("More than one workspace row in a single deployment");
  }

  return workspace.id;
}
