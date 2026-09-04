import { and, eq } from "drizzle-orm";

import type { Executor } from "../executor";
import { inWorkspace } from "../filters";
import { marketAnalysis } from "../schema/market-analysis";

export async function getMarketAnalysis(
  executor: Executor,
  workspaceId: string,
  marketAnalysisId: string,
) {
  const [row] = await executor
    .select()
    .from(marketAnalysis)
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        eq(marketAnalysis.id, marketAnalysisId),
      ),
    );
  return row ?? null;
}
