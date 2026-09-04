import { and, eq } from "drizzle-orm";

import type { Executor, Transaction } from "../executor";
import { inWorkspace } from "../filters";
import {
  marketSnapshot,
  marketSnapshotSeries,
} from "../schema/market-snapshot";

type SnapshotInsert = Omit<typeof marketSnapshot.$inferInsert, "workspaceId">;
type SeriesInsert = Omit<
  typeof marketSnapshotSeries.$inferInsert,
  "workspaceId" | "marketSnapshotId"
>;

export async function insertOrReloadMarketSnapshot(
  tx: Transaction,
  workspaceId: string,
  input: { snapshot: SnapshotInsert; series: readonly SeriesInsert[] },
) {
  const [created] = await tx
    .insert(marketSnapshot)
    .values({ ...input.snapshot, workspaceId })
    .onConflictDoNothing({ target: marketSnapshot.operationId })
    .returning();

  if (created) {
    if (input.series.length === 0) {
      throw new Error("market snapshot requires at least one series outcome");
    }
    await tx.insert(marketSnapshotSeries).values(
      input.series.map((series) => ({
        ...series,
        workspaceId,
        marketSnapshotId: created.id,
      })),
    );
    return { status: "created" as const, snapshot: created };
  }

  const [existing] = await tx
    .select()
    .from(marketSnapshot)
    .where(
      and(
        inWorkspace(marketSnapshot, workspaceId),
        eq(marketSnapshot.operationId, input.snapshot.operationId),
      ),
    );

  if (!existing) throw new Error("market snapshot replay row is missing");
  if (
    existing.requestFingerprint !== input.snapshot.requestFingerprint ||
    existing.verificationIntentId !== input.snapshot.verificationIntentId ||
    existing.verificationIntentVersion !==
      input.snapshot.verificationIntentVersion
  ) {
    throw new Error("market snapshot replay identity mismatch");
  }
  return { status: "replayed" as const, snapshot: existing };
}

export async function getMarketSnapshotWithSeries(
  executor: Executor,
  workspaceId: string,
  marketSnapshotId: string,
) {
  const [snapshot] = await executor
    .select()
    .from(marketSnapshot)
    .where(
      and(
        inWorkspace(marketSnapshot, workspaceId),
        eq(marketSnapshot.id, marketSnapshotId),
      ),
    );
  if (!snapshot) return null;

  const series = await executor
    .select()
    .from(marketSnapshotSeries)
    .where(
      and(
        inWorkspace(marketSnapshotSeries, workspaceId),
        eq(marketSnapshotSeries.marketSnapshotId, marketSnapshotId),
      ),
    )
    .orderBy(marketSnapshotSeries.position);

  return { snapshot, series };
}
