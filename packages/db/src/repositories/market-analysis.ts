import { and, desc, eq } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { inWorkspace } from "../filters";
import { marketAnalysis } from "../schema/market-analysis";

type MarketAnalysisInsert = Omit<
  typeof marketAnalysis.$inferInsert,
  "workspaceId"
>;

export async function insertOrReloadMarketAnalysis(
  tx: Transaction,
  workspaceId: string,
  input: MarketAnalysisInsert,
) {
  const [created] = await tx
    .insert(marketAnalysis)
    .values({ ...input, workspaceId })
    .onConflictDoNothing({ target: marketAnalysis.operationId })
    .returning();

  if (created) return { status: "created" as const, analysis: created };

  const [existing] = await tx
    .select()
    .from(marketAnalysis)
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        eq(marketAnalysis.operationId, input.operationId),
      ),
    );

  if (!existing) throw new Error("market analysis replay row is missing");
  if (existing.requestFingerprint !== input.requestFingerprint) {
    throw new Error("market analysis replay fingerprint mismatch");
  }
  return { status: "replayed" as const, analysis: existing };
}

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

export async function getMarketAnalysisForUpdate(
  tx: Transaction,
  workspaceId: string,
  marketAnalysisId: string,
) {
  const [row] = await tx
    .select()
    .from(marketAnalysis)
    .where(
      and(
        inWorkspace(marketAnalysis, workspaceId),
        eq(marketAnalysis.id, marketAnalysisId),
      ),
    )
    .for("update");
  return row ?? null;
}

export function listRecentMarketAnalyses(
  executor: Executor,
  workspaceId: string,
  limit: number,
) {
  return executor
    .select()
    .from(marketAnalysis)
    .where(inWorkspace(marketAnalysis, workspaceId))
    .orderBy(desc(marketAnalysis.updatedAt), desc(marketAnalysis.id))
    .limit(limit);
}
