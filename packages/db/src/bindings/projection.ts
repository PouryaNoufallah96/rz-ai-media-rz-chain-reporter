import {
  type BindableDestination,
  type DestinationBindingReport,
  resolveDestinationBindings,
} from "@rz-chain-reporter/env/destination-bindings";
import { eq } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { inWorkspace } from "../filters";
import { destinationAccount } from "../schema/destination-account";
import { workspace } from "../schema/workspace";

const BINDING_PROJECTION_ERROR_CODES = [
  "NOT_PROVISIONED",
  "MULTIPLE_WORKSPACES",
] as const;

export type BindingProjectionErrorCode =
  (typeof BINDING_PROJECTION_ERROR_CODES)[number];

export class BindingProjectionError extends Error {
  readonly code: BindingProjectionErrorCode;

  constructor(code: BindingProjectionErrorCode, message: string) {
    super(message);
    this.name = "BindingProjectionError";
    this.code = code;
  }
}

export type BindingProjection = {
  report: DestinationBindingReport;
  written: number;
};

export async function recordDestinationBindingProjection(
  executor: Executor,
  runtimeEnv: Record<string, string | undefined>,
): Promise<BindingProjection> {
  return executor.transaction(async (tx) => {
    const workspaceId = await findInstallationWorkspace(tx);
    const rows = await tx
      .select({
        id: destinationAccount.id,
        key: destinationAccount.key,
        platform: destinationAccount.platform,
        enabled: destinationAccount.enabled,
        bindingPresent: destinationAccount.bindingPresent,
        bindingCheckedAt: destinationAccount.bindingCheckedAt,
        deletedAt: destinationAccount.deletedAt,
      })
      .from(destinationAccount)
      .where(inWorkspace(destinationAccount, workspaceId));

    const report = resolveDestinationBindings(
      rows.map(
        (row): BindableDestination => ({
          key: row.key,
          platform: row.platform,
          enabled: row.enabled,
          retired: row.deletedAt !== null,
        }),
      ),
      runtimeEnv,
    );

    const statusByKey = new Map(
      report.destinations.map((binding) => [binding.key, binding.status]),
    );
    const checkedAt = new Date();
    let written = 0;

    for (const row of rows) {
      const status = statusByKey.get(row.key);

      if (!status) {
        throw new Error(`binding report is missing destination "${row.key}"`);
      }

      // Inactive destinations clear the binding projection so a stale "bound" cannot linger.
      const bindingPresent = status === "inactive" ? null : status === "bound";

      if (bindingPresent === null && row.bindingPresent === null) {
        continue;
      }

      await tx
        .update(destinationAccount)
        .set({
          bindingPresent,
          bindingCheckedAt: bindingPresent === null ? null : checkedAt,
        })
        .where(eq(destinationAccount.id, row.id));

      written += 1;
    }

    return { report, written };
  });
}

async function findInstallationWorkspace(tx: Transaction) {
  const rows = await tx.select({ id: workspace.id }).from(workspace).limit(2);
  const [installation, extra] = rows;

  if (!installation) {
    throw new BindingProjectionError(
      "NOT_PROVISIONED",
      "database holds no workspace row; run template:reconcile first",
    );
  }

  if (extra) {
    throw new BindingProjectionError(
      "MULTIPLE_WORKSPACES",
      "database holds more than one workspace row; an installation has exactly one",
    );
  }

  return installation.id;
}
