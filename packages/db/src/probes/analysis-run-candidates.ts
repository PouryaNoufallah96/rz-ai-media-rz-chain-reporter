import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, eq } from "drizzle-orm";

import { createDb } from "../index";
import { loadAnalysisRunCandidates } from "../repositories/analysis-run";
import { analysisRun } from "../schema/analysis-run";
import { analysisRunItem } from "../schema/analysis-run-item";
import { user } from "../schema/auth";
import { operation } from "../schema/operation";
import { source } from "../schema/source";
import { sourceImport } from "../schema/source-import";
import { sourceImportItem } from "../schema/source-import-item";
import { sourceImportSource } from "../schema/source-import-source";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 2, pipeline: true });
const rollback = new Error("EXPECTED_ANALYSIS_RUN_CANDIDATES_PROBE_ROLLBACK");
const workspaceId = randomUUID();
const actorId = `analysis-run-candidates-probe-${randomUUID()}`;
const operationId = randomUUID();
const analysisRunId = randomUUID();
const sourceImportId = randomUUID();
const publishedAt = new Date("2026-08-26T12:00:00.000Z");
const windowStart = new Date("2026-08-26T00:00:00.000Z");

// The import is a superset of the run's selection: two selected sources and two
// the operator left unchecked, one of each origin.
const fixture = [
  { key: "selected-rss", origin: "rss" as const, selected: true },
  {
    key: "selected-telegram",
    origin: "telegram_public" as const,
    selected: true,
  },
  { key: "unselected-rss", origin: "rss" as const, selected: false },
  {
    key: "unselected-telegram",
    origin: "telegram_public" as const,
    selected: false,
  },
].map((entry) => ({
  ...entry,
  sourceId: randomUUID(),
  sourceItemId: randomUUID(),
  sourceItemRevisionId: randomUUID(),
}));
const selectedSourceIds = fixture
  .filter((entry) => entry.selected)
  .map((entry) => entry.sourceId);

try {
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: actorId,
        email: `${actorId}@example.test`,
        name: "Analysis Run Candidates Probe",
      });
      await tx.insert(workspace).values({
        id: workspaceId,
        name: `Analysis Run Candidates Probe ${workspaceId}`,
      });
      await tx.insert(source).values(
        fixture.map((entry) => ({
          id: entry.sourceId,
          workspaceId,
          articleFetchMode: "direct" as const,
          contentLocale: "en" as const,
          endpoint: `https://${entry.key}.example.test/feed`,
          key: `analysis-run-candidates-probe-${entry.sourceId}`,
          name: entry.key,
          origin: entry.origin,
        })),
      );
      await tx.insert(operation).values({
        id: operationId,
        workspaceId,
        actor: actorId,
        commandType: "analysis-run:probe",
        idempotencyKey: `analysis-run-candidates-${operationId}`,
        lifecycle: "running",
        requestHash: "analysis-run-candidates",
      });
      await tx.insert(sourceImport).values({
        id: sourceImportId,
        workspaceId,
        enrichmentEnabled: true,
        operationId,
        orderingMode: "latest",
        stage: "settled",
        templateFingerprint: "probe",
        topN: 15,
        topics: [],
        windowHours: 24,
      });
      await tx.insert(sourceImportSource).values(
        fixture.map((entry) => ({
          workspaceId,
          admittedCount: 1,
          fetchedCount: 1,
          outcome: "succeeded" as const,
          sourceId: entry.sourceId,
          sourceImportId,
          startedAt: publishedAt,
        })),
      );
      await tx.insert(sourceItem).values(
        fixture.map((entry) => ({
          id: entry.sourceItemId,
          workspaceId,
          attribution: entry.key,
          contentLocale: "en" as const,
          externalId: `analysis-run-candidates-${entry.key}`,
          origin: entry.origin,
          publishedAt,
          sourceId: entry.sourceId,
          title: entry.key,
          url: `https://${entry.key}.example.test/1`,
        })),
      );
      await tx.insert(sourceItemRevision).values(
        fixture.map((entry) => ({
          id: entry.sourceItemRevisionId,
          workspaceId,
          canonicalUrl: `https://${entry.key}.example.test/1`,
          contentHash: `hash-${entry.key}`,
          contentLocale: "en" as const,
          revisionNumber: 1,
          sourceItemId: entry.sourceItemId,
          summary: `Summary ${entry.key}`,
          title: entry.key,
        })),
      );
      await tx.insert(sourceImportItem).values(
        fixture.map((entry, position) => ({
          workspaceId,
          admission: "admitted" as const,
          rank: position + 1,
          sourceImportId,
          sourceItemId: entry.sourceItemId,
          sourceItemRevisionId: entry.sourceItemRevisionId,
        })),
      );
      await tx.insert(analysisRun).values({
        id: analysisRunId,
        workspaceId,
        kind: "news",
        operationId,
        sourceImportId,
        sourceImportBinding: "reused_settled",
        configuration: {
          kind: "news",
          brands: ["probe-brand"],
          models: ["probe"],
          platforms: ["telegram"],
          sourceIds: selectedSourceIds,
          windowHours: 24,
          enrichmentEnabled: true,
          telegramOnly: false,
          orderingMode: "latest",
          topN: 15,
          topics: [],
        },
        semanticStatus: "skipped",
        templateFingerprint: "probe",
      });

      const loaded = await loadAnalysisRunCandidates(tx, workspaceId, {
        analysisRunId,
        sourceImportId,
        sourceIds: selectedSourceIds,
        windowStart,
      });
      assert.equal(loaded, selectedSourceIds.length);

      const admitted = await tx
        .select({ key: source.key, origin: source.origin })
        .from(analysisRunItem)
        .innerJoin(sourceItem, eq(sourceItem.id, analysisRunItem.sourceItemId))
        .innerJoin(source, eq(source.id, sourceItem.sourceId))
        .where(
          and(
            eq(analysisRunItem.workspaceId, workspaceId),
            eq(analysisRunItem.analysisRunId, analysisRunId),
          ),
        );
      assert.deepEqual(
        admitted.map((row) => row.key).sort(),
        fixture
          .filter((entry) => entry.selected)
          .map((entry) => `analysis-run-candidates-probe-${entry.sourceId}`)
          .sort(),
      );
      assert.deepEqual(admitted.map((row) => row.origin).sort(), [
        "rss",
        "telegram_public",
      ]);

      assert.equal(
        await loadAnalysisRunCandidates(tx, workspaceId, {
          analysisRunId,
          sourceImportId,
          sourceIds: selectedSourceIds,
          windowStart,
        }),
        selectedSourceIds.length,
      );

      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );

  const residue = await database.db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, workspaceId));
  assert.equal(residue.length, 0);
  console.log(
    JSON.stringify({
      importSources: fixture.length,
      selectedSources: selectedSourceIds.length,
      loadedCandidates: selectedSourceIds.length,
      leakedSources: 0,
      replayIdempotent: true,
      residue: 0,
    }),
  );
} finally {
  await database.close();
}
