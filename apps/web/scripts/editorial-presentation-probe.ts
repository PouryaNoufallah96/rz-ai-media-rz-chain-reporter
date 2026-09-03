import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  COPY_VARIANT_TRANSLATION_COMMAND_TYPE,
  type ContentLocale,
  OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
} from "@rz-chain-reporter/contracts";
import { createDb } from "@rz-chain-reporter/db";
import type { Executor } from "@rz-chain-reporter/db/executor";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { analysisRunItem } from "@rz-chain-reporter/db/schema/analysis-run-item";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { copyGeneration } from "@rz-chain-reporter/db/schema/copy-generation";
import { copyGenerationUnit } from "@rz-chain-reporter/db/schema/copy-generation-unit";
import { copyVariant } from "@rz-chain-reporter/db/schema/copy-variant";
import { copyVariantLocalization } from "@rz-chain-reporter/db/schema/copy-variant-localization";
import { copyVariantLocalizationRequest } from "@rz-chain-reporter/db/schema/copy-variant-localization-request";
import { editorialPresentationLocalization } from "@rz-chain-reporter/db/schema/editorial-presentation-localization";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceImport } from "@rz-chain-reporter/db/schema/source-import";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import { workspace } from "@rz-chain-reporter/db/schema/workspace";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { count, eq } from "drizzle-orm";

const childFlag = "--react-server-child";

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
    "presentation probe requires a loopback PostgreSQL target",
  );
  assert.equal(
    target.pathname.slice(1),
    "rz-chain-reporter",
    "presentation probe requires the project-owned database",
  );

  const database = createDb(MIGRATION_DATABASE_URL, { max: 2, pipeline: true });
  const rollback = new Error("EXPECTED_EDITORIAL_PRESENTATION_PROBE_ROLLBACK");
  const ids = {
    analysisOperation: randomUUID(),
    analysisRun: randomUUID(),
    analysisRunItem: randomUUID(),
    analysisUnit: randomUUID(),
    brand: randomUUID(),
    copyEnAttempt: randomUUID(),
    copyEnOperation: randomUUID(),
    copyEnUnit: randomUUID(),
    copyEnVariant: randomUUID(),
    copyFaAttempt: randomUUID(),
    copyFaOperation: randomUUID(),
    copyFaUnit: randomUUID(),
    copyFaVariant: randomUUID(),
    copyTranslationAttempt: randomUUID(),
    copyTranslationOperation: randomUUID(),
    copyTranslationOutbox: randomUUID(),
    draft: randomUUID(),
    localizationAttempt: randomUUID(),
    localizationOperation: randomUUID(),
    selection: randomUUID(),
    source: randomUUID(),
    sourceImport: randomUUID(),
    sourceImportOperation: randomUUID(),
    sourceItem: randomUUID(),
    sourceRevision: randomUUID(),
    workspace: randomUUID(),
  };
  const actorId = `editorial-presentation-probe-${randomUUID()}`;

  try {
    const { readEditorialWorkspace, readPlatformDrafts } = await import(
      "../src/features/editorial/db/queries"
    );

    await assert.rejects(
      database.db.transaction(async (tx) => {
        await tx.insert(user).values({
          id: actorId,
          email: `${actorId}@example.test`,
          name: "Editorial Presentation Probe",
        });
        await tx.insert(workspace).values({
          id: ids.workspace,
          name: `Editorial Presentation Probe ${ids.workspace}`,
        });
        await tx.insert(mediaBrand).values({
          id: ids.brand,
          workspaceId: ids.workspace,
          key: `probe-${ids.brand}`,
          name: "Probe brand",
          sortOrder: 1,
        });
        await tx.insert(source).values({
          id: ids.source,
          workspaceId: ids.workspace,
          articleFetchMode: "direct",
          contentLocale: "en",
          endpoint: "https://presentation.example.test/feed",
          key: `probe-${ids.source}`,
          name: "Pinned source",
          origin: "rss",
        });
        await tx.insert(sourceItem).values({
          id: ids.sourceItem,
          workspaceId: ids.workspace,
          attribution: "Probe",
          contentLocale: "en",
          externalId: `mutable-${ids.sourceItem}`,
          origin: "rss",
          sourceId: ids.source,
          title: "MUTABLE SOURCE ITEM TITLE",
          url: "https://presentation.example.test/mutable",
        });
        await tx.insert(sourceItemRevision).values({
          id: ids.sourceRevision,
          workspaceId: ids.workspace,
          canonicalUrl: "https://presentation.example.test/pinned",
          contentHash: `pinned-${ids.sourceRevision}`,
          contentLocale: "en",
          revisionNumber: 1,
          sourceItemId: ids.sourceItem,
          summary: "Pinned original summary",
          title: "Pinned original title",
        });
        await tx.insert(operation).values([
          {
            id: ids.sourceImportOperation,
            workspaceId: ids.workspace,
            actor: actorId,
            commandType: "probe-source-import",
            idempotencyKey: ids.sourceImportOperation,
            requestHash: ids.sourceImportOperation,
            lifecycle: "succeeded",
          },
          {
            id: ids.analysisOperation,
            workspaceId: ids.workspace,
            actor: actorId,
            commandType: "probe-analysis",
            idempotencyKey: ids.analysisOperation,
            requestHash: ids.analysisOperation,
            lifecycle: "succeeded",
          },
          {
            id: ids.localizationOperation,
            workspaceId: ids.workspace,
            actor: actorId,
            commandType: "probe-localization",
            idempotencyKey: ids.localizationOperation,
            requestHash: ids.localizationOperation,
            lifecycle: "succeeded",
          },
          {
            id: ids.copyEnOperation,
            workspaceId: ids.workspace,
            actor: actorId,
            commandType: "copy-generation:route",
            idempotencyKey: ids.copyEnOperation,
            requestHash: ids.copyEnOperation,
            lifecycle: "succeeded",
          },
          {
            id: ids.copyFaOperation,
            workspaceId: ids.workspace,
            actor: actorId,
            commandType: "copy-generation:regenerate",
            idempotencyKey: ids.copyFaOperation,
            requestHash: ids.copyFaOperation,
            lifecycle: "succeeded",
          },
          {
            id: ids.copyTranslationOperation,
            workspaceId: ids.workspace,
            actor: actorId,
            commandType: COPY_VARIANT_TRANSLATION_COMMAND_TYPE,
            idempotencyKey: ids.copyTranslationOperation,
            requestHash: ids.copyTranslationOperation,
            lifecycle: "running",
          },
        ]);
        await tx.insert(operationAttempt).values([
          {
            id: ids.localizationAttempt,
            workspaceId: ids.workspace,
            operationId: ids.localizationOperation,
            attemptNumber: 1,
            outcome: "succeeded",
          },
          {
            id: ids.copyEnAttempt,
            workspaceId: ids.workspace,
            operationId: ids.copyEnOperation,
            attemptNumber: 1,
            outcome: "succeeded",
          },
          {
            id: ids.copyFaAttempt,
            workspaceId: ids.workspace,
            operationId: ids.copyFaOperation,
            attemptNumber: 1,
            outcome: "succeeded",
          },
          {
            id: ids.copyTranslationAttempt,
            workspaceId: ids.workspace,
            operationId: ids.copyTranslationOperation,
            attemptNumber: 1,
          },
        ]);
        await tx.insert(sourceImport).values({
          id: ids.sourceImport,
          workspaceId: ids.workspace,
          operationId: ids.sourceImportOperation,
          stage: "settled",
          windowHours: 24,
          orderingMode: "views",
          topN: 10,
          topics: ["original topic"],
          effectiveTopics: null,
          enrichmentEnabled: true,
          templateFingerprint: "presentation-probe",
        });
        await tx.insert(analysisRun).values({
          id: ids.analysisRun,
          workspaceId: ids.workspace,
          kind: "news",
          operationId: ids.analysisOperation,
          sourceImportId: ids.sourceImport,
          sourceImportBinding: "reused_settled",
          configuration: {
            kind: "news",
            brands: [`probe-${ids.brand}`],
            models: ["probe-model"],
            platforms: ["x"],
            sourceIds: [ids.source],
            windowHours: 24,
            enrichmentEnabled: true,
            telegramOnly: false,
            orderingMode: "views",
            topN: 10,
            topics: ["original topic"],
          },
          templateFingerprint: "presentation-probe",
          scoringVersion: "presentation-probe-v1",
          semanticStatus: "skipped",
          completedAt: new Date(),
        });
        await tx.insert(analysisRunItem).values({
          id: ids.analysisRunItem,
          workspaceId: ids.workspace,
          analysisRunId: ids.analysisRun,
          sourceItemId: ids.sourceItem,
          sourceItemRevisionId: ids.sourceRevision,
          eligibility: "candidate",
          sourceAuthorityScore: 81,
          freshnessScore: 82,
          policyViralityScore: 83,
          lexicalTopicScore: 84,
          lexicalTopicIndex: 0,
          semanticTopicScore: 85,
          semanticTopicIndex: 0,
          semanticParticipation: "included",
        });
        await tx.insert(analysisModelUnit).values({
          id: ids.analysisUnit,
          workspaceId: ids.workspace,
          analysisRunId: ids.analysisRun,
          mediaBrandId: ids.brand,
          modelOptionKey: "probe-model",
          taskKey: "probe-selection",
          status: "succeeded",
        });
        await tx.insert(editorialSelection).values({
          id: ids.selection,
          workspaceId: ids.workspace,
          analysisModelUnitId: ids.analysisUnit,
          rank: 3,
          sourceItemId: ids.sourceItem,
          suggestedPlatform: "x",
          reasoning: "Original reasoning",
          selectionSuitabilityScore: 91,
          selectionImpactScore: 92,
          selectionViralityScore: 93,
          selectionConfidenceScore: 94,
        });
        await tx.insert(platformDraft).values({
          id: ids.draft,
          workspaceId: ids.workspace,
          mediaBrandId: ids.brand,
          platform: "x",
          editorialSelectionId: ids.selection,
          lanePosition: 1,
        });
        await tx.insert(copyGeneration).values({
          operationId: ids.copyEnOperation,
          workspaceId: ids.workspace,
          platformDraftId: ids.draft,
          requestedContentLocale: "en",
          modelOptionKey: "probe-model",
          sourceItemRevisionId: ids.sourceRevision,
          customerTemplateFingerprint: "presentation-probe",
          brandPolicyFingerprint: "presentation-probe-brand",
          promptVersion: "presentation-probe",
          configurationVersion: "presentation-probe",
        });
        await tx.insert(copyGenerationUnit).values({
          id: ids.copyEnUnit,
          workspaceId: ids.workspace,
          copyGenerationId: ids.copyEnOperation,
          variantKey: "to_the_point",
          status: "succeeded",
          operationAttemptId: ids.copyEnAttempt,
        });
        await tx.insert(copyVariant).values({
          id: ids.copyEnVariant,
          workspaceId: ids.workspace,
          copyGenerationUnitId: ids.copyEnUnit,
          contentLocale: "en",
          headline: "Canonical English headline",
          body: "Canonical English body",
          hashtags: ["#Brand", "#English"],
        });
        const [before, pendingEditorialEn, pendingEditorialFa] =
          await Promise.all([
            readEffectCounts(tx),
            readEditorialWorkspace(
              tx,
              ids.workspace,
              actorId,
              ids.analysisRun,
              "en",
            ),
            readEditorialWorkspace(
              tx,
              ids.workspace,
              actorId,
              ids.analysisRun,
              "fa",
            ),
          ]);
        const pendingEnCard = pendingEditorialEn.modelLanes[0]?.selections[0];
        const pendingFaCard = pendingEditorialFa.modelLanes[0]?.selections[0];
        assert.ok(pendingEnCard && pendingFaCard);
        assert.equal(pendingFaCard.title, "Pinned original title");
        assert.equal(pendingFaCard.summary, "Pinned original summary");
        assert.equal(pendingFaCard.reasoning, "Original reasoning");
        assert.equal(pendingFaCard.presentationReady, false);

        const [pendingPlatformEn, pendingPlatformFa] = await Promise.all([
          readPlatformDrafts(
            tx,
            ids.workspace,
            { analysisRunId: ids.analysisRun },
            actorId,
            false,
            "UTC",
            "en",
          ),
          readPlatformDrafts(
            tx,
            ids.workspace,
            { analysisRunId: ids.analysisRun },
            actorId,
            false,
            "UTC",
            "fa",
          ),
        ]);
        assert.equal(pendingPlatformEn.length, 1);
        const pendingEnDraft = pendingPlatformEn[0]?.card;
        const pendingFaDraft = pendingPlatformFa[0]?.card;
        assert.ok(pendingEnDraft && pendingFaDraft);
        const pendingEnCandidate = pendingEnDraft.candidates[0];
        const pendingFaCandidate = pendingFaDraft.candidates[0];
        assert.ok(pendingEnCandidate && pendingFaCandidate);
        assert.equal(pendingEnCandidate.id, ids.copyEnVariant);
        assert.equal(pendingEnCandidate.contentLocale, "en");
        assert.equal(pendingEnCandidate.translation, null);
        assert.equal(pendingFaCandidate.id, ids.copyEnVariant);
        assert.equal(pendingFaCandidate.contentLocale, "en");
        assert.equal(pendingFaCandidate.translation, null);
        assert.equal(pendingFaDraft.originTitle, "Pinned original title");
        assert.equal(
          pendingFaDraft.originDetails?.summary,
          "Pinned original summary",
        );
        assert.equal(
          pendingFaDraft.originDetails?.reasoning,
          "Original reasoning",
        );
        assert.equal(pendingFaDraft.presentationReady, false);

        await tx.insert(copyVariantLocalizationRequest).values({
          operationId: ids.copyTranslationOperation,
          workspaceId: ids.workspace,
          copyVariantId: ids.copyEnVariant,
          contentLocale: "fa",
        });
        await tx.insert(outboxEvent).values({
          id: ids.copyTranslationOutbox,
          workspaceId: ids.workspace,
          operationId: ids.copyTranslationOperation,
          eventType: OPERATION_COPY_VARIANT_TRANSLATION_REQUESTED_EVENT_NAME,
          schemaVersion: 1,
          payload: {
            schemaVersion: 1,
            workspaceId: ids.workspace,
            operationId: ids.copyTranslationOperation,
          },
          dispatchedAt: new Date(),
        });
        const translatingPlatformFa = await readPlatformDrafts(
          tx,
          ids.workspace,
          { analysisRunId: ids.analysisRun },
          actorId,
          false,
          "UTC",
          "fa",
        );
        const translatingCandidate =
          translatingPlatformFa[0]?.card.candidates[0];
        assert.ok(translatingCandidate?.translation);
        assert.equal(
          translatingCandidate.translation.operationId,
          ids.copyTranslationOperation,
        );
        assert.equal(translatingCandidate.translation.lifecycle, "running");
        assert.equal(
          translatingCandidate.translation.dispatchState,
          "dispatched",
        );

        await tx.insert(copyVariantLocalization).values({
          id: randomUUID(),
          workspaceId: ids.workspace,
          copyVariantId: ids.copyEnVariant,
          contentLocale: "fa",
          operationAttemptId: ids.copyTranslationAttempt,
          headline: "تیتر فارسی تنوع",
          body: "متن فارسی تنوع",
          hashtags: ["#برند", "#فارسی"],
        });
        await tx
          .update(operationAttempt)
          .set({ outcome: "succeeded" })
          .where(eq(operationAttempt.id, ids.copyTranslationAttempt));
        await tx
          .update(operation)
          .set({ lifecycle: "succeeded" })
          .where(eq(operation.id, ids.copyTranslationOperation));
        const localizedPlatformFa = await readPlatformDrafts(
          tx,
          ids.workspace,
          { analysisRunId: ids.analysisRun },
          actorId,
          false,
          "UTC",
          "fa",
        );
        const localizedCandidate = localizedPlatformFa[0]?.card.candidates[0];
        assert.ok(localizedCandidate);
        assert.equal(localizedCandidate.id, ids.copyEnVariant);
        assert.equal(localizedCandidate.contentLocale, "fa");
        assert.equal(localizedCandidate.headline, "تیتر فارسی تنوع");
        assert.equal(localizedCandidate.body, "متن فارسی تنوع");
        assert.deepEqual(localizedCandidate.hashtags, ["#برند", "#فارسی"]);
        assert.equal(localizedCandidate.translation, null);

        await tx.insert(copyGeneration).values({
          operationId: ids.copyFaOperation,
          workspaceId: ids.workspace,
          platformDraftId: ids.draft,
          requestedContentLocale: "fa",
          modelOptionKey: "probe-model",
          sourceItemRevisionId: ids.sourceRevision,
          customerTemplateFingerprint: "presentation-probe",
          brandPolicyFingerprint: "presentation-probe-brand",
          promptVersion: "presentation-probe",
          configurationVersion: "presentation-probe",
        });
        await tx.insert(copyGenerationUnit).values({
          id: ids.copyFaUnit,
          workspaceId: ids.workspace,
          copyGenerationId: ids.copyFaOperation,
          variantKey: "breaking",
          status: "succeeded",
          operationAttemptId: ids.copyFaAttempt,
        });
        await tx.insert(copyVariant).values({
          id: ids.copyFaVariant,
          workspaceId: ids.workspace,
          copyGenerationUnitId: ids.copyFaUnit,
          contentLocale: "fa",
          headline: "تیتر فارسی بومی",
          body: "متن فارسی بومی",
          hashtags: ["#برند", "#بومی"],
        });
        const nativePlatformFa = await readPlatformDrafts(
          tx,
          ids.workspace,
          { analysisRunId: ids.analysisRun },
          actorId,
          false,
          "UTC",
          "fa",
        );
        const nativeFaCandidate = nativePlatformFa[0]?.card.candidates[0];
        assert.ok(nativeFaCandidate);
        assert.equal(nativeFaCandidate.id, ids.copyFaVariant);
        assert.equal(nativeFaCandidate.contentLocale, "fa");
        assert.equal(nativeFaCandidate.headline, "تیتر فارسی بومی");
        assert.equal(nativeFaCandidate.translation, null);

        await tx.insert(editorialPresentationLocalization).values({
          id: randomUUID(),
          workspaceId: ids.workspace,
          sourceItemRevisionId: ids.sourceRevision,
          presentationLocale: "fa",
          operationAttemptId: ids.localizationAttempt,
          title: "عنوان فارسی پین‌شده",
          summary: "خلاصه فارسی پین‌شده",
        });
        const partialEditorialFa = await readEditorialWorkspace(
          tx,
          ids.workspace,
          actorId,
          ids.analysisRun,
          "fa",
        );
        const partialCard = partialEditorialFa.modelLanes[0]?.selections[0];
        assert.ok(partialCard);
        assert.equal(partialCard.title, "Pinned original title");
        assert.equal(partialCard.summary, "Pinned original summary");
        assert.equal(partialCard.reasoning, "Original reasoning");
        assert.equal(partialCard.presentationReady, false);

        await tx.insert(editorialPresentationLocalization).values({
          id: randomUUID(),
          workspaceId: ids.workspace,
          editorialSelectionId: ids.selection,
          presentationLocale: "fa",
          operationAttemptId: ids.localizationAttempt,
          reasoning: "دلیل فارسی",
        });

        const [editorialEn, editorialFa] = await Promise.all([
          readEditorialWorkspace(
            tx,
            ids.workspace,
            actorId,
            ids.analysisRun,
            "en",
          ),
          readEditorialWorkspace(
            tx,
            ids.workspace,
            actorId,
            ids.analysisRun,
            "fa",
          ),
        ]);
        assert.ok(editorialEn.head && editorialFa.head);
        const enCard = editorialEn.modelLanes[0]?.selections[0];
        const faCard = editorialFa.modelLanes[0]?.selections[0];
        assert.ok(enCard && faCard);
        assert.equal(enCard.title, "Pinned original title");
        assert.equal(faCard.title, "عنوان فارسی پین‌شده");
        assert.equal(faCard.summary, "خلاصه فارسی پین‌شده");
        assert.equal(enCard.reasoning, "Original reasoning");
        assert.equal(faCard.reasoning, "دلیل فارسی");
        assert.equal(enCard.presentationReady, true);
        assert.equal(faCard.presentationReady, true);
        assert.deepEqual(nonTextIdentity(faCard), nonTextIdentity(enCard));
        assert.equal(editorialEn.head.topicTranslationFallback, false);
        assert.equal(editorialFa.head.topicTranslationFallback, false);

        const [platformEn, platformFa, exactFa] = await Promise.all([
          readPlatformDrafts(
            tx,
            ids.workspace,
            { analysisRunId: ids.analysisRun },
            actorId,
            false,
            "UTC",
            "en",
          ),
          readPlatformDrafts(
            tx,
            ids.workspace,
            { analysisRunId: ids.analysisRun },
            actorId,
            false,
            "UTC",
            "fa",
          ),
          readPlatformDrafts(
            tx,
            ids.workspace,
            { platformDraftId: ids.draft },
            actorId,
            false,
            "UTC",
            "fa",
          ),
        ]);
        const enDraft = platformEn[0]?.card;
        const faDraft = platformFa[0]?.card;
        const exactFaDraft = exactFa[0]?.card;
        assert.ok(enDraft && faDraft && exactFaDraft);
        assert.equal(enDraft.originTitle, "Pinned original title");
        assert.notEqual(enDraft.originTitle, "MUTABLE SOURCE ITEM TITLE");
        assert.equal(faDraft.originTitle, "عنوان فارسی پین‌شده");
        assert.equal(faDraft.originDetails?.summary, "خلاصه فارسی پین‌شده");
        assert.equal(faDraft.originDetails?.reasoning, "دلیل فارسی");
        assert.equal(enDraft.presentationReady, true);
        assert.equal(faDraft.presentationReady, true);
        assert.equal(exactFaDraft.originTitle, faDraft.originTitle);
        assert.deepEqual(exactFaDraft.originDetails, faDraft.originDetails);
        assert.equal(
          faDraft.originDetails?.canonicalUrl,
          enDraft.originDetails?.canonicalUrl,
        );
        assert.equal(
          faDraft.originDetails?.contentLocale,
          enDraft.originDetails?.contentLocale,
        );
        assert.equal(
          faDraft.originDetails?.sourceName,
          enDraft.originDetails?.sourceName,
        );

        await tx
          .update(sourceImport)
          .set({
            effectiveTopics: {
              contentLocale: "en",
              values: ["original topic"],
              usedOriginalFallback: true,
            },
          })
          .where(eq(sourceImport.id, ids.sourceImport));
        const fallback = await readEditorialWorkspace(
          tx,
          ids.workspace,
          actorId,
          ids.analysisRun,
          "fa",
        );
        assert.equal(fallback.head?.topicTranslationFallback, true);
        assert.deepEqual(await readEffectCounts(tx), before);

        throw rollback;
      }),
      (error: unknown) => error === rollback,
    );

    const residue = await database.db
      .select({ rows: count() })
      .from(workspace)
      .where(eq(workspace.id, ids.workspace));
    assert.equal(residue[0]?.rows, 0);
    console.log(
      "editorial presentation probe passed: original fallback, atomic card-origin bundle, same-id copy localization, durable translation status, native-locale candidate preference, pinned provenance, invariant metadata, topic warning, no read effects, rollback residue 0",
    );
  } finally {
    await database.close();
  }

  function nonTextIdentity(card: {
    canonicalUrl: string;
    confidenceScore: number | null;
    contentLocale: ContentLocale;
    impactScore: number | null;
    rank: number;
    sourceItemId: string;
    sourceName: string;
    sourceOrigin: string;
    suitabilityScore: number | null;
    viralityScore: number | null;
  }) {
    return {
      canonicalUrl: card.canonicalUrl,
      confidenceScore: card.confidenceScore,
      contentLocale: card.contentLocale,
      impactScore: card.impactScore,
      rank: card.rank,
      sourceItemId: card.sourceItemId,
      sourceName: card.sourceName,
      sourceOrigin: card.sourceOrigin,
      suitabilityScore: card.suitabilityScore,
      viralityScore: card.viralityScore,
    };
  }

  async function readEffectCounts(executor: Executor) {
    const [attempts, usage] = await Promise.all([
      executor
        .select({ rows: count() })
        .from(operationAttempt)
        .where(eq(operationAttempt.workspaceId, ids.workspace)),
      executor
        .select({ rows: count() })
        .from(aiUsageEvent)
        .where(eq(aiUsageEvent.workspaceId, ids.workspace)),
    ]);
    return {
      attempts: attempts[0]?.rows ?? 0,
      usage: usage[0]?.rows ?? 0,
    };
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
