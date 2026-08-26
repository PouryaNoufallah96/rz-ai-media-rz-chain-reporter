import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AdmissionOutcome } from "@rz-chain-reporter/contracts";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { eq } from "drizzle-orm";

import { createDb } from "../index";
import {
  findSourceImportSourceUnit,
  persistSourceImportItems,
  recordSourceImportItemRanks,
  reuseSourceImportItems,
  sourceImportHasUsableSource,
  sourceImportProgress,
} from "../repositories/source-import";
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
const database = createDb(MIGRATION_DATABASE_URL, { max: 2 });
const rollback = new Error("EXPECTED_SOURCE_IMPORT_PROBE_ROLLBACK");
const workspaceId = randomUUID();
const actorId = `source-import-probe-${randomUUID()}`;
const sourceId = randomUUID();
const emptySourceId = randomUUID();
const batchSourceId = randomUUID();
const priorOperationId = randomUUID();
const currentOperationId = randomUUID();
const mismatchOperationId = randomUUID();
const priorSourceImportId = randomUUID();
const currentSourceImportId = randomUUID();
const mismatchSourceImportId = randomUUID();
const fixture: readonly {
  admission: AdmissionOutcome;
  expectedAdmission: AdmissionOutcome;
  views: number;
}[] = [
  { admission: "admitted", expectedAdmission: "admitted", views: 500 },
  { admission: "out_of_window", expectedAdmission: "admitted", views: 400 },
  { admission: "over_cap", expectedAdmission: "admitted", views: 300 },
  {
    admission: "skipped_language",
    expectedAdmission: "skipped_language",
    views: 200,
  },
  {
    admission: "skipped_undated",
    expectedAdmission: "skipped_undated",
    views: 100,
  },
];

try {
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await tx.insert(user).values({
        id: actorId,
        email: `${actorId}@example.test`,
        name: "Source Import Probe",
      });
      await tx.insert(workspace).values({
        id: workspaceId,
        name: `Source Import Probe ${workspaceId}`,
      });
      await tx.insert(source).values([
        {
          id: sourceId,
          workspaceId,
          articleFetchMode: "direct",
          contentLocale: "en",
          endpoint: "https://feed.example.test/rss",
          key: `source-import-probe-${sourceId}`,
          name: "Source Import Probe",
          origin: "rss",
        },
        {
          id: emptySourceId,
          workspaceId,
          articleFetchMode: "direct",
          contentLocale: "en",
          endpoint: "https://empty.example.test/rss",
          key: `source-import-probe-${emptySourceId}`,
          name: "Empty Source Import Probe",
          origin: "rss",
        },
        {
          id: batchSourceId,
          workspaceId,
          articleFetchMode: "direct",
          contentLocale: "en",
          endpoint: "https://batch.example.test/rss",
          key: `source-import-probe-${batchSourceId}`,
          name: "Batch Source Import Probe",
          origin: "rss",
        },
      ]);
      await tx.insert(operation).values([
        {
          id: priorOperationId,
          workspaceId,
          actor: actorId,
          commandType: "source-import:probe-prior",
          idempotencyKey: "prior",
          lifecycle: "succeeded",
          requestHash: "prior",
        },
        {
          id: currentOperationId,
          workspaceId,
          actor: actorId,
          commandType: "source-import:probe-current",
          idempotencyKey: "current",
          lifecycle: "running",
          requestHash: "current",
        },
        {
          id: mismatchOperationId,
          workspaceId,
          actor: actorId,
          commandType: "source-import:probe-mismatch",
          idempotencyKey: "mismatch",
          lifecycle: "succeeded",
          requestHash: "mismatch",
        },
      ]);
      await tx.insert(sourceImport).values([
        {
          id: priorSourceImportId,
          workspaceId,
          enrichmentEnabled: true,
          operationId: priorOperationId,
          orderingMode: "latest",
          stage: "settled",
          templateFingerprint: "probe",
          topN: 15,
          topics: [],
          windowHours: 24,
        },
        {
          id: currentSourceImportId,
          workspaceId,
          enrichmentEnabled: true,
          operationId: currentOperationId,
          orderingMode: "latest",
          stage: "acquiring",
          templateFingerprint: "probe",
          topN: 15,
          topics: [],
          windowHours: 48,
        },
        {
          id: mismatchSourceImportId,
          workspaceId,
          enrichmentEnabled: true,
          operationId: mismatchOperationId,
          orderingMode: "latest",
          stage: "settled",
          templateFingerprint: "different-probe",
          topN: 15,
          topics: [],
          windowHours: 48,
        },
      ]);
      await tx.insert(sourceImportSource).values([
        {
          workspaceId,
          admittedCount: fixture.length,
          etag: 'W/"source-import-probe"',
          fetchedCount: fixture.length,
          outcome: "succeeded",
          sourceId,
          sourceImportId: priorSourceImportId,
          startedAt: new Date("2026-08-26T12:00:00.000Z"),
        },
        {
          workspaceId,
          outcome: "pending",
          sourceId,
          sourceImportId: currentSourceImportId,
        },
        {
          workspaceId,
          admittedCount: 0,
          etag: 'W/"empty-source-import-probe"',
          fetchedCount: 0,
          outcome: "succeeded",
          sourceId: emptySourceId,
          sourceImportId: priorSourceImportId,
          startedAt: new Date("2026-08-26T12:00:00.000Z"),
        },
        {
          workspaceId,
          outcome: "pending",
          sourceId: emptySourceId,
          sourceImportId: currentSourceImportId,
        },
        {
          workspaceId,
          outcome: "pending",
          sourceId,
          sourceImportId: mismatchSourceImportId,
        },
      ]);

      const itemIds = fixture.map(() => randomUUID());
      const revisionIds = fixture.map(() => randomUUID());
      await tx.insert(sourceItem).values(
        fixture.map((_, position) => ({
          id: itemIds[position],
          workspaceId,
          attribution: "Source Import Probe",
          contentLocale: "en" as const,
          externalId: `probe-${position}`,
          origin: "rss" as const,
          publishedAt: new Date(`2026-08-26T1${position}:00:00.000Z`),
          sourceId,
          title: `Probe ${position}`,
          url: `https://feed.example.test/${position}`,
        })),
      );
      await tx.insert(sourceItemRevision).values(
        fixture.map((_, position) => ({
          id: revisionIds[position],
          workspaceId,
          canonicalUrl: `https://feed.example.test/${position}`,
          contentHash: `hash-${position}`,
          contentLocale: "en" as const,
          revisionNumber: 1,
          sourceItemId: itemIds[position] ?? "",
          summary: `Summary ${position}`,
          title: `Probe ${position}`,
        })),
      );
      await tx.insert(sourceImportItem).values(
        fixture.map((entry, position) => ({
          workspaceId,
          admission: entry.admission,
          enrichmentOutcome: "failed" as const,
          enrichmentReason: "fetch_failed" as const,
          keywordScore: position / 10,
          rank: position + 1,
          sourceImportId: priorSourceImportId,
          sourceItemId: itemIds[position] ?? "",
          sourceItemRevisionId: revisionIds[position] ?? "",
          views: entry.views,
        })),
      );

      const unit = await findSourceImportSourceUnit(tx, workspaceId, {
        sourceId,
        sourceImportId: currentSourceImportId,
      });
      assert.equal(unit?.priorSourceImportId, priorSourceImportId);

      const mismatchUnit = await findSourceImportSourceUnit(tx, workspaceId, {
        sourceId,
        sourceImportId: mismatchSourceImportId,
      });
      assert.equal(mismatchUnit?.etag, null);
      assert.equal(mismatchUnit?.lastModified, null);
      assert.equal(mismatchUnit?.priorSourceImportId, null);

      const emptyUnit = await findSourceImportSourceUnit(tx, workspaceId, {
        sourceId: emptySourceId,
        sourceImportId: currentSourceImportId,
      });
      assert.equal(emptyUnit?.priorSourceImportId, priorSourceImportId);
      const empty = await reuseSourceImportItems(tx, workspaceId, {
        sourceId: emptySourceId,
        sourceImportId: currentSourceImportId,
        priorSourceImportId,
      });
      assert.deepEqual(empty, {
        admittedCount: 0,
        associatedCount: 0,
        insertedCount: 0,
      });

      const first = await reuseSourceImportItems(tx, workspaceId, {
        sourceId,
        sourceImportId: currentSourceImportId,
        priorSourceImportId,
      });
      assert.deepEqual(first, {
        admittedCount: 3,
        associatedCount: fixture.length,
        insertedCount: fixture.length,
      });

      const replay = await reuseSourceImportItems(tx, workspaceId, {
        sourceId,
        sourceImportId: currentSourceImportId,
        priorSourceImportId,
      });
      assert.deepEqual(replay, {
        admittedCount: 3,
        associatedCount: fixture.length,
        insertedCount: 0,
      });

      const progress = await sourceImportProgress(tx, workspaceId, [
        currentSourceImportId,
      ]);
      assert.equal(progress[currentSourceImportId]?.counts.acquired, 5);
      assert.equal(progress[currentSourceImportId]?.counts.ordered, 3);
      assert.deepEqual(progress[currentSourceImportId]?.admissionMix, {
        admitted: 3,
        skipped_language: 1,
        skipped_undated: 1,
      });

      const reused = await tx
        .select({
          admission: sourceImportItem.admission,
          enrichmentId: sourceImportItem.enrichmentId,
          enrichmentOutcome: sourceImportItem.enrichmentOutcome,
          enrichmentReason: sourceImportItem.enrichmentReason,
          externalId: sourceItem.externalId,
          keywordScore: sourceImportItem.keywordScore,
          rank: sourceImportItem.rank,
          revisionId: sourceImportItem.sourceItemRevisionId,
          views: sourceImportItem.views,
        })
        .from(sourceImportItem)
        .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
        .where(eq(sourceImportItem.sourceImportId, currentSourceImportId))
        .orderBy(sourceItem.externalId);
      assert.equal(reused.length, fixture.length);
      reused.forEach((row, position) => {
        const expected = fixture[position];
        assert.ok(expected);
        assert.equal(row.admission, expected.expectedAdmission);
        assert.equal(row.enrichmentId, null);
        assert.equal(row.enrichmentOutcome, null);
        assert.equal(row.enrichmentReason, null);
        assert.equal(row.externalId, `probe-${position}`);
        assert.equal(row.keywordScore, null);
        assert.equal(row.rank, null);
        assert.equal(row.revisionId, revisionIds[position]);
        assert.equal(row.views, expected.views);
      });

      await recordSourceImportItemRanks(
        tx,
        workspaceId,
        currentSourceImportId,
        itemIds.slice(0, 3).map((sourceItemId, position) => ({
          enrichmentOutcome: position === 0 ? null : ("pending" as const),
          keywordScore: position / 10,
          rank: position + 1,
          sourceItemId,
        })),
      );
      const ranked = await tx
        .select({ rank: sourceImportItem.rank })
        .from(sourceImportItem)
        .where(eq(sourceImportItem.sourceImportId, currentSourceImportId))
        .orderBy(sourceImportItem.rank);
      assert.deepEqual(
        ranked.slice(0, 3).map((entry) => entry.rank),
        [1, 2, 3],
      );

      const batchOneV1 = {
        admission: "admitted" as const,
        attribution: "Batch Source Import Probe",
        canonicalUrl: "https://batch.example.test/one",
        contentHash: "batch-hash-one-v1",
        contentLocale: "en" as const,
        externalId: "batch-one",
        publishedAt: new Date("2026-08-26T12:00:00.000Z"),
        summary: "Batch one version one",
        title: "Batch one",
        views: 10,
      };
      const batchTwoV1 = {
        admission: "admitted" as const,
        attribution: "Batch Source Import Probe",
        canonicalUrl: "https://batch.example.test/two",
        contentHash: "batch-hash-two-v1",
        contentLocale: "en" as const,
        externalId: "batch-two",
        publishedAt: new Date("2026-08-26T12:01:00.000Z"),
        summary: "Batch two version one",
        title: "Batch two",
        views: 20,
      };
      const batchV1 = [batchOneV1, batchTwoV1];
      const batchFirst = await persistSourceImportItems(tx, workspaceId, {
        sourceId: batchSourceId,
        sourceImportId: priorSourceImportId,
        origin: "rss",
        items: batchV1,
      });
      assert.deepEqual(batchFirst, { admittedCount: 2, associatedCount: 2 });
      assert.deepEqual(
        await persistSourceImportItems(tx, workspaceId, {
          sourceId: batchSourceId,
          sourceImportId: priorSourceImportId,
          origin: "rss",
          items: batchV1,
        }),
        batchFirst,
      );

      const batchV2 = [
        {
          ...batchOneV1,
          contentHash: "batch-hash-one-v2",
          summary: "Batch one version two",
        },
        batchTwoV1,
      ];
      assert.deepEqual(
        await persistSourceImportItems(tx, workspaceId, {
          sourceId: batchSourceId,
          sourceImportId: currentSourceImportId,
          origin: "rss",
          items: batchV2,
        }),
        { admittedCount: 2, associatedCount: 2 },
      );
      assert.deepEqual(
        await persistSourceImportItems(tx, workspaceId, {
          sourceId: batchSourceId,
          sourceImportId: mismatchSourceImportId,
          origin: "rss",
          items: [batchOneV1],
        }),
        { admittedCount: 1, associatedCount: 1 },
      );

      const batchOne = await tx
        .select({
          contentHash: sourceItemRevision.contentHash,
          revisionId: sourceItemRevision.id,
          revisionNumber: sourceItemRevision.revisionNumber,
        })
        .from(sourceItemRevision)
        .innerJoin(
          sourceItem,
          eq(sourceItem.id, sourceItemRevision.sourceItemId),
        )
        .where(eq(sourceItem.externalId, "batch-one"))
        .orderBy(sourceItemRevision.revisionNumber);
      assert.deepEqual(
        batchOne.map((revision) => ({
          contentHash: revision.contentHash,
          revisionNumber: revision.revisionNumber,
        })),
        [
          { contentHash: "batch-hash-one-v1", revisionNumber: 1 },
          { contentHash: "batch-hash-one-v2", revisionNumber: 2 },
        ],
      );
      const [reverted] = await tx
        .select({ revisionId: sourceImportItem.sourceItemRevisionId })
        .from(sourceImportItem)
        .innerJoin(sourceItem, eq(sourceItem.id, sourceImportItem.sourceItemId))
        .where(eq(sourceImportItem.sourceImportId, mismatchSourceImportId));
      assert.equal(reverted?.revisionId, batchOne[0]?.revisionId);

      await tx
        .update(sourceImportSource)
        .set({ outcome: "partial" })
        .where(eq(sourceImportSource.sourceImportId, currentSourceImportId));
      assert.equal(
        await sourceImportHasUsableSource(
          tx,
          workspaceId,
          currentSourceImportId,
        ),
        true,
      );

      await tx
        .update(sourceImportSource)
        .set({ outcome: "not_modified" })
        .where(eq(sourceImportSource.sourceImportId, currentSourceImportId));
      await tx
        .update(sourceImportItem)
        .set({ admission: "skipped_language" })
        .where(eq(sourceImportItem.sourceImportId, currentSourceImportId));
      assert.equal(
        await sourceImportHasUsableSource(
          tx,
          workspaceId,
          currentSourceImportId,
        ),
        true,
      );

      await tx
        .delete(sourceImportItem)
        .where(eq(sourceImportItem.sourceImportId, currentSourceImportId));
      assert.equal(
        await sourceImportHasUsableSource(
          tx,
          workspaceId,
          currentSourceImportId,
        ),
        true,
      );
      await tx
        .update(sourceImportSource)
        .set({ outcome: "failed_terminal" })
        .where(eq(sourceImportSource.sourceImportId, currentSourceImportId));
      assert.equal(
        await sourceImportHasUsableSource(
          tx,
          workspaceId,
          currentSourceImportId,
        ),
        false,
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
      admissions: fixture.map((entry) => entry.expectedAdmission),
      acquired: fixture.length,
      associated: fixture.length,
      batchRevisions: [1, 2, 1],
      emptyNotModified: "succeeded-no-op",
      fingerprintMismatchReused: false,
      idempotentReplay: true,
      ordered: 3,
      residue: 0,
      settlement: "successful-empty-or-partial-with-items",
    }),
  );
} finally {
  await database.close();
}
