import { and, eq } from "drizzle-orm";

import type { Executor } from "../executor";
import { inWorkspace } from "../filters";
import { marketChartDefault } from "../schema/market-analysis";

export async function getMarketChartDefault(
  executor: Executor,
  workspaceId: string,
  actorId: string,
  marketInstrumentId: string,
) {
  const [row] = await executor
    .select()
    .from(marketChartDefault)
    .where(
      and(
        inWorkspace(marketChartDefault, workspaceId),
        eq(marketChartDefault.actorId, actorId),
        eq(marketChartDefault.marketInstrumentId, marketInstrumentId),
      ),
    );
  return row ?? null;
}
