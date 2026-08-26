import { eq } from "drizzle-orm";

import type { Executor } from "../executor";
import { workspace } from "../schema/workspace";

export async function matchesAppliedCustomerTemplate(
  executor: Executor,
  workspaceId: string,
  fingerprint: string,
) {
  const [installation] = await executor
    .select({ fingerprint: workspace.customerTemplateFingerprint })
    .from(workspace)
    .where(eq(workspace.id, workspaceId))
    .limit(1);

  return installation?.fingerprint === fingerprint;
}
