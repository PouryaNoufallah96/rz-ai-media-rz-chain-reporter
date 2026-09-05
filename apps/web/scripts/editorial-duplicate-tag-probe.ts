import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDb } from "@rz-chain-reporter/db";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { analysisRunItem } from "@rz-chain-reporter/db/schema/analysis-run-item";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, eq, isNotNull, sql } from "drizzle-orm";

const childFlag = "--react-server-child";

// D14 and D15 are reciprocal halves of one dedup contract.
async function main() {
  if (!process.argv.includes(childFlag)) {
    const child = spawnSync(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        childFlag,
      ],
      { env: process.env, stdio: "inherit" },
    );
    process.exitCode = child.status ?? 1;
    return;
  }

  dotenv.config({ path: "../../.env.migration" });

  const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
  const target = new URL(MIGRATION_DATABASE_URL);
  assert.ok(
    target.hostname === "127.0.0.1" || target.hostname === "localhost",
    "duplicate tag probe requires a loopback PostgreSQL target",
  );
  assert.equal(
    target.pathname.slice(1),
    "rz-chain-reporter",
    "duplicate tag probe requires the project-owned database",
  );

  const { readEditorialWorkspace } = await import(
    "../src/features/editorial/db/queries"
  );
  const { close, db } = createDb(MIGRATION_DATABASE_URL);

  try {
    const [collapsed] = await db
      .select({
        analysisRunId: analysisRunItem.analysisRunId,
        workspaceId: analysisRunItem.workspaceId,
        survivorSourceItemId: analysisRunItem.duplicateOfSourceItemId,
      })
      .from(analysisRunItem)
      .innerJoin(sourceItem, eq(sourceItem.id, analysisRunItem.sourceItemId))
      .innerJoin(
        editorialSelection,
        and(
          eq(
            editorialSelection.sourceItemId,
            analysisRunItem.duplicateOfSourceItemId,
          ),
          eq(editorialSelection.workspaceId, analysisRunItem.workspaceId),
        ),
      )
      .where(
        and(
          eq(analysisRunItem.eligibility, "duplicate"),
          isNotNull(analysisRunItem.duplicateOfSourceItemId),
          eq(sourceItem.origin, "telegram_public"),
        ),
      )
      .limit(1);

    if (!collapsed?.survivorSourceItemId) {
      process.stdout.write(
        "SKIP editorial duplicate tag: no Telegram item collapsed into an editorial selection\n",
      );
      return;
    }

    const [run] = await db
      .select({ actor: operation.actor })
      .from(analysisRun)
      .innerJoin(operation, eq(operation.id, analysisRun.operationId))
      .where(eq(analysisRun.id, collapsed.analysisRunId))
      .limit(1);
    assert.ok(run?.actor, "collapsed run has no operation actor");

    const [expected] = await db
      .select({ rows: sql<number>`count(*)::int` })
      .from(analysisRunItem)
      .innerJoin(sourceItem, eq(sourceItem.id, analysisRunItem.sourceItemId))
      .where(
        and(
          eq(analysisRunItem.analysisRunId, collapsed.analysisRunId),
          eq(
            analysisRunItem.duplicateOfSourceItemId,
            collapsed.survivorSourceItemId,
          ),
          eq(sourceItem.origin, "telegram_public"),
        ),
      );
    assert.ok((expected?.rows ?? 0) > 0, "fixture lost its Telegram duplicate");

    const workspace = await readEditorialWorkspace(
      db,
      collapsed.workspaceId,
      run.actor,
      collapsed.analysisRunId,
      "en",
    );
    assert.ok(workspace, "editorial workspace did not load");

    const survivors = workspace.modelLanes.flatMap((lane) =>
      lane.selections.filter(
        (card) => card.sourceItemId === collapsed.survivorSourceItemId,
      ),
    );
    assert.ok(
      survivors.length > 0,
      "surviving selection is absent from every model lane",
    );

    for (const survivor of survivors) {
      assert.equal(
        survivor.duplicateTelegramCount,
        expected?.rows,
        "surviving RSS selection does not name the Telegram duplicates it absorbed",
      );
    }

    const collapsedOnBoard = workspace.telegramLanes.flatMap((lane) =>
      lane.cards.filter(
        (card) => card.sourceItemId === collapsed.survivorSourceItemId,
      ),
    );
    assert.equal(
      collapsedOnBoard.length,
      0,
      "one surviving story produced both an RSS and a Telegram card",
    );

    process.stdout.write(
      `PASS editorial duplicate tag (${survivors.length} survivor card(s), ${expected?.rows} Telegram duplicate(s))\n`,
    );
  } finally {
    await close();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
