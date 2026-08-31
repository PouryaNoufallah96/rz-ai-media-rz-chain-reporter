import { fileURLToPath } from "node:url";
import { notifyCacheInvalidation } from "@rz-chain-reporter/cache-invalidation";
import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { loadCustomerTemplate } from "@rz-chain-reporter/customer-template/load";
import { validateMigrationEnv } from "@rz-chain-reporter/env/migration";
import dotenv from "dotenv";
import { and, asc, eq, isNull } from "drizzle-orm";

import { notDeleted } from "../filters";
import { createDb } from "../index";
import { reconcileCustomerTemplate } from "../reconcile/customer-template";
import { formatReconcileReport } from "../reconcile/report";
import { analysisModelUnit } from "../schema/analysis-model-unit";
import { analysisRun } from "../schema/analysis-run";
import { user } from "../schema/auth";
import { copyGeneration } from "../schema/copy-generation";
import { copyGenerationUnit } from "../schema/copy-generation-unit";
import { copyVariant } from "../schema/copy-variant";
import { draftRevision } from "../schema/draft-revision";
import { mediaBrand } from "../schema/media-brand";
import { operation } from "../schema/operation";
import { operationAttempt } from "../schema/operation-attempt";
import { platformDraft } from "../schema/platform-draft";
import { promoIdea } from "../schema/promo-idea";
import { workspace } from "../schema/workspace";
import { DEV_DRAFT_REVISION_ID, DEV_PLATFORM_DRAFT_ID } from "./dev-draft";

const DEV_TEMPLATE_KEY = "crypto";
const DEV_DRAFT_BRAND_KEY = "chain-reporter";
const DEV_ANALYSIS_OPERATION_ID = "019b76da-a800-7000-8000-000000000004";
const DEV_ANALYSIS_RUN_ID = "019b76da-a800-7000-8000-000000000005";
const DEV_ANALYSIS_MODEL_UNIT_ID = "019b76da-a800-7000-8000-000000000006";
const DEV_PROMO_IDEA_ID = "019b76da-a800-7000-8000-000000000007";
const DEV_COPY_OPERATION_ID = "019b76da-a800-7000-8000-000000000008";
const DEV_COPY_ATTEMPT_ID = "019b76da-a800-7000-8000-000000000009";
const DEV_COPY_UNIT_ID = "019b76da-a800-7000-8000-00000000000a";
const DEV_COPY_VARIANT_ID = "019b76da-a800-7000-8000-00000000000b";

dotenv.config({
  path: "../../.env.migration",
});

const migrationEnv = validateMigrationEnv(process.env);

if (migrationEnv.NODE_ENV === "production") {
  throw new Error("dev seed refused outside development");
}

const repositoryRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const database = createDb(migrationEnv.MIGRATION_DATABASE_URL);

try {
  const loaded = loadCustomerTemplate(repositoryRoot, DEV_TEMPLATE_KEY);
  const report = await reconcileCustomerTemplate(database.db, loaded, "apply");

  console.log(formatReconcileReport(report));

  const [brand] = await database.db
    .select({
      id: mediaBrand.id,
      key: mediaBrand.key,
      workspaceId: mediaBrand.workspaceId,
    })
    .from(mediaBrand)
    .innerJoin(workspace, eq(workspace.id, mediaBrand.workspaceId))
    .where(
      and(
        eq(workspace.customerTemplateKey, DEV_TEMPLATE_KEY),
        eq(mediaBrand.key, DEV_DRAFT_BRAND_KEY),
        notDeleted(mediaBrand),
      ),
    );
  const [actor] = await database.db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);

  if (!brand || !actor) {
    throw new Error(
      "dev seed requires a live media brand and operator account",
    );
  }

  await database.db.transaction(async (tx) => {
    await tx
      .insert(operation)
      .values({
        id: DEV_ANALYSIS_OPERATION_ID,
        workspaceId: brand.workspaceId,
        actor: actor.id,
        commandType: "dev-analysis-run",
        idempotencyKey: "dev-analysis-run",
        requestHash: "dev-analysis-run",
        lifecycle: "succeeded",
      })
      .onConflictDoNothing({ target: operation.id });
    await tx
      .insert(analysisRun)
      .values({
        id: DEV_ANALYSIS_RUN_ID,
        workspaceId: brand.workspaceId,
        kind: "promo",
        operationId: DEV_ANALYSIS_OPERATION_ID,
        configuration: {
          kind: "promo",
          models: ["dev"],
          platforms: ["telegram"],
          promo: {
            brands: [brand.key],
            prompts: { [brand.key]: "Synthetic dev prompt" },
          },
        },
        templateFingerprint: "dev",
        semanticStatus: "skipped",
      })
      .onConflictDoNothing({ target: analysisRun.id });
    await tx
      .insert(analysisModelUnit)
      .values({
        id: DEV_ANALYSIS_MODEL_UNIT_ID,
        workspaceId: brand.workspaceId,
        analysisRunId: DEV_ANALYSIS_RUN_ID,
        mediaBrandId: brand.id,
        modelOptionKey: "dev",
        taskKey: "promo",
        status: "pending",
      })
      .onConflictDoNothing({ target: analysisModelUnit.id });
    await tx
      .insert(promoIdea)
      .values({
        id: DEV_PROMO_IDEA_ID,
        workspaceId: brand.workspaceId,
        analysisModelUnitId: DEV_ANALYSIS_MODEL_UNIT_ID,
        rank: 1,
        title: "Synthetic dev promo",
        description: "Synthetic dev description",
        angle: "Synthetic dev angle",
      })
      .onConflictDoNothing({ target: promoIdea.id });
    await tx
      .insert(platformDraft)
      .values({
        id: DEV_PLATFORM_DRAFT_ID,
        workspaceId: brand.workspaceId,
        mediaBrandId: brand.id,
        platform: "telegram",
        promoIdeaId: DEV_PROMO_IDEA_ID,
        lanePosition: 1,
      })
      .onConflictDoNothing({ target: platformDraft.id });
    await tx
      .insert(operation)
      .values({
        id: DEV_COPY_OPERATION_ID,
        workspaceId: brand.workspaceId,
        actor: actor.id,
        commandType: "dev-copy-generation",
        idempotencyKey: "dev-copy-generation",
        requestHash: "dev-copy-generation",
        lifecycle: "succeeded",
      })
      .onConflictDoNothing({ target: operation.id });
    await tx
      .insert(copyGeneration)
      .values({
        operationId: DEV_COPY_OPERATION_ID,
        workspaceId: brand.workspaceId,
        platformDraftId: DEV_PLATFORM_DRAFT_ID,
        requestedContentLocale: "en",
        modelOptionKey: "dev",
        customerTemplateFingerprint: "dev",
        brandPolicyFingerprint: "dev",
        promptVersion: "dev",
        configurationVersion: "dev",
      })
      .onConflictDoNothing({ target: copyGeneration.operationId });
    await tx
      .insert(operationAttempt)
      .values({
        id: DEV_COPY_ATTEMPT_ID,
        workspaceId: brand.workspaceId,
        operationId: DEV_COPY_OPERATION_ID,
        attemptNumber: 1,
        outcome: "succeeded",
      })
      .onConflictDoNothing({ target: operationAttempt.id });
    await tx
      .insert(copyGenerationUnit)
      .values({
        id: DEV_COPY_UNIT_ID,
        workspaceId: brand.workspaceId,
        copyGenerationId: DEV_COPY_OPERATION_ID,
        variantKey: "dev",
        status: "succeeded",
        operationAttemptId: DEV_COPY_ATTEMPT_ID,
      })
      .onConflictDoNothing({ target: copyGenerationUnit.id });
    await tx
      .insert(copyVariant)
      .values({
        id: DEV_COPY_VARIANT_ID,
        workspaceId: brand.workspaceId,
        copyGenerationUnitId: DEV_COPY_UNIT_ID,
        contentLocale: "en",
        headline: "Dev draft revision",
        body: "Synthetic dev copy for the publish command.",
        hashtags: ["#dev"],
      })
      .onConflictDoNothing({ target: copyVariant.id });
    await tx
      .insert(draftRevision)
      .values({
        id: DEV_DRAFT_REVISION_ID,
        workspaceId: brand.workspaceId,
        platformDraftId: DEV_PLATFORM_DRAFT_ID,
        revisionNumber: 1,
        contentLocale: "en",
        headline: "Dev draft revision",
        body: "Synthetic dev copy for the publish command.",
        hashtags: ["#dev"],
        originatingCopyVariantId: DEV_COPY_VARIANT_ID,
        authoredBy: actor.id,
      })
      .onConflictDoNothing({ target: draftRevision.id });
    await tx
      .update(platformDraft)
      .set({
        activeRevisionId: DEV_DRAFT_REVISION_ID,
        revisionVersion: 1,
      })
      .where(
        and(
          eq(platformDraft.workspaceId, brand.workspaceId),
          eq(platformDraft.id, DEV_PLATFORM_DRAFT_ID),
          isNull(platformDraft.activeRevisionId),
          eq(platformDraft.revisionVersion, 0),
        ),
      );
  });

  if (report.workspaceId && report.appliedAt) {
    console.log(
      `cache invalidation ${await notifyCacheInvalidation({
        baseUrl: migrationEnv.WEB_INTERNAL_BASE_URL,
        secret: migrationEnv.CACHE_INVALIDATION_WEBHOOK_SECRET,
        tags: [
          workspaceCacheTag(report.workspaceId, "installation"),
          workspaceCacheTag(report.workspaceId, "sources"),
        ],
      })}`,
    );
  }
} finally {
  await database.close();
}
