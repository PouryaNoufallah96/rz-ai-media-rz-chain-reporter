import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { eq, sql } from "drizzle-orm";
import { DatabaseError } from "pg";

import type { Transaction } from "../executor";
import { createDb } from "../index";
import {
  persistEditorialPresentationLocalizations,
  readEditorialPresentationLocalizations,
} from "../repositories/editorial-presentation-localization";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { user } from "../schema/auth";
import { editorialPresentationLocalization } from "../schema/editorial-presentation-localization";
import { editorialSelection } from "../schema/editorial-selection";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { promoIdea } from "../schema/promo-idea";
import { source } from "../schema/source";
import { sourceItem } from "../schema/source-item";
import { sourceItemRevision } from "../schema/source-item-revision";
import { workspace } from "../schema/workspace";

dotenv.config({ path: "../../.env.migration" });

const { MIGRATION_DATABASE_URL } = validateMigrationEnv(process.env);
const database = createDb(MIGRATION_DATABASE_URL, { max: 2 });
const rollback = new Error("EXPECTED_PRESENTATION_LOCALIZATION_PROBE_ROLLBACK");
const ids = {
  workspace: randomUUID(),
  source: randomUUID(),
  sourceItem: randomUUID(),
  sourceRevision: randomUUID(),
  mediaBrand: randomUUID(),
  operation: randomUUID(),
  firstAttempt: randomUUID(),
  secondAttempt: randomUUID(),
  analysisRun: randomUUID(),
  analysisUnit: randomUUID(),
  editorialSelection: randomUUID(),
  promoIdea: randomUUID(),
};
const actorId = `presentation-localization-probe-${randomUUID()}`;

try {
  await assert.rejects(
    database.db.transaction(async (tx) => {
      await insertFixture(tx);

      const first = await persistEditorialPresentationLocalizations(
        tx,
        ids.workspace,
        firstInputs(ids.firstAttempt),
      );
      assert.equal(first.length, 3);
      assert.ok(
        first.every((row) => row.operationAttemptId === ids.firstAttempt),
      );

      const replay = await persistEditorialPresentationLocalizations(
        tx,
        ids.workspace,
        replayInputs(ids.secondAttempt),
      );
      assert.equal(replay.length, 3);
      assert.deepEqual(
        replay.map((row) => row.id).sort(),
        first.map((row) => row.id).sort(),
      );
      assert.ok(
        replay.every((row) => row.operationAttemptId === ids.firstAttempt),
      );
      assert.equal(
        replay.find((row) => row.sourceItemRevisionId)?.title,
        "عنوان فارسی",
      );
      assert.equal(
        replay.find((row) => row.editorialSelectionId)?.reasoning,
        "دلیل فارسی",
      );
      assert.equal(
        replay.find((row) => row.promoIdeaId)?.description,
        "توضیح فارسی",
      );

      const read = await readEditorialPresentationLocalizations(
        tx,
        ids.workspace,
        [
          {
            kind: "source_item_revision",
            sourceItemRevisionId: ids.sourceRevision,
            presentationLocale: "fa",
          },
          {
            kind: "editorial_selection",
            editorialSelectionId: ids.editorialSelection,
            presentationLocale: "fa",
          },
          {
            kind: "promo_idea",
            promoIdeaId: ids.promoIdea,
            presentationLocale: "fa",
          },
        ],
      );
      assert.equal(read.length, 3);

      await expectConstraint(
        tx,
        "ck_editorial_presentation_localization_exactly_one_subject",
        () =>
          tx.insert(editorialPresentationLocalization).values({
            workspaceId: ids.workspace,
            sourceItemRevisionId: ids.sourceRevision,
            promoIdeaId: ids.promoIdea,
            presentationLocale: "en",
            operationAttemptId: ids.secondAttempt,
            title: "Valid source title",
          }),
      );
      await expectConstraint(
        tx,
        "ck_editorial_presentation_localization_payload_shape",
        () =>
          tx.insert(editorialPresentationLocalization).values({
            workspaceId: ids.workspace,
            sourceItemRevisionId: ids.sourceRevision,
            presentationLocale: "en",
            operationAttemptId: ids.secondAttempt,
            title: " ",
          }),
      );
      await expectConstraint(
        tx,
        "ck_editorial_presentation_localization_payload_shape",
        () =>
          tx.insert(editorialPresentationLocalization).values({
            workspaceId: ids.workspace,
            sourceItemRevisionId: ids.sourceRevision,
            presentationLocale: "en",
            operationAttemptId: ids.secondAttempt,
            title: "Valid source title",
            summary: " ",
          }),
      );
      await expectConstraint(
        tx,
        "ck_editorial_presentation_localization_payload_shape",
        () =>
          tx.insert(editorialPresentationLocalization).values({
            workspaceId: ids.workspace,
            editorialSelectionId: ids.editorialSelection,
            presentationLocale: "en",
            operationAttemptId: ids.secondAttempt,
            reasoning: " ",
          }),
      );
      await expectConstraint(
        tx,
        "ck_editorial_presentation_localization_payload_shape",
        () =>
          tx.insert(editorialPresentationLocalization).values({
            workspaceId: ids.workspace,
            promoIdeaId: ids.promoIdea,
            presentationLocale: "en",
            operationAttemptId: ids.secondAttempt,
            title: "Promo title",
            description: " ",
            angle: "Promo angle",
          }),
      );

      for (const [constraint, values] of [
        [
          "uq_editorial_presentation_localization_source_revision_locale",
          {
            workspaceId: ids.workspace,
            sourceItemRevisionId: ids.sourceRevision,
            presentationLocale: "fa" as const,
            operationAttemptId: ids.secondAttempt,
            title: "Duplicate source title",
          },
        ],
        [
          "uq_editorial_presentation_localization_selection_locale",
          {
            workspaceId: ids.workspace,
            editorialSelectionId: ids.editorialSelection,
            presentationLocale: "fa" as const,
            operationAttemptId: ids.secondAttempt,
            reasoning: "Duplicate reasoning",
          },
        ],
        [
          "uq_editorial_presentation_localization_promo_idea_locale",
          {
            workspaceId: ids.workspace,
            promoIdeaId: ids.promoIdea,
            presentationLocale: "fa" as const,
            operationAttemptId: ids.secondAttempt,
            title: "Duplicate promo",
            description: "Duplicate description",
            angle: "Duplicate angle",
          },
        ],
      ] as const) {
        await expectConstraint(tx, constraint, () =>
          tx.insert(editorialPresentationLocalization).values(values),
        );
      }

      await expectConstraint(
        tx,
        "fk_editorial_presentation_localization_source_item_revision_id",
        () =>
          tx
            .delete(sourceItemRevision)
            .where(eq(sourceItemRevision.id, ids.sourceRevision)),
      );
      await expectConstraint(
        tx,
        "fk_editorial_presentation_localization_editorial_selection_id",
        () =>
          tx
            .delete(editorialSelection)
            .where(eq(editorialSelection.id, ids.editorialSelection)),
      );
      await expectConstraint(
        tx,
        "fk_editorial_presentation_localization_promo_idea_id",
        () => tx.delete(promoIdea).where(eq(promoIdea.id, ids.promoIdea)),
      );
      await expectConstraint(
        tx,
        "fk_editorial_presentation_localization_operation_attempt_id",
        () =>
          tx
            .delete(operationAttempt)
            .where(eq(operationAttempt.id, ids.firstAttempt)),
      );

      throw rollback;
    }),
    (error: unknown) => error === rollback,
  );

  const residue = await database.db
    .select({ id: workspace.id })
    .from(workspace)
    .where(eq(workspace.id, ids.workspace));
  assert.equal(residue.length, 0);
  console.log(
    JSON.stringify({
      conflictSafeReuse: true,
      immutableRows: 3,
      partialUniqueConstraints: 3,
      payloadBranches: 3,
      restrictForeignKeys: 4,
      residue: 0,
    }),
  );
} finally {
  await database.close();
}

async function insertFixture(tx: Transaction) {
  await tx.insert(user).values({
    id: actorId,
    email: `${actorId}@example.test`,
    name: "Presentation Localization Probe",
  });
  await tx.insert(workspace).values({
    id: ids.workspace,
    name: `Presentation Localization Probe ${ids.workspace}`,
  });
  await tx.insert(source).values({
    id: ids.source,
    workspaceId: ids.workspace,
    articleFetchMode: "direct",
    contentLocale: "en",
    endpoint: "https://localization.example.test/rss",
    key: `presentation-localization-${ids.source}`,
    name: "Presentation Localization Probe",
    origin: "rss",
  });
  await tx.insert(sourceItem).values({
    id: ids.sourceItem,
    workspaceId: ids.workspace,
    attribution: "Presentation Localization Probe",
    contentLocale: "en",
    externalId: "presentation-localization-probe",
    origin: "rss",
    sourceId: ids.source,
    title: "Authoritative source title",
    url: "https://localization.example.test/item",
  });
  await tx.insert(sourceItemRevision).values({
    id: ids.sourceRevision,
    workspaceId: ids.workspace,
    canonicalUrl: "https://localization.example.test/item",
    contentHash: "presentation-localization-probe",
    contentLocale: "en",
    revisionNumber: 1,
    sourceItemId: ids.sourceItem,
    summary: "Authoritative source summary",
    title: "Authoritative source title",
  });
  await tx.insert(mediaBrand).values({
    id: ids.mediaBrand,
    workspaceId: ids.workspace,
    key: `presentation-localization-${ids.mediaBrand}`,
    name: "Presentation Localization Probe",
    sortOrder: 1,
  });
  await tx.insert(operation).values({
    id: ids.operation,
    workspaceId: ids.workspace,
    actor: actorId,
    commandType: "presentation-localization-probe",
    idempotencyKey: "presentation-localization-probe",
    requestHash: "presentation-localization-probe",
    lifecycle: "succeeded",
  });
  await tx.insert(operationAttempt).values([
    {
      id: ids.firstAttempt,
      workspaceId: ids.workspace,
      operationId: ids.operation,
      attemptNumber: 1,
      outcome: "succeeded",
    },
    {
      id: ids.secondAttempt,
      workspaceId: ids.workspace,
      operationId: ids.operation,
      attemptNumber: 2,
      outcome: "succeeded",
    },
  ]);
  await tx.insert(analysisRun).values({
    id: ids.analysisRun,
    workspaceId: ids.workspace,
    kind: "promo",
    operationId: ids.operation,
    configuration: {
      kind: "promo",
      models: ["probe"],
      platforms: ["x"],
      promo: {
        brands: [`presentation-localization-${ids.mediaBrand}`],
        prompts: {
          [`presentation-localization-${ids.mediaBrand}`]: "Synthetic probe",
        },
      },
    },
    semanticStatus: "skipped",
    templateFingerprint: "presentation-localization-probe",
  });
  await tx.insert(analysisModelUnit).values({
    id: ids.analysisUnit,
    workspaceId: ids.workspace,
    analysisRunId: ids.analysisRun,
    mediaBrandId: ids.mediaBrand,
    modelOptionKey: "probe",
    taskKey: "promo-ideas:probe",
    status: "succeeded",
  });
  await tx.insert(editorialSelection).values({
    id: ids.editorialSelection,
    workspaceId: ids.workspace,
    analysisModelUnitId: ids.analysisUnit,
    rank: 1,
    reasoning: "Authoritative reasoning",
    sourceItemId: ids.sourceItem,
    suggestedPlatform: "x",
  });
  await tx.insert(promoIdea).values({
    id: ids.promoIdea,
    workspaceId: ids.workspace,
    analysisModelUnitId: ids.analysisUnit,
    rank: 1,
    title: "Authoritative promo title",
    description: "Authoritative promo description",
    angle: "Authoritative promo angle",
  });
}

function firstInputs(operationAttemptId: string) {
  return [
    {
      kind: "source_item_revision" as const,
      sourceItemRevisionId: ids.sourceRevision,
      presentationLocale: "fa" as const,
      operationAttemptId,
      title: "عنوان فارسی",
      summary: "خلاصه فارسی",
    },
    {
      kind: "editorial_selection" as const,
      editorialSelectionId: ids.editorialSelection,
      presentationLocale: "fa" as const,
      operationAttemptId,
      reasoning: "دلیل فارسی",
    },
    {
      kind: "promo_idea" as const,
      promoIdeaId: ids.promoIdea,
      presentationLocale: "fa" as const,
      operationAttemptId,
      title: "ایده فارسی",
      description: "توضیح فارسی",
      angle: "زاویه فارسی",
    },
  ];
}

function replayInputs(operationAttemptId: string) {
  return firstInputs(operationAttemptId).map((input) => {
    switch (input.kind) {
      case "source_item_revision":
        return { ...input, title: "Must not replace source title" };
      case "editorial_selection":
        return { ...input, reasoning: "Must not replace reasoning" };
      case "promo_idea":
        return { ...input, description: "Must not replace promo description" };
    }
    throw new Error("unsupported presentation localization subject");
  });
}

async function expectConstraint(
  tx: Transaction,
  constraint: string,
  action: () => Promise<unknown>,
) {
  await tx.execute(sql.raw("savepoint expected_localization_failure"));
  try {
    await action();
  } catch (error) {
    await tx.execute(
      sql.raw("rollback to savepoint expected_localization_failure"),
    );
    await tx.execute(
      sql.raw("release savepoint expected_localization_failure"),
    );
    if (constraintName(error) === constraint) return;
    throw error;
  }
  await tx.execute(
    sql.raw("rollback to savepoint expected_localization_failure"),
  );
  await tx.execute(sql.raw("release savepoint expected_localization_failure"));
  throw new Error(`${constraint} accepted an invalid mutation`);
}

function constraintName(error: unknown) {
  let current = error;
  while (current instanceof Error) {
    if (current instanceof DatabaseError) return current.constraint;
    current = current.cause;
  }
  return undefined;
}
