import "server-only";

import { NotProvisionedError } from "@rz-chain-reporter/api/context";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { cache } from "react";

export const resolveInstallationWorkspaceId = cache(
  async (executor: Executor) => {
    const [workspace, extra] = await executor.query.workspace.findMany({
      columns: { id: true },
      limit: 2,
    });

    if (!workspace) {
      throw new NotProvisionedError(
        "No workspace row: this deployment is not provisioned",
      );
    }
    if (extra) {
      throw new NotProvisionedError(
        "More than one workspace row in a single deployment",
      );
    }

    return workspace.id;
  },
);
