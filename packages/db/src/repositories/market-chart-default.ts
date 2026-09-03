import { and, eq } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
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

export async function saveMarketChartDefault(
  tx: Transaction,
  workspaceId: string,
  input: {
    actorId: string;
    marketInstrumentId: string;
    normalizedChartSpec: unknown;
    expectedVersion: number | null;
  },
) {
  if (input.expectedVersion === null) {
    const [created] = await tx
      .insert(marketChartDefault)
      .values({
        workspaceId,
        actorId: input.actorId,
        marketInstrumentId: input.marketInstrumentId,
        normalizedChartSpec: input.normalizedChartSpec,
      })
      .onConflictDoNothing({
        target: [
          marketChartDefault.workspaceId,
          marketChartDefault.actorId,
          marketChartDefault.marketInstrumentId,
        ],
      })
      .returning();
    return created
      ? { status: "saved" as const, chartDefault: created }
      : { status: "conflict" as const };
  }

  const [updated] = await tx
    .update(marketChartDefault)
    .set({
      normalizedChartSpec: input.normalizedChartSpec,
      updatedAt: new Date(),
      version: input.expectedVersion + 1,
    })
    .where(
      and(
        inWorkspace(marketChartDefault, workspaceId),
        eq(marketChartDefault.actorId, input.actorId),
        eq(marketChartDefault.marketInstrumentId, input.marketInstrumentId),
        eq(marketChartDefault.version, input.expectedVersion),
      ),
    )
    .returning();
  return updated
    ? { status: "saved" as const, chartDefault: updated }
    : { status: "conflict" as const };
}
