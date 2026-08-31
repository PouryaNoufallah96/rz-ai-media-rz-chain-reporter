import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type CreativeImageBrief,
  creativeImageBriefSchema,
  IMAGE_GENERATION_COMMAND_PREFIX,
  normalizeOperatorImageDirection,
  OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
  operatorImageDirectionSchema,
  type TemplateSelection,
  templateSelectionSchema,
} from "@rz-chain-reporter/contracts";
import {
  type CustomerTemplate,
  type ImageProfile,
  imageProfileSchema,
} from "@rz-chain-reporter/customer-template/schema";
import type { Executor } from "@rz-chain-reporter/db/executor";
import {
  finalizeUsage,
  finalizeUsageWithResult,
  insertPendingUsage,
} from "@rz-chain-reporter/db/repositories/ai-usage-event";
import { executeDraftRevisionCommand } from "@rz-chain-reporter/db/repositories/draft-revision";
import {
  allocateImageStageAttempt,
  attachProviderOriginal,
  createImageBrief,
  FAILED_ORIGINAL_CLEANUP_DELAY_MS,
  findImageExecutionContext,
  findOldestImageOperationForBrand,
  findServableFinalMedia,
  IMAGE_QUEUED_STALE_MS,
  inspectImageAttemptTruth,
  listImageStageUsage,
  listStaleImageOperations,
  loadAuthorizedImageSource,
  loadImageProviderInput,
  markCompensatedProviderOriginal,
  persistClaimedImageCreativeBrief,
  persistClaimedImageSelection,
  rejectReservedProviderOriginal,
  releaseImageOperationAndWake,
  reserveProviderOriginal,
  resolveProviderOriginalCommit,
  settleCancelledImageOperationAndWakeNext,
  settleImageOperationAndWakeNext,
  settleStaleImageOperation,
  stableImageIdentity,
  startImageGeneration,
} from "@rz-chain-reporter/db/repositories/image-generation";
import {
  markMediaObjectRemoved,
  resolveMediaAssetObjectOwnership,
} from "@rz-chain-reporter/db/repositories/media-asset";
import { claimOperationExecution } from "@rz-chain-reporter/db/repositories/operation";
import {
  allocateOperationAttempt,
  settleOperationAttempt,
} from "@rz-chain-reporter/db/repositories/operation-attempt";
import { aiUsageEvent } from "@rz-chain-reporter/db/schema/ai-usage-event";
import { analysisModelUnit } from "@rz-chain-reporter/db/schema/analysis-model-unit";
import { analysisRun } from "@rz-chain-reporter/db/schema/analysis-run";
import { analysisRunItem } from "@rz-chain-reporter/db/schema/analysis-run-item";
import { user } from "@rz-chain-reporter/db/schema/auth";
import { copyGeneration } from "@rz-chain-reporter/db/schema/copy-generation";
import { copyGenerationUnit } from "@rz-chain-reporter/db/schema/copy-generation-unit";
import { copyVariant } from "@rz-chain-reporter/db/schema/copy-variant";
import { draftRevision } from "@rz-chain-reporter/db/schema/draft-revision";
import { draftRevisionCommandReceipt } from "@rz-chain-reporter/db/schema/draft-revision-command-receipt";
import { editorialSelection } from "@rz-chain-reporter/db/schema/editorial-selection";
import { imageBrief } from "@rz-chain-reporter/db/schema/image-brief";
import { imageGeneration } from "@rz-chain-reporter/db/schema/image-generation";
import { imageVarietyMemory } from "@rz-chain-reporter/db/schema/image-variety-memory";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import { mediaBrand } from "@rz-chain-reporter/db/schema/media-brand";
import { mediaDerivation } from "@rz-chain-reporter/db/schema/media-derivation";
import { operation } from "@rz-chain-reporter/db/schema/operation";
import { operationAttempt } from "@rz-chain-reporter/db/schema/operation-attempt";
import { outboxEvent } from "@rz-chain-reporter/db/schema/outbox-event";
import { platformDraft } from "@rz-chain-reporter/db/schema/platform-draft";
import { promoIdea } from "@rz-chain-reporter/db/schema/promo-idea";
import { source } from "@rz-chain-reporter/db/schema/source";
import { sourceItem } from "@rz-chain-reporter/db/schema/source-item";
import { sourceItemEnrichment } from "@rz-chain-reporter/db/schema/source-item-enrichment";
import { sourceItemRevision } from "@rz-chain-reporter/db/schema/source-item-revision";
import {
  AdapterInvocationError,
  ImagePreparationError,
  ModelBindingError,
  ModelGatewayInvocationError,
  ModelTaskConfigurationError,
} from "@rz-chain-reporter/model-gateway/errors";
import {
  MAX_OUTPUT_TOKENS,
  type ModelGateway,
} from "@rz-chain-reporter/model-gateway/gateway";
import { createOpenRouterAdapter } from "@rz-chain-reporter/model-gateway/openrouter";
import type {
  ImageAdapterInput,
  ImageModelInvocation,
  RemoteModelAdapter,
  StructuredAdapterInput,
  StructuredModelInvocation,
} from "@rz-chain-reporter/model-gateway/types";
import type { Storage } from "@rz-chain-reporter/storage";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { Inngest } from "inngest";
import { connect } from "inngest/connect";
import sharp from "sharp";
import { z } from "zod";
import {
  assembleImagePrompt,
  composeBrandedFinal,
  IMAGE_ASSEMBLER_VERSION,
  imageTextLanguageInstruction,
} from "../image-assembler";
import {
  buildSelectionOutputSchema,
  normalizeCreativeBrief,
  selectionSignature,
} from "../image-selection";
import { createWorkerModelGateway } from "../model-gateway/worker-gateway";
import { resolveArtifactRoot } from "../runtime/artifact-root";
import { workerEnv } from "../runtime/env";
import {
  createImageGenerationFunctions,
  executeImageBrandedFinal,
  executeImageCreativeBrief,
  executeImageProvider,
  executeImageSelection,
  IMAGE_PARENT_RETRIES,
  IMAGE_PROVIDER_DEADLINE_MS,
  IMAGE_STAGE_INVOKE_TIMEOUT,
  IMAGE_STAGE_QUIESCENCE_PASSES,
  IMAGE_STAGE_RETRIES,
} from "./image-generation";
import {
  compensateProviderOriginal,
  prepareBrandedFinal,
  prepareProviderOriginal,
  readStorageBytes,
  workerStorage,
} from "./media-storage";
import {
  assertWorkspace,
  openWorkerRuntime,
  type WorkerRuntime,
} from "./runtime";
import { reconcileStaleImageOperations } from "./storage-reconciliation";

const EXIT_FAILURE = 1;
const FIXTURE_PREFIX = "image-generation-probe";
const LOCAL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const [mode, operationArgument, ...extra] = process.argv.slice(2);
const validInvocation =
  (mode === "local" && operationArgument === undefined) ||
  (mode === "inngest" && operationArgument === undefined) ||
  (mode === "original" && operationArgument === undefined) ||
  (mode === "paid" && operationArgument === undefined) ||
  (mode === "finalization" && operationArgument === undefined) ||
  (mode === "rearm-verify" &&
    operationArgument !== undefined &&
    extra.length === 0);

if (!validInvocation) {
  console.error(
    "image-generation probe failed [USAGE: local|inngest|original|paid|finalization|rearm-verify <operation-id>]",
  );
  process.exit(EXIT_FAILURE);
}

assertLocalServices();

async function mainLocal() {
  assert.equal(IMAGE_PARENT_RETRIES, 2);
  assert.equal(IMAGE_STAGE_RETRIES, 0);
  assert.equal(IMAGE_STAGE_INVOKE_TIMEOUT, "10m");
  assert.equal(IMAGE_STAGE_QUIESCENCE_PASSES, 12);
  assert.equal(IMAGE_PROVIDER_DEADLINE_MS, 90_000);
  await proveObservedOpenRouterResponse();
  proveDirectionBounds();

  const opened = openWorkerRuntime();
  const failureFixtures: Fixture[] = [];
  let retainFixture = false;
  try {
    const installation = await assertWorkspace({
      db: opened.database.db,
      identity: opened.identity,
    });
    const fixture = await createFixture(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
      "rz-prime",
      "fa",
    );
    failureFixtures.push(fixture);
    const runtime: WorkerRuntime = {
      db: opened.database.db,
      identity: opened.identity,
      template: fixture.template,
    };
    const adapter = new DeterministicImageAdapter(
      fixture.fallback,
      "invalid-then-accepted",
    );
    const gateway = createWorkerModelGateway({
      adapters: { local: adapter, remote: adapter },
      bindings: {},
      executor: opened.database.db,
      identity: opened.identity,
      template: fixture.template,
    });
    proveImagePromptProfileBounds(opened.template);
    await proveGatewayBounds(gateway, adapter);
    const gatewayMatrixFixture = await createFixture(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    failureFixtures.push(gatewayMatrixFixture);
    await proveGatewayErrorSlotMatrix(
      opened.database.db,
      {
        db: opened.database.db,
        identity: opened.identity,
        template: gatewayMatrixFixture.template,
      },
      gatewayMatrixFixture,
    );
    await cleanupFixture(
      opened.database.db,
      gatewayMatrixFixture.workspaceId,
      gatewayMatrixFixture.platformDraftId,
      gatewayMatrixFixture.mediaBrandId,
      gatewayMatrixFixture.reference.id,
    );
    failureFixtures.splice(failureFixtures.indexOf(gatewayMatrixFixture), 1);
    await proveImageSourceReadiness(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
      opened.identity,
    );
    await proveImageParentScheduling(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
      opened.identity,
    );

    const direction = operatorImageDirectionSchema.parse(
      "  خط اول\r\nCafe\u0301\t✓  ",
    );
    assert.equal(direction, "خط اول\nCafé\t✓");
    assert.equal(
      operatorImageDirectionSchema.parse("\n خط اول\nCafe\u0301\t✓ \r\n"),
      direction,
    );
    assert.equal(operatorImageDirectionSchema.parse("  "), undefined);
    assert.throws(() => operatorImageDirectionSchema.parse("hidden\u202e"));

    const idempotencyKey = randomUUID();
    const requestHash = commandHash({
      draftRevisionId: fixture.draftRevisionId,
      expectedImageIntentVersion: 0,
      expectedRevisionVersion: 1,
      idempotencyKey,
      modelOptionKey: fixture.modelOptionKey,
      operatorDirection: direction,
    });
    const created = await startImageGeneration(
      opened.database.db,
      installation.workspaceId,
      {
        actor: fixture.actorId,
        draftRevisionId: fixture.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey,
        modelOptionKey: fixture.modelOptionKey,
        operatorDirection: direction,
        requestHash,
        requestId: null,
      },
    );
    assert.equal(created.status, "created");
    if (!("operationId" in created)) {
      throw new Error("IMAGE_COMMAND_NOT_CREATED");
    }
    console.log(
      JSON.stringify({
        fixtureOperationId: created.operationId,
        proof: "fresh-image-operation-created",
      }),
    );

    const replay = await startImageGeneration(
      opened.database.db,
      installation.workspaceId,
      {
        actor: fixture.actorId,
        draftRevisionId: fixture.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey,
        modelOptionKey: fixture.modelOptionKey,
        operatorDirection: operatorImageDirectionSchema.parse(
          "\n خط اول\nCafe\u0301\t✓ \r\n",
        ),
        requestHash,
        requestId: null,
      },
    );
    assert.equal(replay.status, "replayed");
    assert.equal(
      "operationId" in replay ? replay.operationId : null,
      created.operationId,
    );
    const concurrencyFixture = await createFixture(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    failureFixtures.push(concurrencyFixture);
    await proveBrandConcurrency(
      opened.database.db,
      created.operationId,
      fixture,
      concurrencyFixture,
    );
    const mismatch = await startImageGeneration(
      opened.database.db,
      installation.workspaceId,
      {
        actor: fixture.actorId,
        draftRevisionId: fixture.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey,
        modelOptionKey: fixture.modelOptionKey,
        operatorDirection: normalizeOperatorImageDirection("material change"),
        requestHash: commandHash({ material: "change" }),
        requestId: null,
      },
    );
    assert.equal(mismatch.status, "idempotency_mismatch");

    const [stored] = await opened.database.db
      .select()
      .from(imageGeneration)
      .where(eq(imageGeneration.operationId, created.operationId));
    assert.equal(stored?.operatorDirection, direction);
    assert.equal(stored?.imageBriefId, null);
    assert.equal(
      await findOldestImageOperationForBrand(
        opened.database.db,
        installation.workspaceId,
        fixture.mediaBrandId,
      ),
      created.operationId,
    );

    const staleToken = `image-stale-settlement:${randomUUID()}`;
    const claimed = await claimOperationExecution(
      opened.database.db,
      installation.workspaceId,
      {
        claimedBy: staleToken,
        id: created.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      },
    );
    assert.equal(claimed.status, "claimed");
    if (claimed.status !== "claimed")
      throw new Error("IMAGE_CLAIM_NOT_ACQUIRED");
    const source = {
      digest: hash("fixture-source"),
      id: fixture.promoIdeaId,
      kind: "promo_idea" as const,
      version: "promo-v1",
    };
    const briefInput = {
      assemblerVersion: IMAGE_ASSEMBLER_VERSION,
      brandPolicyFingerprint: "fixture-brand",
      configurationVersion: opened.identity.fingerprint,
      imageProfileFingerprint: "fixture-profile",
      operationId: created.operationId,
      selectionAttemptId: randomUUID(),
      source,
    };
    assert.equal(
      await createImageBrief(opened.database.db, installation.workspaceId, {
        ...briefInput,
        claimedBy: "stale-token",
        expectedVersion: claimed.operation.version,
      }),
      null,
    );
    assert.equal(
      await createImageBrief(opened.database.db, installation.workspaceId, {
        ...briefInput,
        claimedBy: staleToken,
        expectedVersion: claimed.operation.version - 1,
      }),
      null,
    );
    await opened.database.db
      .update(operation)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(operation.id, created.operationId));
    assert.equal(
      await createImageBrief(opened.database.db, installation.workspaceId, {
        ...briefInput,
        claimedBy: staleToken,
        expectedVersion: claimed.operation.version,
      }),
      null,
    );
    const callsBeforeLostLease = adapter.structuredCalls;
    assert.equal(
      (
        await executeImageSelection(runtime, gateway, {
          operationId: created.operationId,
          token: staleToken,
          workspaceId: installation.workspaceId,
        })
      ).status,
      "waiting",
    );
    assert.equal(adapter.structuredCalls, callsBeforeLostLease);
    const token = `image-attempt-owner:${randomUUID()}`;
    const reclaimed = await claimOperationExecution(
      opened.database.db,
      installation.workspaceId,
      {
        claimedBy: token,
        id: created.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      },
    );
    assert.equal(reclaimed.status, "claimed");
    if (reclaimed.status !== "claimed") {
      throw new Error("IMAGE_RECLAIM_NOT_ACQUIRED");
    }
    assert.equal(
      await createImageBrief(opened.database.db, installation.workspaceId, {
        ...briefInput,
        claimedBy: staleToken,
        expectedVersion: claimed.operation.version,
      }),
      null,
    );
    const rollbackAttempt = await allocateOperationAttempt(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    if (!rollbackAttempt) throw new Error("ROLLBACK_ATTEMPT_NOT_ALLOCATED");
    const rollbackMarker = new Error("EXPECTED_BRIEF_ROLLBACK");
    await assert.rejects(
      opened.database.db.transaction(async (tx) => {
        const briefId = await createImageBrief(tx, installation.workspaceId, {
          ...briefInput,
          claimedBy: token,
          expectedVersion: reclaimed.operation.version,
          selectionAttemptId: rollbackAttempt.id,
        });
        assert.ok(briefId);
        throw rollbackMarker;
      }),
      (error: unknown) => error === rollbackMarker,
    );
    const [rolledBack] = await opened.database.db
      .select({
        briefId: imageGeneration.imageBriefId,
        direction: imageGeneration.operatorDirection,
      })
      .from(imageGeneration)
      .where(eq(imageGeneration.operationId, created.operationId));
    assert.equal(rolledBack?.briefId, null);
    assert.equal(rolledBack?.direction, direction);
    assert.equal(
      await settleOperationAttempt(
        opened.database.db,
        installation.workspaceId,
        {
          claimFence: {
            claimedBy: staleToken,
            expectedVersion: claimed.operation.version,
            operationId: created.operationId,
          },
          id: rollbackAttempt.id,
          outcome: "succeeded",
        },
      ),
      null,
    );
    assert.ok(
      await settleOperationAttempt(
        opened.database.db,
        installation.workspaceId,
        {
          claimFence: {
            claimedBy: token,
            expectedVersion: reclaimed.operation.version,
            operationId: created.operationId,
          },
          id: rollbackAttempt.id,
          outcome: "succeeded",
        },
      ),
    );

    const authorized = await loadAuthorizedImageSource(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    assert.equal(authorized?.source.kind, "promo");
    assert.equal(authorized?.context.contentLocale, "fa");
    assert.equal(await usageCount(opened.database.db, created.operationId), 0);
    const stageInput = {
      operationId: created.operationId,
      token,
      workspaceId: installation.workspaceId,
    };
    assert.equal(
      (await executeImageSelection(runtime, gateway, stageInput)).status,
      "succeeded",
    );
    assert.equal(
      adapter.structuredPrompts
        .slice(0, 2)
        .every((prompt) => prompt.includes(imageTextLanguageInstruction("fa"))),
      true,
    );
    assert.equal(
      (await executeImageSelection(runtime, gateway, stageInput)).status,
      "succeeded",
    );
    let providerInput = await loadImageProviderInput(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    assert.equal(providerInput?.generation.operatorDirection, null);
    assert.equal(providerInput?.brief.operatorDirection, direction);
    assert.deepEqual(
      providerInput?.brief.selectionRejections.map(
        (item) => item.invocationKey,
      ),
      ["primary"],
    );
    assert.equal(await usageCount(opened.database.db, created.operationId), 2);
    assert.deepEqual(
      await listImageStageUsage(
        opened.database.db,
        installation.workspaceId,
        stableImageIdentity(created.operationId, "selection"),
      ).then((rows) =>
        rows
          .map(({ invocationKey, status }) => ({ invocationKey, status }))
          .sort((left, right) =>
            left.invocationKey.localeCompare(right.invocationKey),
          ),
      ),
      [
        { invocationKey: "primary", status: "succeeded" },
        { invocationKey: "retry-1", status: "succeeded" },
      ],
    );

    assert.equal(
      (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
      "succeeded",
    );
    assert.equal(
      (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
      "succeeded",
    );
    providerInput = await loadImageProviderInput(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    assert.ok(providerInput?.brief.providerPrompt);
    assert.equal(
      adapter.structuredPrompts[2]?.includes(
        imageTextLanguageInstruction("fa"),
      ),
      true,
    );
    assert.equal(
      providerInput?.brief.providerPrompt?.includes(
        imageTextLanguageInstruction("fa"),
      ),
      true,
    );
    assert.equal(await usageCount(opened.database.db, created.operationId), 3);
    assert.deepEqual(
      await listImageStageUsage(
        opened.database.db,
        installation.workspaceId,
        stableImageIdentity(created.operationId, "creative"),
      ).then((rows) =>
        rows
          .map(({ invocationKey, status }) => ({ invocationKey, status }))
          .sort((left, right) =>
            left.invocationKey.localeCompare(right.invocationKey),
          ),
      ),
      [{ invocationKey: "primary", status: "succeeded" }],
    );
    const staleBrief = providerInput?.brief;
    if (!staleBrief?.templateSelection || !staleBrief.creativeBrief) {
      throw new Error("STALE_FALLBACK_FIXTURE_INCOMPLETE");
    }
    assert.equal(
      await persistClaimedImageSelection(
        opened.database.db,
        installation.workspaceId,
        {
          attemptId: stableImageIdentity(created.operationId, "selection"),
          claimedBy: `${token}:stale`,
          expectedVersion: completedOperationVersion(
            await findImageExecutionContext(
              opened.database.db,
              installation.workspaceId,
              created.operationId,
            ),
          ),
          fallback: true,
          fallbackCode: "VALIDATION_FAILED",
          imageBriefId: staleBrief.id,
          operationId: created.operationId,
          rejections: staleBrief.selectionRejections,
          selection: staleBrief.templateSelection,
        },
      ),
      false,
    );
    assert.equal(
      await persistClaimedImageCreativeBrief(
        opened.database.db,
        installation.workspaceId,
        {
          attemptId: stableImageIdentity(created.operationId, "creative"),
          claimedBy: `${token}:stale`,
          creativeBrief: staleBrief.creativeBrief,
          creativeBriefAttemptId: stableImageIdentity(
            created.operationId,
            "creative",
          ),
          expectedVersion: completedOperationVersion(
            await findImageExecutionContext(
              opened.database.db,
              installation.workspaceId,
              created.operationId,
            ),
          ),
          imageBriefId: staleBrief.id,
          operationId: created.operationId,
          providerPrompt: staleBrief.providerPrompt ?? "",
          providerPromptDigest: staleBrief.providerPromptDigest ?? "",
        },
      ),
      false,
    );
    await proveProviderOriginalClaimFences(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
      token,
    );

    assert.equal(
      (await executeImageProvider(runtime, gateway, stageInput)).status,
      "succeeded",
    );
    const [committedGeneration] = await opened.database.db
      .select({
        attemptId: imageGeneration.providerGenerationOperationAttemptId,
        mediaAssetId: imageGeneration.providerOriginalMediaAssetId,
      })
      .from(imageGeneration)
      .where(eq(imageGeneration.operationId, created.operationId));
    const [committedUsage] = await opened.database.db
      .select({ id: aiUsageEvent.id })
      .from(aiUsageEvent)
      .where(
        and(
          eq(aiUsageEvent.operationId, created.operationId),
          eq(aiUsageEvent.apiKind, "image"),
        ),
      );
    if (
      !committedGeneration?.attemptId ||
      !committedGeneration.mediaAssetId ||
      !committedUsage
    ) {
      throw new Error("COMMITTED_PROVIDER_TRUTH_INCOMPLETE");
    }
    const completed = await findImageExecutionContext(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    assert.ok(completed?.providerOriginalMediaAssetId);
    if (!completed) throw new Error("IMAGE_CONTEXT_MISSING");
    assert.equal(
      await resolveProviderOriginalCommit(
        opened.database.db,
        installation.workspaceId,
        {
          attemptId: committedGeneration.attemptId,
          claimedBy: token,
          expectedVersion: completed.operationVersion,
          mediaAssetId: committedGeneration.mediaAssetId,
          objectKey: `workspaces/${installation.workspaceId}/image-originals/${committedGeneration.mediaAssetId}.png`,
          operationId: created.operationId,
          usageEventId: committedUsage.id,
        },
      ),
      "uncertain",
    );
    assert.equal(
      (await executeImageProvider(runtime, gateway, stageInput)).status,
      "succeeded",
    );
    const settled = await settleImageOperationAndWakeNext(
      opened.database.db,
      installation.workspaceId,
      {
        claimedBy: token,
        expectedVersion: completed.operationVersion,
        lifecycle: "succeeded",
        mediaBrandId: fixture.mediaBrandId,
        operationId: created.operationId,
      },
    );
    assert.equal(settled?.lifecycle, "succeeded");
    assert.equal(await usageCount(opened.database.db, created.operationId), 4);
    await proveGenerationIdentityUniqueness(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    const truth = await inspectImageAttemptTruth(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    assert.equal(truth.hasAmbiguousPaidWork, false);
    assert.equal(adapter.imageCalls, 1);
    assert.equal(adapter.structuredCalls, 3);
    assert.deepEqual(adapter.references, [null]);

    await proveReferenceAndCancellation(
      opened.database.db,
      runtime,
      gateway,
      fixture,
      adapter,
    );
    await proveCrossDraftReferenceConflict(
      opened.database.db,
      fixture,
      concurrencyFixture,
    );
    await cleanupFixture(
      opened.database.db,
      concurrencyFixture.workspaceId,
      concurrencyFixture.platformDraftId,
      concurrencyFixture.mediaBrandId,
      concurrencyFixture.reference.id,
    );
    failureFixtures.splice(failureFixtures.indexOf(concurrencyFixture), 1);

    await proveRealStorageAmbiguity(
      opened.database.db,
      installation.workspaceId,
    );

    const rearmImageIntentVersion = await readFixtureImageIntentVersion(
      opened.database.db,
      fixture,
    );
    const rearmIdempotencyKey = randomUUID();
    const rearm = await startImageGeneration(
      opened.database.db,
      installation.workspaceId,
      {
        actor: fixture.actorId,
        draftRevisionId: fixture.draftRevisionId,
        expectedImageIntentVersion: rearmImageIntentVersion,
        expectedRevisionVersion: 1,
        idempotencyKey: rearmIdempotencyKey,
        modelOptionKey: fixture.modelOptionKey,
        requestHash: commandHash({
          draftRevisionId: fixture.draftRevisionId,
          expectedImageIntentVersion: rearmImageIntentVersion,
          expectedRevisionVersion: 1,
          idempotencyKey: rearmIdempotencyKey,
          modelOptionKey: fixture.modelOptionKey,
        }),
        requestId: null,
      },
    );
    assert.equal(rearm.status, "created");
    if (!("operationId" in rearm)) throw new Error("REARM_FIXTURE_NOT_CREATED");
    const exhaustedAt = new Date();
    const [exhausted] = await opened.database.db
      .update(outboxEvent)
      .set({
        exhaustedAt,
        lastErrorAt: exhaustedAt,
        lastErrorCode: "PROBE_EXHAUSTED",
      })
      .where(
        and(
          eq(outboxEvent.workspaceId, installation.workspaceId),
          eq(outboxEvent.operationId, rearm.operationId),
          isNull(outboxEvent.dispatchedAt),
        ),
      )
      .returning({ id: outboxEvent.id });
    assert.ok(exhausted);

    console.log(
      JSON.stringify({
        adapter: {
          imageCalls: adapter.imageCalls,
          structuredCalls: adapter.structuredCalls,
        },
        briefMove: "atomic_once",
        command: "normalized_replay_and_mismatch",
        database: "project_local_postgresql",
        enabledRouteProof: "unproven",
        minio: "exact_owned_keys",
        providerEffects: 0,
        proof: "image-generation-local",
        promptLocaleProof: "fa_selection_creative_provider",
        rearmOperationId: rearm.operationId,
        stages: "selection_creative_provider_restart_safe",
      }),
    );
    retainFixture = true;
  } finally {
    if (!retainFixture) {
      for (const fixture of failureFixtures) {
        await cleanupFixture(
          opened.database.db,
          fixture.workspaceId,
          fixture.platformDraftId,
          fixture.mediaBrandId,
          fixture.reference.id,
        );
      }
    }
    await opened.database.close();
  }
}

async function mainInngest() {
  const opened = openWorkerRuntime();
  const fixtures: Fixture[] = [];
  try {
    const installation = await assertWorkspace({
      db: opened.database.db,
      identity: opened.identity,
    });
    const childFixture = await createFixture(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(childFixture);
    const childRuntime: WorkerRuntime = {
      db: opened.database.db,
      identity: opened.identity,
      template: childFixture.template,
    };
    const childOperation = await startImageGeneration(
      opened.database.db,
      childFixture.workspaceId,
      {
        actor: childFixture.actorId,
        draftRevisionId: childFixture.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey: randomUUID(),
        modelOptionKey: childFixture.modelOptionKey,
        requestHash: commandHash({ proof: "inngest-child", id: randomUUID() }),
        requestId: null,
      },
    );
    if (!("operationId" in childOperation)) {
      throw new Error("INNGEST_IMAGE_CHILD_OPERATION_NOT_CREATED");
    }
    const token = `inngest-image-child:${randomUUID()}`;
    const childClaim = await claimOperationExecution(
      opened.database.db,
      childFixture.workspaceId,
      {
        claimedBy: token,
        id: childOperation.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      },
    );
    if (childClaim.status !== "claimed") {
      throw new Error("INNGEST_IMAGE_CHILD_CLAIM_REJECTED");
    }
    const adapter = new DeterministicImageAdapter(
      childFixture.fallback,
      "accepted",
    );
    const gateway = createWorkerModelGateway({
      adapters: { local: adapter, remote: adapter },
      bindings: {},
      executor: opened.database.db,
      identity: opened.identity,
      template: childFixture.template,
    });
    const childClient = new Inngest({
      appVersion: `image-child-${randomUUID()}`,
      id: `rz-image-probe-child-${randomUUID()}`,
    });
    const [, selection] = createImageGenerationFunctions(
      childClient,
      childRuntime,
      () => gateway,
    );
    if (!selection) throw new Error("INNGEST_IMAGE_SELECTION_MISSING");
    const driver = childClient.createFunction(
      {
        id: "image-probe-child-driver",
        retries: 0,
        triggers: [{ event: "probe/image-child.requested" }],
      },
      ({ step }) =>
        step.invoke("invoke-image-probe-child", {
          data: {
            operationId: childOperation.operationId,
            token,
            workspaceId: childFixture.workspaceId,
          },
          function: selection,
        }),
    );
    const childConnection = await connect({
      apps: [{ client: childClient, functions: [selection, driver] }],
      handleShutdownSignals: [],
      isolateExecution: false,
      maxWorkerConcurrency: 2,
    });
    try {
      await childClient.send({
        id: `image-child:${childOperation.operationId}`,
        name: "probe/image-child.requested",
        data: {},
      });
      await waitForImageProbe(async () => {
        const [brief] = await opened.database.db
          .select({ selection: imageBrief.templateSelection })
          .from(imageBrief)
          .innerJoin(
            imageGeneration,
            eq(imageGeneration.imageBriefId, imageBrief.id),
          )
          .where(eq(imageGeneration.operationId, childOperation.operationId));
        return brief?.selection ? brief : null;
      }, "IMAGE_CHILD_HANDLER_NOT_ENTERED");
    } finally {
      await childConnection.close();
      await childConnection.closed;
    }
    const childContext = await findImageExecutionContext(
      opened.database.db,
      childFixture.workspaceId,
      childOperation.operationId,
    );
    if (!childContext) throw new Error("INNGEST_IMAGE_CHILD_CONTEXT_MISSING");
    assert.ok(
      await settleImageOperationAndWakeNext(
        opened.database.db,
        childFixture.workspaceId,
        {
          claimedBy: token,
          expectedVersion: childContext.operationVersion,
          lifecycle: "cancelled",
          mediaBrandId: childFixture.mediaBrandId,
          operationId: childOperation.operationId,
        },
      ),
    );
    assert.equal(adapter.structuredCalls, 1);
    assert.equal(adapter.imageCalls, 0);
    assert.equal(
      await usageCount(opened.database.db, childOperation.operationId),
      1,
    );

    const parentFixture = await createFixture(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(parentFixture);
    const parentOperation = await startImageGeneration(
      opened.database.db,
      parentFixture.workspaceId,
      {
        actor: parentFixture.actorId,
        draftRevisionId: parentFixture.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey: randomUUID(),
        modelOptionKey: parentFixture.modelOptionKey,
        requestHash: commandHash({ proof: "inngest-parent", id: randomUUID() }),
        requestId: null,
      },
    );
    if (!("operationId" in parentOperation)) {
      throw new Error("INNGEST_IMAGE_PARENT_OPERATION_NOT_CREATED");
    }
    const parentRuntime: WorkerRuntime = {
      db: opened.database.db,
      identity: opened.identity,
      template: parentFixture.template,
    };
    const parentToken = `inngest-image-parent:${randomUUID()}`;
    const parentClaim = await claimOperationExecution(
      opened.database.db,
      parentFixture.workspaceId,
      {
        claimedBy: parentToken,
        id: parentOperation.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      },
    );
    if (parentClaim.status !== "claimed") {
      throw new Error("INNGEST_IMAGE_PARENT_CLAIM_REJECTED");
    }
    const interruptedAttempt = await allocateImageStageAttempt(
      opened.database.db,
      parentFixture.workspaceId,
      {
        claimedBy: parentToken,
        expectedVersion: parentClaim.operation.version,
        operationId: parentOperation.operationId,
        stage: "provider",
      },
    );
    if (!interruptedAttempt) {
      throw new Error("INNGEST_IMAGE_PARENT_ATTEMPT_MISSING");
    }
    await opened.database.db.insert(aiUsageEvent).values({
      apiKind: "image",
      backend: "remote",
      invocationKey: "primary",
      operationAttemptId: interruptedAttempt.attempt.id,
      operationId: parentOperation.operationId,
      providerGateway: "openrouter",
      requestedModel: "probe/no-provider",
      status: "pending",
      taskKey: "image-generation:probe",
      workspaceId: parentFixture.workspaceId,
    });
    await opened.database.db
      .update(operation)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(operation.id, parentOperation.operationId));
    const parentClient = new Inngest({
      appVersion: `image-parent-${randomUUID()}`,
      id: `rz-image-probe-parent-${randomUUID()}`,
    });
    const [parent] = createImageGenerationFunctions(
      parentClient,
      parentRuntime,
      () => {
        throw new Error("IMAGE_PROVIDER_EFFECT_FORBIDDEN");
      },
    );
    if (!parent) throw new Error("INNGEST_IMAGE_PARENT_MISSING");
    const order: string[] = [];
    const step = {
      realtime: {
        publish: async (id: string) => {
          order.push(id);
        },
      },
      run: async (id: string, execute: () => Promise<unknown>) => {
        if (id.startsWith("notify-")) {
          order.push(id);
          return "accepted";
        }
        return execute();
      },
      sleep: async (id: string) => {
        order.push(id);
      },
    };
    const onFailure = (
      parent as unknown as {
        onFailureFn: (input: {
          event: {
            data: {
              event: {
                data: {
                  imageGenerationId: string;
                  operationId: string;
                  schemaVersion: 1;
                  workspaceId: string;
                };
              };
            };
          };
          step: typeof step;
        }) => Promise<void>;
      }
    ).onFailureFn;
    await onFailure({
      event: {
        data: {
          event: {
            data: {
              imageGenerationId: parentOperation.operationId,
              operationId: parentOperation.operationId,
              schemaVersion: 1,
              workspaceId: parentFixture.workspaceId,
            },
          },
        },
      },
      step,
    });
    const terminal = await findImageExecutionContext(
      opened.database.db,
      parentFixture.workspaceId,
      parentOperation.operationId,
    );
    if (!terminal) throw new Error("IMAGE_PARENT_ON_FAILURE_NOT_TERMINAL");
    assert.equal(terminal.operationLifecycle, "unknown");
    assert.equal(terminal.claimedBy, null);
    assert.equal(
      await usageCount(opened.database.db, parentOperation.operationId),
      1,
    );
    const interruptedTruth = await inspectImageAttemptTruth(
      opened.database.db,
      parentFixture.workspaceId,
      parentOperation.operationId,
    );
    assert.equal(interruptedTruth.hasAmbiguousPaidWork, true);
    assert.equal(interruptedTruth.hasPendingPaidWork, false);
    assert.equal(interruptedTruth.rows[0]?.attemptOutcome, "ambiguous");
    assert.equal(interruptedTruth.rows[0]?.usageStatus, "unknown");
    assert.ok(
      order.indexOf("notify-drafts-cache-image-failure") <
        order.indexOf("publish-drafts-changed-image-failure"),
    );
    console.log(
      "image-generation inngest injected-envelope handler-step=true expired-lease=unknown providerEffects=0 cleanup=pending status=pass",
    );
  } finally {
    for (const fixture of fixtures.reverse()) {
      await cleanupFixture(
        opened.database.db,
        fixture.workspaceId,
        fixture.platformDraftId,
        fixture.mediaBrandId,
        fixture.reference.id,
      );
    }
    await opened.database.close();
  }
  console.log(
    "image-generation inngest probe passed cleanup=exact_fixture_removed",
  );
}

async function waitForImageProbe<T>(
  load: () => Promise<T | null>,
  failure: string,
): Promise<T> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const result = await load();
    if (result !== null) return result;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(failure);
}

async function proveGenerationIdentityUniqueness(
  db: Executor,
  workspaceId: string,
  operationId: string,
) {
  const usages = await db
    .select()
    .from(aiUsageEvent)
    .where(eq(aiUsageEvent.operationId, operationId));
  const structured = usages.find((item) => item.apiKind === "chat");
  const image = usages.find((item) => item.apiKind === "image");
  assert.ok(structured?.generationId?.startsWith("deterministic-structured-"));
  assert.ok(image?.generationId?.startsWith("deterministic-image-"));
  assert.notEqual(structured?.generationId, image?.generationId);
  if (!structured?.generationId) {
    throw new Error("STRUCTURED_GENERATION_ID_MISSING");
  }
  const duplicateAttempt = await allocateOperationAttempt(
    db,
    workspaceId,
    operationId,
  );
  if (!duplicateAttempt) throw new Error("DUPLICATE_ATTEMPT_NOT_ALLOCATED");
  await assert.rejects(
    db.insert(aiUsageEvent).values({
      apiKind: "chat",
      backend: "remote",
      generationId: structured.generationId,
      invocationKey: "fallback",
      operationAttemptId: duplicateAttempt.id,
      operationId,
      providerGateway: structured.providerGateway,
      requestedModel: structured.requestedModel,
      resolvedModel: structured.resolvedModel,
      status: "failed",
      taskKey: structured.taskKey,
      workspaceId,
    }),
  );
}

function completedOperationVersion(
  context: Awaited<ReturnType<typeof findImageExecutionContext>>,
) {
  if (!context) throw new Error("IMAGE_CONTEXT_MISSING");
  return context.operationVersion;
}

async function proveProviderOriginalClaimFences(
  db: Executor,
  workspaceId: string,
  operationId: string,
  claimedBy: string,
) {
  const context = await findImageExecutionContext(db, workspaceId, operationId);
  if (!context) throw new Error("PROVIDER_FENCE_CONTEXT_MISSING");
  const attempt = await allocateOperationAttempt(db, workspaceId, operationId);
  if (!attempt) throw new Error("PROVIDER_FENCE_ATTEMPT_MISSING");
  const mediaAssetId = randomUUID();
  const objectKey = `workspaces/${workspaceId}/image-originals/${mediaAssetId}.png`;
  const reserved = await reserveProviderOriginal(db, workspaceId, {
    attemptId: attempt.id,
    claimedBy,
    expectedVersion: context.operationVersion,
    mediaAssetId,
    objectKey,
    operationId,
  });
  assert.equal(reserved.status, "reserved");
  const [usage] = await db
    .insert(aiUsageEvent)
    .values({
      apiKind: "image",
      backend: "remote",
      invocationKey: "fallback",
      operationAttemptId: attempt.id,
      operationId,
      providerGateway: "openrouter",
      requestedModel: "probe/no-provider",
      status: "pending",
      taskKey: "image-generation:probe",
      workspaceId,
    })
    .returning({ id: aiUsageEvent.id });
  if (!usage) throw new Error("PROVIDER_FENCE_USAGE_MISSING");
  const exact = {
    attemptId: attempt.id,
    claimedBy,
    expectedVersion: context.operationVersion,
    mediaAssetId,
    objectKey,
    operationId,
    usageEventId: usage.id,
  };
  assert.equal(
    await resolveProviderOriginalCommit(db, workspaceId, exact),
    "absent",
  );
  assert.equal(
    await resolveProviderOriginalCommit(db, workspaceId, {
      ...exact,
      claimedBy: `${claimedBy}:stale`,
    }),
    "uncertain",
  );
  assert.equal(
    await resolveProviderOriginalCommit(db, workspaceId, {
      ...exact,
      objectKey: `${objectKey}.wrong`,
    }),
    "uncertain",
  );
  const rejectedAssetId = randomUUID();
  const rejectedObjectKey = `workspaces/${workspaceId}/image-originals/${rejectedAssetId}.png`;
  assert.equal(
    (
      await reserveProviderOriginal(db, workspaceId, {
        ...exact,
        mediaAssetId: rejectedAssetId,
        objectKey: rejectedObjectKey,
      })
    ).status,
    "reserved",
  );
  assert.equal(
    await rejectReservedProviderOriginal(db, workspaceId, {
      ...exact,
      claimedBy: `${claimedBy}:stale`,
      mediaAssetId: rejectedAssetId,
      objectKey: rejectedObjectKey,
    }),
    "uncertain",
  );
  assert.equal(
    await rejectReservedProviderOriginal(db, workspaceId, {
      ...exact,
      mediaAssetId: rejectedAssetId,
      objectKey: rejectedObjectKey,
    }),
    "rejected",
  );
  const [definiteRejection] = await db
    .select({
      lifecycle: mediaAsset.lifecycle,
      objectRemovedAt: mediaAsset.objectRemovedAt,
    })
    .from(mediaAsset)
    .where(eq(mediaAsset.id, rejectedAssetId));
  assert.equal(definiteRejection?.lifecycle, "rejected");
  assert.ok(definiteRejection?.objectRemovedAt);
  await db.delete(mediaAsset).where(eq(mediaAsset.id, rejectedAssetId));
  await workerStorage().put(objectKey, LOCAL_PNG, "image/png");
  await db
    .update(operation)
    .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(operation.id, operationId));
  assert.equal(
    await resolveProviderOriginalCommit(db, workspaceId, exact),
    "uncertain",
  );
  assert.equal(
    (
      await markCompensatedProviderOriginal(db, workspaceId, {
        ...exact,
      })
    ).status,
    "uncertain",
  );
  assert.equal(
    await rejectReservedProviderOriginal(db, workspaceId, exact),
    "uncertain",
  );
  assert.equal(
    (
      await reserveProviderOriginal(db, workspaceId, {
        ...exact,
        mediaAssetId: randomUUID(),
        objectKey: `workspaces/${workspaceId}/image-originals/${randomUUID()}.png`,
      })
    ).status,
    "not_owned",
  );
  assert.equal(
    await releaseImageOperationAndWake(db, workspaceId, {
      claimedBy: `${claimedBy}:stale`,
      expectedVersion: context.operationVersion,
      operationId,
    }),
    null,
  );
  assert.equal(
    await settleImageOperationAndWakeNext(db, workspaceId, {
      claimedBy,
      expectedVersion: context.operationVersion,
      lifecycle: "failed",
      mediaBrandId: context.mediaBrandId,
      operationId,
    }),
    null,
  );
  await assert.rejects(
    db.transaction((tx) =>
      attachProviderOriginal(tx, workspaceId, {
        attemptId: attempt.id,
        claimedBy,
        expectedVersion: context.operationVersion,
        media: {
          actualBytes: LOCAL_PNG.byteLength,
          checksum: hash(LOCAL_PNG),
          height: 1,
          id: mediaAssetId,
          mimeType: "image/png",
          objectKey,
          width: 1,
        },
        operationId,
      }),
    ),
    /claim fence lost/,
  );
  assert.ok(await workerStorage().head(objectKey));
  const reclaimed = await claimOperationExecution(db, workspaceId, {
    claimedBy,
    id: operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (reclaimed.status !== "claimed") {
    throw new Error("PROVIDER_FENCE_RECLAIM_REJECTED");
  }
  const current = {
    ...exact,
    expectedVersion: reclaimed.operation.version,
  };
  assert.equal(
    await resolveProviderOriginalCommit(db, workspaceId, current),
    "absent",
  );
  assert.equal(
    (await markCompensatedProviderOriginal(db, workspaceId, exact)).status,
    "uncertain",
  );
  assert.ok(await workerStorage().head(objectKey));
  const rejected = await markCompensatedProviderOriginal(
    db,
    workspaceId,
    current,
  );
  assert.equal(rejected.status, "rejected");
  if (rejected.status !== "rejected") {
    throw new Error("PROVIDER_FENCE_REJECTION_MISSING");
  }
  assert.ok(await workerStorage().head(objectKey));
  assert.equal(
    (await compensateProviderOriginal(workerStorage(), objectKey)).status,
    "compensated",
  );
  const removed = await markMediaObjectRemoved(db, workspaceId, {
    id: rejected.asset.id,
    lifecycle: "rejected",
    version: rejected.asset.version,
  });
  assert.equal(removed.status, "updated");
  await assert.rejects(workerStorage().head(objectKey));
  await db.delete(aiUsageEvent).where(eq(aiUsageEvent.id, usage.id));
  await db.delete(operationAttempt).where(eq(operationAttempt.id, attempt.id));
  await db.delete(mediaAsset).where(eq(mediaAsset.id, mediaAssetId));
}

async function proveBrandConcurrency(
  db: Executor,
  firstOperationId: string,
  primary: Fixture,
  secondary: Fixture,
) {
  await db
    .update(operation)
    .set({ createdAt: new Date(Date.now() - 60_000) })
    .where(eq(operation.id, firstOperationId));
  await db
    .update(platformDraft)
    .set({ mediaBrandId: primary.mediaBrandId })
    .where(eq(platformDraft.id, secondary.platformDraftId));
  const sameBrandKey = randomUUID();
  const sameBrandHash = commandHash({ sameBrandKey });
  const sameBrand = await startImageGeneration(db, secondary.workspaceId, {
    actor: secondary.actorId,
    draftRevisionId: secondary.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey: sameBrandKey,
    modelOptionKey: secondary.modelOptionKey,
    requestHash: sameBrandHash,
    requestId: null,
  });
  assert.equal(sameBrand.status, "created");
  if (!("operationId" in sameBrand)) {
    throw new Error("SAME_BRAND_OPERATION_NOT_CREATED");
  }
  assert.equal(
    (
      await startImageGeneration(db, secondary.workspaceId, {
        actor: secondary.actorId,
        draftRevisionId: secondary.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey: sameBrandKey,
        modelOptionKey: secondary.modelOptionKey,
        requestHash: sameBrandHash,
        requestId: null,
      })
    ).status,
    "replayed",
  );
  assert.equal(
    await findOldestImageOperationForBrand(
      db,
      primary.workspaceId,
      primary.mediaBrandId,
    ),
    firstOperationId,
  );
  const owner = `image-brand-owner:${randomUUID()}`;
  const claim = await claimOperationExecution(db, secondary.workspaceId, {
    claimedBy: owner,
    id: sameBrand.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") throw new Error("SAME_BRAND_CLAIM_REJECTED");
  assert.equal(
    (
      await claimOperationExecution(db, secondary.workspaceId, {
        claimedBy: `image-brand-competing-owner:${randomUUID()}`,
        id: sameBrand.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      })
    ).status,
    "busy",
  );
  assert.ok(
    await settleImageOperationAndWakeNext(db, secondary.workspaceId, {
      claimedBy: owner,
      expectedVersion: claim.operation.version,
      lifecycle: "cancelled",
      mediaBrandId: primary.mediaBrandId,
      operationId: sameBrand.operationId,
    }),
  );

  await db
    .update(platformDraft)
    .set({ mediaBrandId: secondary.mediaBrandId })
    .where(eq(platformDraft.id, secondary.platformDraftId));
  const differentBrandImageIntentVersion = await readFixtureImageIntentVersion(
    db,
    secondary,
  );
  const differentBrandKey = randomUUID();
  const differentBrand = await startImageGeneration(db, secondary.workspaceId, {
    actor: secondary.actorId,
    draftRevisionId: secondary.draftRevisionId,
    expectedImageIntentVersion: differentBrandImageIntentVersion,
    expectedRevisionVersion: 1,
    idempotencyKey: differentBrandKey,
    modelOptionKey: secondary.modelOptionKey,
    requestHash: commandHash({ differentBrandKey }),
    requestId: null,
  });
  assert.equal(differentBrand.status, "created");
  if (!("operationId" in differentBrand)) {
    throw new Error("DIFFERENT_BRAND_OPERATION_NOT_CREATED");
  }
  assert.equal(
    await findOldestImageOperationForBrand(
      db,
      secondary.workspaceId,
      secondary.mediaBrandId,
    ),
    differentBrand.operationId,
  );
  const differentOwner = `image-different-owner:${randomUUID()}`;
  const differentClaim = await claimOperationExecution(
    db,
    secondary.workspaceId,
    {
      claimedBy: differentOwner,
      id: differentBrand.operationId,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      now: new Date(),
    },
  );
  if (differentClaim.status !== "claimed") {
    throw new Error("DIFFERENT_BRAND_CLAIM_REJECTED");
  }
  assert.ok(
    await settleImageOperationAndWakeNext(db, secondary.workspaceId, {
      claimedBy: differentOwner,
      expectedVersion: differentClaim.operation.version,
      lifecycle: "cancelled",
      mediaBrandId: secondary.mediaBrandId,
      operationId: differentBrand.operationId,
    }),
  );
}

async function proveCrossDraftReferenceConflict(
  db: Executor,
  primary: Fixture,
  secondary: Fixture,
) {
  const imageIntentVersion = await readFixtureImageIntentVersion(db, secondary);
  const idempotencyKey = randomUUID();
  assert.equal(
    (
      await startImageGeneration(db, secondary.workspaceId, {
        actor: secondary.actorId,
        draftRevisionId: secondary.draftRevisionId,
        expectedImageIntentVersion: imageIntentVersion,
        expectedRevisionVersion: 1,
        idempotencyKey,
        modelOptionKey: secondary.modelOptionKey,
        referenceMediaAssetId: primary.reference.id,
        requestHash: commandHash({
          idempotencyKey,
          referenceMediaAssetId: primary.reference.id,
        }),
        requestId: null,
      })
    ).status,
    "reference_conflict",
  );
}

async function proveReferenceAndCancellation(
  db: Executor,
  runtime: WorkerRuntime,
  gateway: ReturnType<typeof createWorkerModelGateway>,
  fixture: Fixture,
  adapter: DeterministicImageAdapter,
) {
  const imageIntentVersion = await readFixtureImageIntentVersion(db, fixture);
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, fixture.workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: imageIntentVersion,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    referenceMediaAssetId: fixture.reference.id,
    requestHash: commandHash({
      draftRevisionId: fixture.draftRevisionId,
      idempotencyKey,
      referenceMediaAssetId: fixture.reference.id,
    }),
    requestId: null,
  });
  assert.equal(created.status, "created");
  if (!("operationId" in created)) {
    throw new Error("REFERENCE_OPERATION_NOT_CREATED");
  }
  console.log(
    JSON.stringify({
      fixtureOperationId: created.operationId,
      proof: "fresh-reference-operation-created",
    }),
  );
  const token = `image-reference-owner:${randomUUID()}`;
  const claim = await claimOperationExecution(db, fixture.workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") throw new Error("REFERENCE_CLAIM_REJECTED");
  const input = {
    operationId: created.operationId,
    token,
    workspaceId: fixture.workspaceId,
  };
  assert.equal(
    (await executeImageSelection(runtime, gateway, input)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, input)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageProvider(runtime, gateway, input)).status,
    "succeeded",
  );
  assert.equal(adapter.references.at(-1), fixture.reference.checksum);
  const context = await findImageExecutionContext(
    db,
    fixture.workspaceId,
    created.operationId,
  );
  if (!context?.providerOriginalMediaAssetId) {
    throw new Error("REFERENCE_PROVIDER_RESULT_MISSING");
  }
  assert.ok(
    await settleImageOperationAndWakeNext(db, fixture.workspaceId, {
      claimedBy: token,
      expectedVersion: context.operationVersion,
      lifecycle: "succeeded",
      mediaBrandId: fixture.mediaBrandId,
      operationId: created.operationId,
    }),
  );

  const reuseImageIntentVersion = await readFixtureImageIntentVersion(
    db,
    fixture,
  );
  const reuseKey = randomUUID();
  const reused = await startImageGeneration(db, fixture.workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: reuseImageIntentVersion,
    expectedRevisionVersion: 1,
    idempotencyKey: reuseKey,
    modelOptionKey: fixture.modelOptionKey,
    referenceMediaAssetId: fixture.reference.id,
    requestHash: commandHash({
      draftRevisionId: fixture.draftRevisionId,
      idempotencyKey: reuseKey,
      referenceMediaAssetId: fixture.reference.id,
    }),
    requestId: null,
  });
  assert.equal(reused.status, "created");
  if (!("operationId" in reused)) throw new Error("REFERENCE_REUSE_REJECTED");
  const cancelledToken = `image-cancelled-owner:${randomUUID()}`;
  const cancelledClaim = await claimOperationExecution(
    db,
    fixture.workspaceId,
    {
      claimedBy: cancelledToken,
      id: reused.operationId,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      now: new Date(),
    },
  );
  if (cancelledClaim.status !== "claimed") {
    throw new Error("CANCELLATION_CLAIM_REJECTED");
  }
  const cancelled = await settleCancelledImageOperationAndWakeNext(
    db,
    fixture.workspaceId,
    {
      claimedBy: cancelledToken,
      expectedVersion: cancelledClaim.operation.version,
      mediaBrandId: fixture.mediaBrandId,
      operationId: reused.operationId,
    },
  );
  assert.equal(cancelled?.operation.lifecycle, "cancelled");
  assert.equal(cancelled?.usageSettled, false);
  assert.equal(
    await settleCancelledImageOperationAndWakeNext(db, fixture.workspaceId, {
      claimedBy: cancelledToken,
      expectedVersion: cancelledClaim.operation.version,
      mediaBrandId: fixture.mediaBrandId,
      operationId: reused.operationId,
    }),
    null,
  );
  const callsBeforeCancelledDelivery = adapter.structuredCalls;
  assert.equal(
    (
      await executeImageSelection(runtime, gateway, {
        operationId: reused.operationId,
        token: cancelledToken,
        workspaceId: fixture.workspaceId,
      })
    ).status,
    "waiting",
  );
  assert.equal(adapter.structuredCalls, callsBeforeCancelledDelivery);

  const invalidatedImageIntentVersion = await readFixtureImageIntentVersion(
    db,
    fixture,
  );
  const invalidatedKey = randomUUID();
  const invalidated = await startImageGeneration(db, fixture.workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: invalidatedImageIntentVersion,
    expectedRevisionVersion: 1,
    idempotencyKey: invalidatedKey,
    modelOptionKey: fixture.modelOptionKey,
    referenceMediaAssetId: fixture.reference.id,
    requestHash: commandHash({
      idempotencyKey: invalidatedKey,
      referenceMediaAssetId: fixture.reference.id,
    }),
    requestId: null,
  });
  assert.equal(invalidated.status, "created");
  if (!("operationId" in invalidated)) {
    throw new Error("REFERENCE_INVALIDATION_OPERATION_NOT_CREATED");
  }
  const invalidatedToken = `image-invalid-reference-owner:${randomUUID()}`;
  const invalidatedClaim = await claimOperationExecution(
    db,
    fixture.workspaceId,
    {
      claimedBy: invalidatedToken,
      id: invalidated.operationId,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      now: new Date(),
    },
  );
  if (invalidatedClaim.status !== "claimed") {
    throw new Error("REFERENCE_INVALIDATION_CLAIM_REJECTED");
  }
  const invalidatedInput = {
    operationId: invalidated.operationId,
    token: invalidatedToken,
    workspaceId: fixture.workspaceId,
  };
  assert.equal(
    (await executeImageSelection(runtime, gateway, invalidatedInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, invalidatedInput))
      .status,
    "succeeded",
  );
  await db
    .update(mediaAsset)
    .set({ lifecycle: "pending", verifiedAt: null })
    .where(eq(mediaAsset.id, fixture.reference.id));
  const callsBeforeInvalidReference = adapter.imageCalls;
  await assert.rejects(
    executeImageProvider(runtime, gateway, invalidatedInput),
    /REFERENCE_INVALID/,
  );
  assert.equal(adapter.imageCalls, callsBeforeInvalidReference);
  await db
    .update(mediaAsset)
    .set({ lifecycle: "verified", verifiedAt: new Date() })
    .where(eq(mediaAsset.id, fixture.reference.id));
  const invalidatedContext = await findImageExecutionContext(
    db,
    fixture.workspaceId,
    invalidated.operationId,
  );
  if (!invalidatedContext) throw new Error("INVALIDATED_CONTEXT_MISSING");
  assert.ok(
    await settleImageOperationAndWakeNext(db, fixture.workspaceId, {
      claimedBy: invalidatedToken,
      expectedVersion: invalidatedContext.operationVersion,
      lifecycle: "cancelled",
      mediaBrandId: fixture.mediaBrandId,
      operationId: invalidated.operationId,
    }),
  );
}

async function mainRearmVerify(operationId: string) {
  const opened = openWorkerRuntime();
  try {
    const installation = await assertWorkspace({
      db: opened.database.db,
      identity: opened.identity,
    });
    const context = await findImageExecutionContext(
      opened.database.db,
      installation.workspaceId,
      operationId,
    );
    if (!context) throw new Error("REARM_FIXTURE_NOT_FOUND");
    const [brand] = await opened.database.db
      .select({ key: mediaBrand.key })
      .from(mediaBrand)
      .where(eq(mediaBrand.id, context.mediaBrandId));
    if (!brand?.key.startsWith(FIXTURE_PREFIX)) {
      throw new Error("REARM_FIXTURE_OWNERSHIP_REJECTED");
    }
    const events = await opened.database.db
      .select()
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.workspaceId, installation.workspaceId),
          eq(outboxEvent.operationId, operationId),
          eq(
            outboxEvent.eventType,
            OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
          ),
        ),
      );
    assert.equal(events.length, 1);
    assert.equal(events[0]?.exhaustedAt, null);
    assert.equal(events[0]?.dispatchedAt, null);
    const related = await opened.database.db
      .select({
        briefId: imageGeneration.imageBriefId,
        operationId: imageGeneration.operationId,
        originalId: imageGeneration.providerOriginalMediaAssetId,
        referenceId: imageGeneration.referenceMediaAssetId,
      })
      .from(imageGeneration)
      .innerJoin(
        draftRevision,
        eq(draftRevision.id, imageGeneration.draftRevisionId),
      )
      .where(eq(draftRevision.platformDraftId, context.platformDraftId));
    assert.equal(related.length, 5);
    assert.equal(
      related.some((item) => item.operationId === operationId),
      true,
    );
    const exact = related.find((item) => item.operationId === operationId);
    assert.deepEqual(exact, {
      briefId: null,
      operationId,
      originalId: null,
      referenceId: null,
    });
    assert.equal(
      await opened.database.db
        .select({ id: operationAttempt.id })
        .from(operationAttempt)
        .where(eq(operationAttempt.operationId, operationId))
        .then((rows) => rows.length),
      0,
    );
    assert.equal(await usageCount(opened.database.db, operationId), 0);
    const cleaned = await cleanupFixture(
      opened.database.db,
      installation.workspaceId,
      context.platformDraftId,
      context.mediaBrandId,
    );
    console.log(
      JSON.stringify({
        cleanup: cleaned,
        newOperations: 0,
        operationId,
        proof: "exhausted-event-rearm",
        rearmed: true,
        sameIdentity: true,
      }),
    );
  } finally {
    await opened.database.close();
  }
}

async function mainPaid() {
  if (!workerEnv.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY_PRESENCE_REQUIRED");
  }
  const opened = openWorkerRuntime();
  let fixture: Fixture | undefined;
  try {
    const installation = await assertWorkspace({
      db: opened.database.db,
      identity: opened.identity,
    });
    fixture = await createFixture(
      opened.database.db,
      installation.workspaceId,
      opened.template,
      opened.identity.fingerprint,
      undefined,
      "fa",
      "gemini-pro-image",
    );
    const runtime: WorkerRuntime = {
      db: opened.database.db,
      identity: opened.identity,
      template: fixture.template,
    };
    const idempotencyKey = randomUUID();
    const created = await startImageGeneration(
      opened.database.db,
      installation.workspaceId,
      {
        actor: fixture.actorId,
        draftRevisionId: fixture.draftRevisionId,
        expectedImageIntentVersion: 0,
        expectedRevisionVersion: 1,
        idempotencyKey,
        modelOptionKey: fixture.modelOptionKey,
        requestHash: commandHash({
          draftRevisionId: fixture.draftRevisionId,
          expectedImageIntentVersion: 0,
          expectedRevisionVersion: 1,
          idempotencyKey,
          modelOptionKey: fixture.modelOptionKey,
        }),
        requestId: null,
      },
    );
    if (!("operationId" in created)) {
      throw new Error("ORIGINAL_FIXTURE_NOT_CREATED");
    }
    const token = `original:${randomUUID()}`;
    const claim = await claimOperationExecution(
      opened.database.db,
      installation.workspaceId,
      {
        claimedBy: token,
        id: created.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      },
    );
    if (claim.status !== "claimed") {
      throw new Error("ORIGINAL_FIXTURE_CLAIM_REJECTED");
    }
    const deterministicAdapter = new DeterministicImageAdapter(
      fixture.fallback,
      "invalid-then-accepted",
    );
    const deterministicGateway = createWorkerModelGateway({
      adapters: {
        local: deterministicAdapter,
        remote: deterministicAdapter,
      },
      bindings: {},
      executor: opened.database.db,
      identity: opened.identity,
      template: fixture.template,
    });
    const stageInput = {
      operationId: created.operationId,
      token,
      workspaceId: installation.workspaceId,
    };
    assert.equal(
      (await executeImageSelection(runtime, deterministicGateway, stageInput))
        .status,
      "succeeded",
    );
    assert.equal(
      (
        await executeImageCreativeBrief(
          runtime,
          deterministicGateway,
          stageInput,
        )
      ).status,
      "succeeded",
    );
    const providerGateway = createWorkerModelGateway({
      bindings: { OPENROUTER_API_KEY: workerEnv.OPENROUTER_API_KEY },
      executor: opened.database.db,
      identity: opened.identity,
      template: fixture.template,
    });
    assert.equal(
      (await executeImageProvider(runtime, providerGateway, stageInput)).status,
      "succeeded",
    );
    assert.equal(
      (await executeImageBrandedFinal(runtime, stageInput)).status,
      "succeeded",
    );
    const finalContext = await findImageExecutionContext(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    if (!finalContext?.claimedBy) {
      throw new Error("PAID_FINAL_CONTEXT_MISSING");
    }
    assert.ok(
      await settleImageOperationAndWakeNext(
        opened.database.db,
        installation.workspaceId,
        {
          claimedBy: finalContext.claimedBy,
          expectedVersion: finalContext.operationVersion,
          lifecycle: "succeeded",
          mediaBrandId: fixture.mediaBrandId,
          operationId: created.operationId,
        },
      ),
    );
    const committed = await proveFinalizationCommit(
      opened.database.db,
      installation.workspaceId,
      created.operationId,
    );
    const [usage] = await opened.database.db
      .select()
      .from(aiUsageEvent)
      .where(
        and(
          eq(aiUsageEvent.operationId, created.operationId),
          eq(aiUsageEvent.apiKind, "image"),
        ),
      );
    if (
      usage?.status !== "succeeded" ||
      usage.resolvedModel === null ||
      usage.generationId === null ||
      usage.costAuthority !== "billed_openrouter" ||
      usage.openrouterCost === null
    ) {
      throw new Error("ORIGINAL_PROVIDER_OBSERVATION_INCOMPLETE");
    }
    assert.equal(usage.requestedModel, "google/gemini-3-pro-image");
    const [proof] = await opened.database.db
      .select({
        contentLocale: draftRevision.contentLocale,
        finalBytes: mediaAsset.actualBytes,
        revisionCount: sql<number>`count(*) over ()::int`,
        selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
      })
      .from(draftRevision)
      .innerJoin(
        mediaAsset,
        eq(mediaAsset.id, draftRevision.selectedFinalMediaAssetId),
      )
      .where(eq(draftRevision.platformDraftId, fixture.platformDraftId));
    const [original] = await opened.database.db
      .select({ actualBytes: mediaAsset.actualBytes })
      .from(mediaAsset)
      .where(eq(mediaAsset.id, committed.originalId));
    assert.equal(proof?.contentLocale, "fa");
    assert.equal(proof?.revisionCount, 1);
    assert.equal(proof?.selectedFinalMediaAssetId, committed.finalId);
    assert.ok((original?.actualBytes ?? 0) > 0);
    assert.ok((proof?.finalBytes ?? 0) > 0);
    assert.ok(
      await findServableFinalMedia(
        opened.database.db,
        installation.workspaceId,
        committed.finalId,
      ),
    );
    console.log(
      JSON.stringify({
        authoritativeCost: usage.openrouterCost,
        brandedFinalBytes: proof?.finalBytes,
        command: "retryImageGeneration",
        contentLocale: proof?.contentLocale,
        enabledRouteProof: "single_route_only",
        generationId: usage.generationId,
        maxRetries: 0,
        n: 1,
        operationId: created.operationId,
        originalBytes: original?.actualBytes,
        requestedModel: usage.requestedModel,
        resolvedModel: usage.resolvedModel,
        revisionCount: proof?.revisionCount,
        immutableMediaRevision: true,
        servableMediaRoute: "/api/media/:mediaAssetId",
        usageStatus: usage.status,
      }),
    );
  } finally {
    if (fixture) {
      await cleanupFixture(
        opened.database.db,
        fixture.workspaceId,
        fixture.platformDraftId,
        fixture.mediaBrandId,
      );
    }
    await opened.database.close();
  }
}

async function mainFinalization() {
  await proveObservedOpenRouterResponse();
  const opened = openWorkerRuntime();
  const fixtures: Fixture[] = [];
  try {
    const installation = await assertWorkspace({
      db: opened.database.db,
      identity: opened.identity,
    });
    const workspaceId = installation.workspaceId;
    const db = opened.database.db;
    const profile = await proveBrandedComposition(opened.template);
    await proveBrandedFinalBounds(workspaceId, profile);
    const selectionSchemaProfiles = proveSelectionOutputSchema(opened.template);
    const normalizedBriefProfiles = proveCreativeBriefNormalizationProfiles(
      opened.template,
    );

    const prePaidSupersession = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(prePaidSupersession);
    await provePrePaidStageSupersession(
      opened,
      prePaidSupersession,
      workspaceId,
    );

    const startedSupersession = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(startedSupersession);
    await proveStartedImageFinishesUnselected(
      opened,
      startedSupersession,
      workspaceId,
    );

    const succeeded = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(succeeded);
    const finalized = await runImageStagesThroughProvider(
      opened,
      succeeded,
      workspaceId,
    );
    assert.equal(
      (await executeImageBrandedFinal(finalized.runtime, finalized.stageInput))
        .status,
      "succeeded",
    );
    await proveFinalizationCommit(db, workspaceId, finalized.operationId);
    assert.equal(
      (await executeImageBrandedFinal(finalized.runtime, finalized.stageInput))
        .status,
      "succeeded",
    );
    const replayed = await proveFinalizationCommit(
      db,
      workspaceId,
      finalized.operationId,
    );
    await proveImageAdmissionReplay(
      db,
      succeeded,
      finalized.operationId,
      "image_intent_conflict",
    );
    await proveImageRemoval(db, workspaceId, succeeded);
    assert.equal(
      (await executeImageBrandedFinal(finalized.runtime, finalized.stageInput))
        .status,
      "superseded",
    );
    await proveImageRemainsRemoved(
      db,
      succeeded.draftRevisionId,
      finalized.operationId,
    );
    const succeededContext = await findImageExecutionContext(
      db,
      workspaceId,
      finalized.operationId,
    );
    assert.equal(succeededContext?.operationLifecycle, "cancelled");
    const [durableOriginal] = await db
      .select({ cleanupAfter: mediaAsset.cleanupAfter })
      .from(mediaAsset)
      .where(eq(mediaAsset.id, replayed.originalId));
    assert.ok(durableOriginal?.cleanupAfter);

    const changedCopy = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(changedCopy);
    const staleFinal = await runImageStagesThroughProvider(
      opened,
      changedCopy,
      workspaceId,
    );
    await proveChangedCopySkipsAttachment(db, changedCopy);
    assert.equal(
      (
        await executeImageBrandedFinal(
          staleFinal.runtime,
          staleFinal.stageInput,
        )
      ).status,
      "succeeded",
    );
    await proveFinalTargetsInitiatingRevision(
      db,
      workspaceId,
      changedCopy,
      staleFinal.operationId,
    );

    const returnedSelection = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(returnedSelection);
    const returnedFinal = await runImageStagesThroughProvider(
      opened,
      returnedSelection,
      workspaceId,
    );
    await proveChangedCopySkipsAttachment(db, returnedSelection);
    const [changedSelection] = await db
      .select()
      .from(platformDraft)
      .where(eq(platformDraft.id, returnedSelection.platformDraftId));
    assert.ok(changedSelection);
    const [returned] = await db
      .update(platformDraft)
      .set({
        activeRevisionId: returnedSelection.draftRevisionId,
        revisionVersion: sql`${platformDraft.revisionVersion} + 1`,
      })
      .where(
        and(
          eq(platformDraft.id, returnedSelection.platformDraftId),
          eq(
            platformDraft.activeRevisionId,
            changedSelection.activeRevisionId ?? "",
          ),
          eq(platformDraft.revisionVersion, changedSelection.revisionVersion),
        ),
      )
      .returning({ id: platformDraft.id });
    assert.ok(returned);
    await proveImageAdmissionReplay(
      db,
      returnedSelection,
      returnedFinal.operationId,
      "version_conflict",
    );
    const rejectedStaleImage = await startImageGeneration(db, workspaceId, {
      actor: returnedSelection.actorId,
      draftRevisionId: returnedSelection.draftRevisionId,
      expectedImageIntentVersion: 0,
      expectedRevisionVersion: 1,
      idempotencyKey: randomUUID(),
      modelOptionKey: returnedSelection.modelOptionKey,
      requestHash: "stale-image-selection",
      requestId: null,
    });
    assert.equal(rejectedStaleImage.status, "version_conflict");
    assert.equal(
      (
        await executeImageBrandedFinal(
          returnedFinal.runtime,
          returnedFinal.stageInput,
        )
      ).status,
      "succeeded",
    );
    await proveFinalTargetsInitiatingRevision(
      db,
      workspaceId,
      returnedSelection,
      returnedFinal.operationId,
    );

    const legacySelection = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(legacySelection);
    const legacyFinal = await runImageStagesThroughProvider(
      opened,
      legacySelection,
      workspaceId,
    );
    await db
      .update(imageGeneration)
      .set({ expectedImageIntentVersion: null })
      .where(eq(imageGeneration.operationId, legacyFinal.operationId));
    assert.equal(
      (
        await executeImageBrandedFinal(
          legacyFinal.runtime,
          legacyFinal.stageInput,
        )
      ).status,
      "succeeded",
    );
    const legacyRevisions = await db
      .select()
      .from(draftRevision)
      .where(
        eq(draftRevision.platformDraftId, legacySelection.platformDraftId),
      );
    assert.equal(legacyRevisions.length, 1);
    assert.equal(legacyRevisions[0]?.selectedFinalMediaAssetId, null);

    const failed = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(failed);
    const unfinalized = await runImageStagesThroughProvider(
      opened,
      failed,
      workspaceId,
    );
    const failedContext = await findImageExecutionContext(
      db,
      workspaceId,
      unfinalized.operationId,
    );
    if (!failedContext?.providerOriginalMediaAssetId) {
      throw new Error("FAILED_FIXTURE_ORIGINAL_MISSING");
    }
    const settledFailure = await settleImageOperationAndWakeNext(
      db,
      workspaceId,
      {
        claimedBy: unfinalized.stageInput.token,
        expectedVersion: failedContext.operationVersion,
        lifecycle: "failed",
        mediaBrandId: failed.mediaBrandId,
        operationId: unfinalized.operationId,
      },
    );
    if (!settledFailure) throw new Error("FAILED_FIXTURE_NOT_SETTLED");
    const [retainedOriginal] = await db
      .select({ cleanupAfter: mediaAsset.cleanupAfter })
      .from(mediaAsset)
      .where(eq(mediaAsset.id, failedContext.providerOriginalMediaAssetId));
    const retainedFor =
      (retainedOriginal?.cleanupAfter?.getTime() ?? 0) -
      settledFailure.updatedAt.getTime();
    assert.equal(retainedFor, FAILED_ORIGINAL_CLEANUP_DELAY_MS);
    assert.equal(
      (
        await db
          .select({ id: imageVarietyMemory.id })
          .from(imageVarietyMemory)
          .where(
            eq(imageVarietyMemory.imageGenerationId, unfinalized.operationId),
          )
      ).length,
      0,
    );

    const stale = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(stale);
    await proveStaleImageOperations(db, workspaceId, stale);

    const deterministic = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(deterministic);
    const deterministicCreativeOperationId =
      await proveDeterministicCreativeBrief(opened, deterministic, workspaceId);

    const nearExpiry = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(nearExpiry);
    const renewedLeaseOperationId = await proveFinalStageLeaseRenewal(
      opened,
      nearExpiry,
      workspaceId,
    );

    const expiredLease = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(expiredLease);
    const requeuedExpiredLeaseOperationId =
      await proveExpiredLeaseFinalStageRelease(
        opened,
        expiredLease,
        workspaceId,
      );

    const jpegReference = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(jpegReference);
    const jpegReferenceOperationId = await proveJpegReferenceInvocation(
      opened,
      jpegReference,
      workspaceId,
    );

    const providerRejection = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(providerRejection);
    const providerRejectionOperationId = await proveImageProviderRejection(
      opened,
      providerRejection,
      workspaceId,
    );

    const normalizedBrief = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
    );
    fixtures.push(normalizedBrief);
    const normalizedBriefOperationId = await proveCreativeBriefNormalization(
      opened,
      normalizedBrief,
      workspaceId,
    );

    const bannedBrief = await createFixture(
      db,
      workspaceId,
      opened.template,
      opened.identity.fingerprint,
      "coin-hall",
    );
    fixtures.push(bannedBrief);
    const rejectedBriefOperationId = await proveBannedCreativeBriefRejection(
      opened,
      bannedBrief,
      workspaceId,
    );

    console.log(
      JSON.stringify({
        composedFormat: "png",
        composedHeight: profile.output.height,
        composedWidth: profile.output.width,
        deterministicCreativeOperationId,
        finalMediaAssetId: replayed.finalId,
        finalizedOperationId: finalized.operationId,
        jpegReferenceOperationId,
        normalizedBriefOperationId,
        normalizedBriefProfiles,
        providerCalls: 0,
        revisionFences:
          "immutable-media-snapshot,replay,remove,reselected-source,legacy-admission",
        providerRejectionOperationId,
        rejectedBriefOperationId,
        renewedLeaseOperationId,
        requeuedExpiredLeaseOperationId,
        selectionSchemaProfiles,
      }),
    );
  } finally {
    for (const fixture of fixtures) {
      await cleanupFixture(
        opened.database.db,
        fixture.workspaceId,
        fixture.platformDraftId,
        fixture.mediaBrandId,
        fixture.reference.id,
      );
    }
    await opened.database.close();
  }
}

async function proveBrandedComposition(template: CustomerTemplate) {
  const brand = template.mediaBrands.find(
    (item) => item.imageProfile && item.brandLogo,
  );
  if (!brand?.imageProfile || !brand.brandLogo) {
    throw new Error("BRAND_LOGO_FIXTURE_REQUIRED");
  }
  const customerRoot = resolve(
    resolveArtifactRoot(import.meta.url),
    "customer-templates",
    template.customer.key,
  );
  const profile = imageProfileSchema.parse(
    JSON.parse(readFileSync(resolve(customerRoot, brand.imageProfile), "utf8")),
  );
  const logo = readFileSync(resolve(customerRoot, brand.brandLogo.path));
  const original = await sharp({
    create: {
      background: { alpha: 1, b: 20, g: 30, r: 200 },
      channels: 4,
      height: 600,
      width: 900,
    },
  })
    .png()
    .toBuffer();
  const composed = await composeBrandedFinal({ logo, original, profile });
  const metadata = await sharp(composed).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, profile.output.width);
  assert.equal(metadata.height, profile.output.height);

  const shortSide = Math.min(profile.output.width, profile.output.height);
  const logoWidth = Math.round(profile.logo.widthShortSideRatio * shortSide);
  const inset = Math.round(profile.logo.insetShortSideRatio * shortSide);
  const logoHeight = (
    await sharp(
      await sharp(logo).resize({ width: logoWidth }).png().toBuffer(),
    ).metadata()
  ).height;
  const stamped = await sharp(composed)
    .extract({
      height: logoHeight,
      left: inset,
      top: profile.output.height - inset - logoHeight,
      width: logoWidth,
    })
    .raw()
    .toBuffer();
  assert.ok(new Set(stamped).size > 1);
  const untouched = await sharp(composed)
    .extract({
      height: 100,
      left: Math.round(profile.output.width / 2),
      top: Math.round(profile.output.height / 2),
      width: 100,
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let pixel = 0; pixel < 100 * 100; pixel += 1) {
    const offset = pixel * untouched.info.channels;
    assert.deepEqual(
      [
        untouched.data[offset],
        untouched.data[offset + 1],
        untouched.data[offset + 2],
      ],
      [200, 30, 20],
    );
  }
  return profile;
}

async function proveBrandedFinalBounds(
  workspaceId: string,
  profile: ReturnType<typeof imageProfileSchema.parse>,
) {
  const storage = workerStorage();
  const { height, width } = profile.output;
  const exact = await sharp({
    create: {
      background: { alpha: 1, b: 5, g: 5, r: 5 },
      channels: 4,
      height,
      width,
    },
  })
    .png()
    .toBuffer();
  for (const bytes of [
    new Uint8Array([1, 2, 3]),
    await sharp({
      create: {
        background: { alpha: 1, b: 5, g: 5, r: 5 },
        channels: 4,
        height: 64,
        width: 64,
      },
    })
      .png()
      .toBuffer(),
    await sharp(exact).jpeg().toBuffer(),
  ]) {
    const objectKey = `${workspaceId}/image-finals/${randomUUID()}`;
    await assert.rejects(
      prepareBrandedFinal(storage, {
        bytes,
        height,
        mediaAssetId: randomUUID(),
        objectKey,
        width,
      }),
      (error: unknown) =>
        error instanceof ImagePreparationError && !error.ambiguous,
    );
    await assert.rejects(storage.head(objectKey));
  }

  const acceptedKey = `${workspaceId}/image-finals/${randomUUID()}`;
  const prepared = await prepareBrandedFinal(storage, {
    bytes: exact,
    height,
    mediaAssetId: randomUUID(),
    objectKey: acceptedKey,
    width,
  });
  assert.deepEqual(
    {
      height: prepared.height,
      mimeType: prepared.mimeType,
      width: prepared.width,
    },
    { height, mimeType: "image/png", width },
  );
  assert.equal(prepared.checksum, hash(exact));
  await storage.delete([acceptedKey]);

  const corruptedKey = `${workspaceId}/image-finals/${randomUUID()}`;
  const corrupting: Storage = {
    delete: (keys) => storage.delete(keys),
    getSignedUrl: (key, expiresIn) => storage.getSignedUrl(key, expiresIn),
    head: (key) => storage.head(key),
    list: (input) => storage.list(input),
    openRead: async (key) =>
      key === corruptedKey
        ? { stream: new Blob([new Uint8Array([0])]).stream() }
        : storage.openRead(key),
    put: (key, body, contentType) => storage.put(key, body, contentType),
  };
  await assert.rejects(
    prepareBrandedFinal(corrupting, {
      bytes: exact,
      height,
      mediaAssetId: randomUUID(),
      objectKey: corruptedKey,
      width,
    }),
    (error: unknown) =>
      error instanceof ImagePreparationError && error.ambiguous,
  );
  assert.ok(await storage.head(corruptedKey));
  await storage.delete([corruptedKey]);
}

async function runImageStagesThroughProvider(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const runtime: WorkerRuntime = {
    db: opened.database.db,
    identity: opened.identity,
    template: fixture.template,
  };
  const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted");
  const gateway = createWorkerModelGateway({
    adapters: { local: adapter, remote: adapter },
    bindings: {},
    executor: opened.database.db,
    identity: opened.identity,
    template: fixture.template,
  });
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(opened.database.db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey }),
    requestId: null,
  });
  if (!("operationId" in created)) {
    throw new Error("FINALIZATION_FIXTURE_NOT_CREATED");
  }
  const token = `finalization:${randomUUID()}`;
  const claim = await claimOperationExecution(opened.database.db, workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") {
    throw new Error("FINALIZATION_FIXTURE_CLAIM_REJECTED");
  }
  const stageInput = {
    operationId: created.operationId,
    token,
    workspaceId,
  };
  assert.equal(
    (await executeImageSelection(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageProvider(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  return { operationId: created.operationId, runtime, stageInput };
}

async function provePrePaidStageSupersession(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const runtime: WorkerRuntime = {
    db,
    identity: opened.identity,
    template: fixture.template,
  };
  const firstKey = randomUUID();
  const first = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey: firstKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ firstKey }),
    requestId: null,
  });
  if (!("operationId" in first)) {
    throw new Error("PRE_PAID_SUPERSESSION_FIRST_NOT_CREATED");
  }
  const token = `pre-paid-supersession:${randomUUID()}`;
  const claimed = await claimOperationExecution(db, workspaceId, {
    claimedBy: token,
    id: first.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claimed.status !== "claimed") {
    throw new Error("PRE_PAID_SUPERSESSION_FIRST_NOT_CLAIMED");
  }
  const secondKey = randomUUID();
  const second = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 1,
    expectedRevisionVersion: 1,
    idempotencyKey: secondKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ secondKey }),
    requestId: null,
  });
  assert.equal(second.status, "created");
  const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted");
  const gateway = createWorkerModelGateway({
    adapters: { local: adapter, remote: adapter },
    bindings: {},
    executor: db,
    identity: opened.identity,
    template: fixture.template,
  });
  assert.equal(
    (
      await executeImageSelection(runtime, gateway, {
        operationId: first.operationId,
        token,
        workspaceId,
      })
    ).status,
    "superseded",
  );
  assert.equal(adapter.structuredCalls, 0);
  const superseded = await findImageExecutionContext(
    db,
    workspaceId,
    first.operationId,
  );
  assert.equal(superseded?.operationLifecycle, "cancelled");
}

async function proveStartedImageFinishesUnselected(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const staged = await runImageStagesThroughProvider(
    opened,
    fixture,
    workspaceId,
  );
  const replacementKey = randomUUID();
  const replacement = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 1,
    expectedRevisionVersion: 1,
    idempotencyKey: replacementKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ replacementKey }),
    requestId: null,
  });
  assert.equal(replacement.status, "created");
  assert.equal(
    (await executeImageBrandedFinal(staged.runtime, staged.stageInput)).status,
    "superseded",
  );
  const context = await findImageExecutionContext(
    db,
    workspaceId,
    staged.operationId,
  );
  if (!context?.finalMediaAssetId) {
    throw new Error("STARTED_SUPERSEDED_FINAL_MISSING");
  }
  const [revision] = await db
    .select({
      imageIntentVersion: draftRevision.imageIntentVersion,
      selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
    })
    .from(draftRevision)
    .where(eq(draftRevision.id, fixture.draftRevisionId));
  assert.equal(revision?.imageIntentVersion, 2);
  assert.equal(revision?.selectedFinalMediaAssetId, null);
  assert.equal(context.operationLifecycle, "cancelled");
}

async function proveFinalStageLeaseRenewal(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const staged = await runImageStagesThroughProvider(
    opened,
    fixture,
    workspaceId,
  );
  const before = await findImageExecutionContext(
    db,
    workspaceId,
    staged.operationId,
  );
  if (!before) throw new Error("LEASE_RENEWAL_CONTEXT_MISSING");
  const nearExpiry = new Date(Date.now() + 2_000);
  await db
    .update(operation)
    .set({ leaseExpiresAt: nearExpiry })
    .where(eq(operation.id, staged.operationId));
  assert.equal(
    (await executeImageBrandedFinal(staged.runtime, staged.stageInput)).status,
    "succeeded",
  );
  const after = await findImageExecutionContext(
    db,
    workspaceId,
    staged.operationId,
  );
  assert.ok(after?.finalMediaAssetId);
  assert.equal(after?.operationVersion, before.operationVersion + 3);
  const [renewed] = await db
    .select({ leaseExpiresAt: operation.leaseExpiresAt })
    .from(operation)
    .where(eq(operation.id, staged.operationId));
  assert.ok(
    (renewed?.leaseExpiresAt?.getTime() ?? 0) >=
      nearExpiry.getTime() + IMAGE_PROVIDER_DEADLINE_MS,
  );
  const settled = await settleImageOperationAndWakeNext(db, workspaceId, {
    claimedBy: staged.stageInput.token,
    expectedVersion: after.operationVersion,
    lifecycle: "succeeded",
    mediaBrandId: fixture.mediaBrandId,
    operationId: staged.operationId,
  });
  assert.equal(settled?.lifecycle, "succeeded");
  return staged.operationId;
}

async function proveExpiredLeaseFinalStageRelease(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const staged = await runImageStagesThroughProvider(
    opened,
    fixture,
    workspaceId,
  );
  const before = await findImageExecutionContext(
    db,
    workspaceId,
    staged.operationId,
  );
  if (!before?.providerOriginalMediaAssetId) {
    throw new Error("EXPIRED_LEASE_ORIGINAL_MISSING");
  }
  await db
    .update(operation)
    .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
    .where(eq(operation.id, staged.operationId));
  assert.equal(
    (await executeImageBrandedFinal(staged.runtime, staged.stageInput)).status,
    "waiting",
  );
  const stranded = await findImageExecutionContext(
    db,
    workspaceId,
    staged.operationId,
  );
  assert.equal(stranded?.finalMediaAssetId, null);
  assert.equal(stranded?.operationLifecycle, "running");
  const released = await releaseImageOperationAndWake(db, workspaceId, {
    claimedBy: staged.stageInput.token,
    expectedVersion: before.operationVersion,
    operationId: staged.operationId,
  });
  assert.equal(released?.lifecycle, "queued");
  assert.equal(released?.claimedBy, null);
  const wakes = await db
    .select({ id: outboxEvent.id })
    .from(outboxEvent)
    .where(
      and(
        eq(outboxEvent.operationId, staged.operationId),
        eq(
          outboxEvent.eventType,
          OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
        ),
        isNull(outboxEvent.dispatchedAt),
      ),
    );
  assert.equal(wakes.length, 1);
  return staged.operationId;
}

async function proveJpegReferenceInvocation(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const runtime: WorkerRuntime = {
    db,
    identity: opened.identity,
    template: fixture.template,
  };
  const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted");
  const gateway = createWorkerModelGateway({
    adapters: { local: adapter, remote: adapter },
    bindings: {},
    executor: db,
    identity: opened.identity,
    template: fixture.template,
  });
  const bytes = await sharp({
    create: {
      background: { alpha: 1, b: 20, g: 30, r: 200 },
      channels: 4,
      height: 600,
      width: 900,
    },
  })
    .jpeg()
    .toBuffer();
  const decoded = await sharp(bytes).metadata();
  assert.equal(decoded.format, "jpeg");
  const referenceId = randomUUID();
  const objectKey = `${workspaceId}/probe-references/${referenceId}.jpg`;
  await workerStorage().put(objectKey, bytes, "image/jpeg");
  await db.insert(mediaAsset).values({
    actualBytes: bytes.byteLength,
    checksum: hash(bytes),
    declaredBytes: bytes.byteLength,
    height: decoded.height,
    id: referenceId,
    kind: `${FIXTURE_PREFIX}:reference`,
    lifecycle: "verified",
    mimeType: "image/jpeg",
    objectKey,
    verifiedAt: new Date(),
    width: decoded.width,
    workspaceId,
  });
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    referenceMediaAssetId: referenceId,
    requestHash: commandHash({
      idempotencyKey,
      referenceMediaAssetId: referenceId,
    }),
    requestId: null,
  });
  if (!("operationId" in created)) {
    throw new Error("JPEG_REFERENCE_OPERATION_NOT_CREATED");
  }
  const token = `jpeg-reference:${randomUUID()}`;
  const claim = await claimOperationExecution(db, workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") {
    throw new Error("JPEG_REFERENCE_CLAIM_REJECTED");
  }
  const stageInput = { operationId: created.operationId, token, workspaceId };
  assert.equal(
    (await executeImageSelection(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageProvider(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(adapter.imageCalls, 1);
  assert.equal(adapter.references.at(-1), hash(bytes));
  assert.equal(adapter.referenceMimeTypes.at(-1), "image/jpeg");
  const context = await findImageExecutionContext(
    db,
    workspaceId,
    created.operationId,
  );
  if (!context?.providerOriginalMediaAssetId) {
    throw new Error("JPEG_REFERENCE_ORIGINAL_MISSING");
  }
  const cancelled = await settleImageOperationAndWakeNext(db, workspaceId, {
    claimedBy: token,
    expectedVersion: context.operationVersion,
    lifecycle: "cancelled",
    mediaBrandId: fixture.mediaBrandId,
    operationId: created.operationId,
  });
  if (!cancelled) throw new Error("JPEG_REFERENCE_NOT_CANCELLED");
  const [retained] = await db
    .select({ cleanupAfter: mediaAsset.cleanupAfter })
    .from(mediaAsset)
    .where(eq(mediaAsset.id, context.providerOriginalMediaAssetId));
  assert.equal(
    (retained?.cleanupAfter?.getTime() ?? 0) - cancelled.updatedAt.getTime(),
    FAILED_ORIGINAL_CLEANUP_DELAY_MS,
  );
  return created.operationId;
}

async function proveImageProviderRejection(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const runtime: WorkerRuntime = {
    db,
    identity: opened.identity,
    template: fixture.template,
  };
  const structured = new DeterministicImageAdapter(
    fixture.fallback,
    "accepted",
  );
  let rejectedImageRequests = 0;
  const rejecting = createOpenRouterAdapter("deterministic-no-provider", {
    fetch: async () => {
      rejectedImageRequests += 1;
      return new Response(JSON.stringify({ error: { message: "rejected" } }), {
        headers: { "content-type": "application/json" },
        status: 400,
      });
    },
  });
  const remote: RemoteModelAdapter = {
    embedMany: () => structured.embedMany(),
    generateImage: (input) => rejecting.generateImage(input),
    generateStructured<TOutput>(input: StructuredAdapterInput<TOutput>) {
      return structured.generateStructured(input);
    },
  };
  const gateway = createWorkerModelGateway({
    adapters: { local: structured, remote },
    bindings: {},
    executor: db,
    identity: opened.identity,
    template: fixture.template,
  });
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey }),
    requestId: null,
  });
  if (!("operationId" in created)) {
    throw new Error("PROVIDER_REJECTION_OPERATION_NOT_CREATED");
  }
  const token = `provider-rejection:${randomUUID()}`;
  const claim = await claimOperationExecution(db, workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") {
    throw new Error("PROVIDER_REJECTION_CLAIM_REJECTED");
  }
  const stageInput = { operationId: created.operationId, token, workspaceId };
  assert.equal(
    (await executeImageSelection(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  const emitted: string[] = [];
  const write = process.stdout.write;
  process.stdout.write = (chunk: Uint8Array | string) => {
    emitted.push(
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(),
    );
    return true;
  };
  let provider: Awaited<ReturnType<typeof executeImageProvider>>;
  try {
    provider = await executeImageProvider(runtime, gateway, stageInput);
  } finally {
    process.stdout.write = write;
  }
  process.stdout.write(emitted.join(""));
  assert.equal(provider.status, "failed");

  const task =
    fixture.template.models?.tasks[
      `image-generation:${fixture.modelOptionKey}`
    ];
  const expectedSlots = (
    task?.fallback ? ["fallback", "primary", "retry-1"] : ["primary", "retry-1"]
  ).sort();
  assert.equal(rejectedImageRequests, expectedSlots.length);
  assert.equal(structured.imageCalls, 0);

  const logged = emitted
    .flatMap((line) => line.split("\n"))
    .flatMap((line) => {
      const parsed = imageFailedLogSchema.safeParse(parseLogLine(line));
      return parsed.success ? [parsed.data] : [];
    });
  assert.deepEqual(
    logged
      .map(
        (entry) => `${entry.invocationKey}:${entry.reason}:${entry.httpStatus}`,
      )
      .sort(),
    expectedSlots.map((slot) => `${slot}:PROVIDER_REJECTED_4XX:400`),
  );
  for (const entry of logged) {
    assert.equal(entry.operationId, created.operationId);
    assert.equal(entry.taskKey, `image-generation:${fixture.modelOptionKey}`);
  }

  const usage = await db
    .select({
      finishReason: aiUsageEvent.finishReason,
      invocationKey: aiUsageEvent.invocationKey,
      resolvedModel: aiUsageEvent.resolvedModel,
      status: aiUsageEvent.status,
    })
    .from(aiUsageEvent)
    .where(
      and(
        eq(aiUsageEvent.workspaceId, workspaceId),
        eq(aiUsageEvent.operationId, created.operationId),
        eq(aiUsageEvent.apiKind, "image"),
      ),
    );
  assert.deepEqual(
    usage
      .map((row) => `${row.invocationKey}:${row.status}:${row.finishReason}`)
      .sort(),
    expectedSlots.map((slot) => `${slot}:failed:PROVIDER_REJECTED_4XX`),
  );

  const context = await findImageExecutionContext(
    db,
    workspaceId,
    created.operationId,
  );
  if (!context) throw new Error("PROVIDER_REJECTION_CONTEXT_MISSING");
  assert.equal(context.providerOriginalMediaAssetId, null);
  const settled = await settleImageOperationAndWakeNext(db, workspaceId, {
    claimedBy: token,
    expectedVersion: context.operationVersion,
    lifecycle: "failed",
    mediaBrandId: fixture.mediaBrandId,
    operationId: created.operationId,
  });
  if (!settled) throw new Error("PROVIDER_REJECTION_NOT_SETTLED");
  return created.operationId;
}

const imageFailedLogSchema = z.object({
  attemptId: z.uuid(),
  event: z.literal("model-gateway.image-failed"),
  httpStatus: z.number(),
  invocationKey: z.string(),
  level: z.literal("warn"),
  operationId: z.uuid(),
  reason: z.string(),
  taskKey: z.string(),
});

function parseLogLine(line: string): unknown {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

async function proveCreativeBriefNormalization(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const runtime: WorkerRuntime = {
    db,
    identity: opened.identity,
    template: fixture.template,
  };
  const family = fixture.profile.families[fixture.fallback.selection.family];
  if (!family) throw new Error("NORMALIZATION_FIXTURE_FAMILY_MISSING");
  const maxWords = fixture.profile.textPolicy.headlineMaxWords;
  const uppercase =
    family.headlineUppercase ??
    fixture.profile.textPolicy.headlineUppercase ??
    false;
  assert.equal(uppercase, true);
  const headline = Array.from(
    { length: maxWords + 9 },
    (_, index) => `word${index}`,
  ).join("  ");
  const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted", {
    dataElements: Array.from({ length: family.dataBudget + 4 }, (_, index) => ({
      label: `label ${index}`,
      value: "۱۲۳۴۵۶۷۸۹۰۱",
    })),
    headline,
    subjectScene: "A neutral fixture scene with no restricted subject.",
  });
  const gateway = createWorkerModelGateway({
    adapters: { local: adapter, remote: adapter },
    bindings: {},
    executor: db,
    identity: opened.identity,
    template: fixture.template,
  });
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey }),
    requestId: null,
  });
  if (!("operationId" in created)) {
    throw new Error("NORMALIZATION_FIXTURE_NOT_CREATED");
  }
  const token = `brief-normalization:${randomUUID()}`;
  const claim = await claimOperationExecution(db, workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") {
    throw new Error("NORMALIZATION_FIXTURE_CLAIM_REJECTED");
  }
  const stageInput = { operationId: created.operationId, token, workspaceId };
  assert.equal(
    (await executeImageSelection(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  const persisted = await loadImageProviderInput(
    db,
    workspaceId,
    created.operationId,
  );
  assert.equal(persisted?.brief.status, "succeeded");
  assert.equal(persisted?.brief.deterministicFallback, false);
  const brief = creativeImageBriefSchema.parse(persisted?.brief.creativeBrief);
  const truncated = headline.split(/\s+/u).slice(0, maxWords).join(" ");
  assert.equal(brief.headline, truncated.toLocaleUpperCase("und"));
  assert.notEqual(brief.headline, truncated);
  assert.equal(brief.dataElements.length, family.dataBudget);
  assert.equal(
    brief.dataElements.every(
      (item) =>
        [...item.value].length ===
        Math.min(11, family.dataValueMaxLength ?? 11),
    ),
    true,
  );
  assert.ok(
    persisted?.brief.providerPrompt?.includes(`Headline: ${brief.headline}`),
  );
  assert.equal(adapter.imageCalls, 0);
  assert.equal(await usageCount(db, created.operationId), 2);
  const [creativeAttempt] = await db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(
          operationAttempt.id,
          stableImageIdentity(created.operationId, "creative"),
        ),
      ),
    );
  assert.deepEqual(creativeAttempt, {
    failureCode: null,
    outcome: "succeeded",
  });
  const context = await findImageExecutionContext(
    db,
    workspaceId,
    created.operationId,
  );
  if (!context?.claimedBy) throw new Error("NORMALIZATION_CONTEXT_MISSING");
  assert.ok(
    await settleImageOperationAndWakeNext(db, workspaceId, {
      claimedBy: context.claimedBy,
      expectedVersion: context.operationVersion,
      lifecycle: "cancelled",
      mediaBrandId: fixture.mediaBrandId,
      operationId: created.operationId,
    }),
  );
  return created.operationId;
}

async function proveBannedCreativeBriefRejection(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const runtime: WorkerRuntime = {
    db,
    identity: opened.identity,
    template: fixture.template,
  };
  const banned = fixture.profile.restrictions.bannedSubjectTerms?.[0];
  if (banned === undefined) throw new Error("BANNED_TERM_FIXTURE_REQUIRED");
  const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted", {
    dataElements: [],
    headline: fixture.fallback.brief.headline,
    subjectScene: `A marble hall displaying a ${banned.toLocaleUpperCase("und")} on a plinth.`,
  });
  const gateway = createWorkerModelGateway({
    adapters: { local: adapter, remote: adapter },
    bindings: {},
    executor: db,
    identity: opened.identity,
    template: fixture.template,
  });
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey }),
    requestId: null,
  });
  if (!("operationId" in created)) {
    throw new Error("BANNED_TERM_FIXTURE_NOT_CREATED");
  }
  const token = `banned-brief:${randomUUID()}`;
  const claim = await claimOperationExecution(db, workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") {
    throw new Error("BANNED_TERM_FIXTURE_CLAIM_REJECTED");
  }
  const stageInput = { operationId: created.operationId, token, workspaceId };
  assert.equal(
    (await executeImageSelection(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
    "failed",
  );
  const persisted = await loadImageProviderInput(
    db,
    workspaceId,
    created.operationId,
  );
  assert.equal(persisted?.brief.status, "failed");
  assert.equal(persisted?.brief.terminalFailureCode, "VALIDATION_FAILED");
  assert.equal(persisted?.brief.creativeBrief, null);
  assert.equal(persisted?.brief.providerPrompt, null);
  const creativeAttemptId = stableImageIdentity(
    created.operationId,
    "creative",
  );
  assert.equal(
    persisted?.brief.creativeBriefOperationAttemptId,
    creativeAttemptId,
  );
  const [creativeAttempt] = await db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(operationAttempt.id, creativeAttemptId),
      ),
    );
  assert.deepEqual(creativeAttempt, {
    failureCode: "VALIDATION_FAILED",
    outcome: "failed_terminal",
  });
  const usage = await listImageStageUsage(db, workspaceId, creativeAttemptId);
  assert.deepEqual(
    usage.map((item) => `${item.invocationKey}:${item.status}`).sort(),
    ["fallback:succeeded", "primary:succeeded", "retry-1:succeeded"],
  );
  assert.equal(adapter.imageCalls, 0);
  const creativePrompts = adapter.structuredPrompts.slice(1);
  assert.equal(creativePrompts.length, 3);
  assert.equal(creativePrompts[0]?.includes("BANNED_TERM"), false);
  assert.equal(creativePrompts[1]?.includes("BANNED_TERM"), true);
  assert.equal(creativePrompts[2]?.includes("BANNED_TERM"), true);
  const context = await findImageExecutionContext(
    db,
    workspaceId,
    created.operationId,
  );
  if (!context?.claimedBy) throw new Error("BANNED_TERM_CONTEXT_MISSING");
  assert.equal(context.operationLifecycle, "running");
  const settled = await settleImageOperationAndWakeNext(db, workspaceId, {
    claimedBy: context.claimedBy,
    expectedVersion: context.operationVersion,
    lifecycle: "failed",
    mediaBrandId: fixture.mediaBrandId,
    operationId: created.operationId,
  });
  assert.equal(settled?.lifecycle, "failed");
  const terminal = await loadImageProviderInput(
    db,
    workspaceId,
    created.operationId,
  );
  assert.equal(terminal?.brief.status, "failed");
  return created.operationId;
}

async function proveDeterministicCreativeBrief(
  opened: ReturnType<typeof openWorkerRuntime>,
  fixture: Fixture,
  workspaceId: string,
) {
  const db = opened.database.db;
  const runtime: WorkerRuntime = {
    db,
    identity: opened.identity,
    template: fixture.template,
  };
  const adapter = new DeterministicImageAdapter(
    fixture.fallback,
    "invalid-selection",
  );
  const gateway = createWorkerModelGateway({
    adapters: { local: adapter, remote: adapter },
    bindings: {},
    executor: db,
    identity: opened.identity,
    template: fixture.template,
  });
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey }),
    requestId: null,
  });
  if (!("operationId" in created)) {
    throw new Error("DETERMINISTIC_CREATIVE_FIXTURE_NOT_CREATED");
  }
  const token = `deterministic-creative:${randomUUID()}`;
  const claim = await claimOperationExecution(db, workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  if (claim.status !== "claimed") {
    throw new Error("DETERMINISTIC_CREATIVE_FIXTURE_CLAIM_REJECTED");
  }
  const stageInput = { operationId: created.operationId, token, workspaceId };
  assert.equal(
    (await executeImageSelection(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  assert.equal(
    (await loadImageProviderInput(db, workspaceId, created.operationId))?.brief
      .deterministicFallback,
    true,
  );
  assert.equal(
    (await executeImageCreativeBrief(runtime, gateway, stageInput)).status,
    "succeeded",
  );
  const persisted = await loadImageProviderInput(
    db,
    workspaceId,
    created.operationId,
  );
  assert.equal(persisted?.brief.status, "succeeded");
  assert.equal(persisted?.brief.creativeBriefOperationAttemptId, null);
  assert.ok(persisted?.brief.providerPrompt);
  const [creativeAttempt] = await db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.workspaceId, workspaceId),
        eq(
          operationAttempt.id,
          stableImageIdentity(created.operationId, "creative"),
        ),
      ),
    );
  assert.equal(creativeAttempt?.outcome, "succeeded");
  const context = await findImageExecutionContext(
    db,
    workspaceId,
    created.operationId,
  );
  if (!context?.claimedBy) {
    throw new Error("DETERMINISTIC_CREATIVE_CONTEXT_MISSING");
  }
  assert.ok(
    await settleImageOperationAndWakeNext(db, workspaceId, {
      claimedBy: context.claimedBy,
      expectedVersion: context.operationVersion,
      lifecycle: "cancelled",
      mediaBrandId: fixture.mediaBrandId,
      operationId: created.operationId,
    }),
  );
  return created.operationId;
}

async function proveFinalizationCommit(
  db: Executor,
  workspaceId: string,
  operationId: string,
) {
  const [generation] = await db
    .select()
    .from(imageGeneration)
    .where(eq(imageGeneration.operationId, operationId));
  const finalId = generation?.finalMediaAssetId;
  const originalId = generation?.providerOriginalMediaAssetId;
  if (!finalId || !originalId) throw new Error("FINAL_MEDIA_NOT_ATTACHED");
  const [finalAsset] = await db
    .select()
    .from(mediaAsset)
    .where(eq(mediaAsset.id, finalId));
  assert.equal(finalAsset?.kind, "image_final");
  assert.equal(finalAsset?.lifecycle, "verified");
  assert.equal(finalAsset?.mimeType, "image/png");
  assert.equal(finalAsset?.cleanupAfter, null);
  assert.equal(finalAsset?.objectRemovedAt, null);
  if (!finalAsset?.checksum) throw new Error("FINAL_MEDIA_CHECKSUM_MISSING");
  assert.equal(
    hash(await readStorageBytes(workerStorage(), finalAsset.objectKey)),
    finalAsset.checksum,
  );
  const servable = await findServableFinalMedia(db, workspaceId, finalId);
  assert.equal(servable?.objectKey, finalAsset.objectKey);
  assert.equal(await findServableFinalMedia(db, workspaceId, originalId), null);

  const derivations = await db
    .select()
    .from(mediaDerivation)
    .where(eq(mediaDerivation.derivedMediaAssetId, finalId));
  assert.equal(derivations.length, 1);
  assert.equal(derivations[0]?.sourceMediaAssetId, originalId);
  assert.equal(derivations[0]?.purpose, "sharp_brand_logo");

  const brief = await loadImageProviderInput(db, workspaceId, operationId);
  const selection = brief?.brief.templateSelection;
  if (!selection) throw new Error("FINAL_SELECTION_MISSING");
  const memory = await db
    .select()
    .from(imageVarietyMemory)
    .where(eq(imageVarietyMemory.imageGenerationId, operationId));
  assert.equal(memory.length, 1);
  assert.equal(
    memory[0]?.selectionSignature,
    selectionSignature(brief.brief.imageProfileFingerprint, selection),
  );

  const [original] = await db
    .select()
    .from(mediaAsset)
    .where(eq(mediaAsset.id, originalId));
  assert.equal(original?.lifecycle, "verified");
  assert.equal(original?.cleanupAfter, null);
  assert.notEqual(originalId, finalId);
  const revisions = await db
    .select({
      id: draftRevision.id,
      imageIntentVersion: draftRevision.imageIntentVersion,
      revisionNumber: draftRevision.revisionNumber,
      selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
    })
    .from(draftRevision)
    .where(
      and(
        eq(draftRevision.workspaceId, workspaceId),
        eq(draftRevision.id, generation.draftRevisionId),
      ),
    );
  assert.equal(revisions.length, 1);
  assert.equal(revisions[0]?.id, generation.draftRevisionId);
  assert.equal(revisions[0]?.imageIntentVersion, 1);
  assert.equal(revisions[0]?.revisionNumber, 1);
  assert.equal(revisions[0]?.selectedFinalMediaAssetId, finalId);
  const receipts = await db
    .select()
    .from(draftRevisionCommandReceipt)
    .where(
      and(
        eq(draftRevisionCommandReceipt.workspaceId, workspaceId),
        eq(draftRevisionCommandReceipt.commandKind, "adopt_image"),
        eq(draftRevisionCommandReceipt.idempotencyKey, operationId),
      ),
    );
  assert.equal(receipts.length, 0);
  const [active] = await db
    .select({
      revision: draftRevision,
      revisionVersion: platformDraft.revisionVersion,
    })
    .from(platformDraft)
    .innerJoin(
      draftRevision,
      eq(draftRevision.id, platformDraft.activeRevisionId),
    )
    .where(eq(platformDraft.activeRevisionId, generation.draftRevisionId));
  assert.equal(active?.revision.selectedFinalMediaAssetId, finalId);
  assert.equal(active?.revision.revisionNumber, 1);
  assert.equal(active?.revisionVersion, 1);
  assert.ok(active);
  return { finalId, originalId };
}

async function proveImageRemoval(
  db: Executor,
  workspaceId: string,
  fixture: Fixture,
) {
  const [before] = await db
    .select({
      id: draftRevision.id,
      imageIntentVersion: draftRevision.imageIntentVersion,
      revisionVersion: platformDraft.revisionVersion,
      selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
    })
    .from(platformDraft)
    .innerJoin(
      draftRevision,
      eq(draftRevision.id, platformDraft.activeRevisionId),
    )
    .where(eq(platformDraft.id, fixture.platformDraftId));
  assert.ok(before?.selectedFinalMediaAssetId);
  const idempotencyKey = randomUUID();
  const expectedActive = {
    id: before.id,
    version: before.revisionVersion,
  };
  const semanticPayload = {
    commandKind: "remove_image" as const,
    expectedImageIntentVersion: before.imageIntentVersion,
    platformDraftId: fixture.platformDraftId,
    expectedActive,
  };
  const input = {
    ...semanticPayload,
    actorId: fixture.actorId,
    idempotencyKey,
    requestHash: commandHash(semanticPayload),
  };
  const removed = await executeDraftRevisionCommand(db, workspaceId, input);
  assert.ok("revision" in removed);
  if (!("revision" in removed)) throw new Error("IMAGE_REMOVE_FAILED");
  assert.equal(removed.appendedRevision, false);
  assert.equal(removed.revision.id, fixture.draftRevisionId);
  assert.equal(removed.revision.selectedFinalMediaAssetId, null);
  const replayed = await executeDraftRevisionCommand(db, workspaceId, input);
  assert.equal(replayed.status, "replayed");
  assert.ok("revision" in replayed);
  if (!("revision" in replayed)) throw new Error("IMAGE_REMOVE_REPLAY_FAILED");
  assert.equal(replayed.appendedRevision, false);
  const [after] = await db
    .select({ revisionCount: sql<number>`count(*)::int` })
    .from(draftRevision)
    .where(eq(draftRevision.platformDraftId, fixture.platformDraftId));
  assert.equal(after?.revisionCount, 1);
  const [receipt] = await db
    .select()
    .from(draftRevisionCommandReceipt)
    .where(
      and(
        eq(draftRevisionCommandReceipt.workspaceId, workspaceId),
        eq(draftRevisionCommandReceipt.commandKind, "remove_image"),
        eq(draftRevisionCommandReceipt.idempotencyKey, idempotencyKey),
      ),
    );
  assert.equal(receipt?.appendedRevision, false);
  assert.equal(receipt?.resultingDraftRevisionId, fixture.draftRevisionId);
}

async function proveImageAdmissionReplay(
  db: Executor,
  fixture: Fixture,
  operationId: string,
  expectedFreshConflict: "image_intent_conflict" | "version_conflict",
) {
  const [admitted] = await db
    .select()
    .from(operation)
    .where(eq(operation.id, operationId));
  assert.ok(admitted);
  const input = {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey: admitted.idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: admitted.requestHash,
    requestId: admitted.requestId,
  };
  const replayed = await startImageGeneration(db, fixture.workspaceId, input);
  assert.equal(replayed.status, "replayed");
  assert.ok("operationId" in replayed);
  assert.equal(replayed.operationId, operationId);
  const mismatched = await startImageGeneration(db, fixture.workspaceId, {
    ...input,
    requestHash: `${input.requestHash}:changed`,
  });
  assert.equal(mismatched.status, "idempotency_mismatch");
  const freshStale = await startImageGeneration(db, fixture.workspaceId, {
    ...input,
    idempotencyKey: randomUUID(),
  });
  assert.equal(freshStale.status, expectedFreshConflict);
}

async function proveImageRemainsRemoved(
  db: Executor,
  draftRevisionId: string,
  operationId: string,
) {
  const [revision] = await db
    .select({
      activeRevisionId: platformDraft.activeRevisionId,
      selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
    })
    .from(draftRevision)
    .innerJoin(
      platformDraft,
      eq(platformDraft.id, draftRevision.platformDraftId),
    )
    .where(eq(draftRevision.id, draftRevisionId));
  assert.equal(revision?.selectedFinalMediaAssetId, null);
  assert.equal(revision?.activeRevisionId, draftRevisionId);
  const receipts = await db
    .select({ id: draftRevisionCommandReceipt.id })
    .from(draftRevisionCommandReceipt)
    .where(eq(draftRevisionCommandReceipt.idempotencyKey, operationId));
  assert.equal(receipts.length, 0);
}

async function proveChangedCopySkipsAttachment(db: Executor, fixture: Fixture) {
  const [source] = await db
    .select()
    .from(draftRevision)
    .where(eq(draftRevision.id, fixture.draftRevisionId));
  if (!source) throw new Error("CHANGED_COPY_SOURCE_MISSING");
  const changed = await executeDraftRevisionCommand(db, fixture.workspaceId, {
    actorId: fixture.actorId,
    commandKind: "submit_content",
    content: {
      body: source.body,
      contentLocale: source.contentLocale,
      hashtags: source.hashtags,
      headline: `${source.headline} changed`,
    },
    expectedActive: { id: source.id, version: 1 },
    idempotencyKey: randomUUID(),
    platformDraftId: fixture.platformDraftId,
    requestHash: commandHash({ headline: `${source.headline} changed` }),
  });
  assert.ok("revision" in changed);
}

async function proveFinalTargetsInitiatingRevision(
  db: Executor,
  workspaceId: string,
  fixture: Fixture,
  operationId: string,
) {
  const [generation] = await db
    .select({ finalMediaAssetId: imageGeneration.finalMediaAssetId })
    .from(imageGeneration)
    .where(eq(imageGeneration.operationId, operationId));
  assert.ok(generation?.finalMediaAssetId);
  const revisions = await db
    .select({
      id: draftRevision.id,
      selectedFinalMediaAssetId: draftRevision.selectedFinalMediaAssetId,
    })
    .from(draftRevision)
    .where(eq(draftRevision.platformDraftId, fixture.platformDraftId));
  assert.equal(revisions.length, 2);
  assert.equal(
    revisions.find((revision) => revision.id === fixture.draftRevisionId)
      ?.selectedFinalMediaAssetId,
    generation.finalMediaAssetId,
  );
  assert.equal(
    revisions.find((revision) => revision.id !== fixture.draftRevisionId)
      ?.selectedFinalMediaAssetId,
    null,
  );
  const receipts = await db
    .select({ id: draftRevisionCommandReceipt.id })
    .from(draftRevisionCommandReceipt)
    .where(
      and(
        eq(draftRevisionCommandReceipt.workspaceId, workspaceId),
        eq(draftRevisionCommandReceipt.commandKind, "adopt_image"),
        eq(draftRevisionCommandReceipt.idempotencyKey, operationId),
      ),
    );
  assert.equal(receipts.length, 0);
}

async function proveStaleImageOperations(
  db: Executor,
  workspaceId: string,
  fixture: Fixture,
) {
  const now = new Date();
  const runningKey = randomUUID();
  const running = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 0,
    expectedRevisionVersion: 1,
    idempotencyKey: runningKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey: runningKey }),
    requestId: null,
  });
  if (!("operationId" in running)) throw new Error("STALE_FIXTURE_NOT_CREATED");
  assert.equal(
    (await listStaleImageOperations(db, workspaceId, { limit: 50, now })).some(
      (candidate) => candidate.operationId === running.operationId,
    ),
    false,
  );
  const expiredClaim = await claimOperationExecution(db, workspaceId, {
    claimedBy: `stale:${randomUUID()}`,
    id: running.operationId,
    leaseExpiresAt: new Date(now.getTime() - 60_000),
    now,
  });
  if (expiredClaim.status !== "claimed") {
    throw new Error("STALE_FIXTURE_CLAIM_REJECTED");
  }
  const runningCandidate = (
    await listStaleImageOperations(db, workspaceId, { limit: 50, now })
  ).find((candidate) => candidate.operationId === running.operationId);
  if (!runningCandidate) throw new Error("STALE_RUNNING_NOT_OBSERVED");
  const settledRunning = await settleStaleImageOperation(db, workspaceId, {
    expectedVersion: runningCandidate.operationVersion,
    mediaBrandId: runningCandidate.mediaBrandId,
    now,
    operationId: running.operationId,
  });
  assert.equal(settledRunning?.operation.lifecycle, "failed");
  assert.equal(settledRunning?.operation.claimedBy, null);

  const queuedKey = randomUUID();
  const queued = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 1,
    expectedRevisionVersion: 1,
    idempotencyKey: queuedKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey: queuedKey }),
    requestId: null,
  });
  if (!("operationId" in queued)) throw new Error("STALE_QUEUED_NOT_CREATED");
  const staleAt = new Date(now.getTime() + IMAGE_QUEUED_STALE_MS + 60_000);
  assert.equal(
    (
      await listStaleImageOperations(db, workspaceId, {
        limit: 50,
        now: staleAt,
      })
    ).some((candidate) => candidate.operationId === queued.operationId),
    false,
  );
  await db
    .update(outboxEvent)
    .set({ exhaustedAt: now })
    .where(eq(outboxEvent.operationId, queued.operationId));
  const queuedCandidate = (
    await listStaleImageOperations(db, workspaceId, { limit: 50, now: staleAt })
  ).find((candidate) => candidate.operationId === queued.operationId);
  if (!queuedCandidate) throw new Error("STALE_QUEUED_NOT_OBSERVED");
  const settledQueued = await settleStaleImageOperation(db, workspaceId, {
    expectedVersion: queuedCandidate.operationVersion,
    mediaBrandId: queuedCandidate.mediaBrandId,
    now: staleAt,
    operationId: queued.operationId,
  });
  assert.equal(settledQueued?.operation.lifecycle, "failed");
  assert.equal(
    await settleStaleImageOperation(db, workspaceId, {
      expectedVersion: queuedCandidate.operationVersion,
      mediaBrandId: queuedCandidate.mediaBrandId,
      now: staleAt,
      operationId: queued.operationId,
    }),
    null,
  );

  const freshnessKey = randomUUID();
  const freshness = await startImageGeneration(db, workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: 2,
    expectedRevisionVersion: 1,
    idempotencyKey: freshnessKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey: freshnessKey }),
    requestId: null,
  });
  if (!("operationId" in freshness)) {
    throw new Error("STALE_FRESHNESS_NOT_CREATED");
  }
  const freshnessClaim = await claimOperationExecution(db, workspaceId, {
    claimedBy: `stale-freshness:${randomUUID()}`,
    id: freshness.operationId,
    leaseExpiresAt: new Date(now.getTime() - 60_000),
    now,
  });
  if (freshnessClaim.status !== "claimed") {
    throw new Error("STALE_FRESHNESS_CLAIM_REJECTED");
  }
  const reconciled = await reconcileStaleImageOperations(db, workspaceId, now);
  const change = reconciled.settledDraftChanges.find(
    (item) => item.operationId === freshness.operationId,
  );
  assert.equal(change?.code, "failed");
  assert.equal(change?.platformDraftId, fixture.platformDraftId);
  assert.ok(change?.analysisRunId);
}

class DeterministicImageAdapter implements RemoteModelAdapter {
  imageCalls = 0;
  private readonly instanceId = randomUUID();
  readonly referenceMimeTypes: Array<string | null> = [];
  readonly references: Array<string | null> = [];
  structuredCalls = 0;

  readonly structuredPrompts: string[] = [];

  constructor(
    private readonly fallback: ImageProfile["fallbackBrief"],
    private readonly behavior:
      | "accepted"
      | "invalid-selection"
      | "invalid-then-accepted",
    private readonly briefOverride?: CreativeImageBrief,
  ) {}

  async embedMany(): Promise<never> {
    throw new Error("IMAGE_PROBE_EMBEDDING_FORBIDDEN");
  }

  async generateImage(input: ImageAdapterInput) {
    this.imageCalls += 1;
    this.references.push(
      input.reference
        ? createHash("sha256").update(input.reference.bytes).digest("hex")
        : null,
    );
    this.referenceMimeTypes.push(input.reference?.mimeType ?? null);
    return {
      bytes: LOCAL_PNG,
      mimeType: "image/png",
      observation: {
        costAuthority: "billed_openrouter" as const,
        generationId: `deterministic-image-${this.instanceId}-${this.imageCalls}`,
        openrouterCost: "0",
        resolvedModel: input.model,
        totalTokens: 0,
      },
    };
  }

  async generateStructured<TOutput>(input: StructuredAdapterInput<TOutput>) {
    this.structuredCalls += 1;
    this.structuredPrompts.push(input.prompt);
    let output: unknown;
    if (input.outputName === "image_template_selection") {
      output =
        this.behavior === "invalid-selection" ||
        (this.behavior === "invalid-then-accepted" &&
          this.structuredCalls === 1)
          ? { axes: {}, family: "not-a-family" }
          : this.fallback.selection;
    } else if (input.outputName === "image_creative_brief") {
      output = this.briefOverride ?? this.fallback.brief;
    } else {
      throw new Error("IMAGE_PROBE_OUTPUT_NAME_FORBIDDEN");
    }
    return {
      observation: {
        costAuthority: "unknown" as const,
        generationId: `deterministic-structured-${this.instanceId}-${this.structuredCalls}`,
        resolvedModel: input.model,
        totalTokens: 0,
      },
      output: output as TOutput,
    };
  }
}

type RssFixtureBinding = {
  copyOperationId: string;
  editorialSelectionId: string;
  enrichmentOperationIds: string[];
  promoIdeaId: string;
  sourceId: string;
  sourceItemId: string;
  sourceItemRevisionId: string;
};

async function proveImageSourceReadiness(
  db: Executor,
  workspaceId: string,
  template: CustomerTemplate,
  fingerprint: string,
  identity: WorkerRuntime["identity"],
) {
  const fixture = await createFixture(db, workspaceId, template, fingerprint);
  let binding: RssFixtureBinding | null = null;
  try {
    binding = await convertFixtureToRss(db, fixture);
    const runtime: WorkerRuntime = {
      db,
      identity,
      template: fixture.template,
    };
    const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted");
    const gateway = createWorkerModelGateway({
      adapters: { local: adapter, remote: adapter },
      bindings: {},
      executor: db,
      identity,
      template: fixture.template,
    });

    const limitedKey = randomUUID();
    const limited = await startImageGeneration(db, workspaceId, {
      actor: fixture.actorId,
      draftRevisionId: fixture.draftRevisionId,
      expectedImageIntentVersion: await readFixtureImageIntentVersion(
        db,
        fixture,
      ),
      expectedRevisionVersion: 1,
      idempotencyKey: limitedKey,
      modelOptionKey: fixture.modelOptionKey,
      requestHash: commandHash({ limitedKey, proof: "feed-only-fallback" }),
      requestId: null,
    });
    assert.equal(limited.status, "created");
    if (!("operationId" in limited)) {
      throw new Error("RSS_LIMITED_IMAGE_OPERATION_NOT_CREATED");
    }
    assert.deepEqual(await imageCommandFootprint(db, workspaceId, limitedKey), {
      operations: 1,
      outboxEvents: 1,
      usageEvents: 0,
    });
    assert.equal(adapter.structuredCalls, 0);
    assert.equal(adapter.imageCalls, 0);
    await proveFeedImageSelection(
      db,
      runtime,
      gateway,
      fixture,
      limited.operationId,
      adapter,
      binding.sourceItemRevisionId,
    );

    await makeRssBindingIncomplete(db, binding.copyOperationId, false);
    const incompleteKey = randomUUID();
    const incomplete = await startImageGeneration(db, workspaceId, {
      actor: fixture.actorId,
      draftRevisionId: fixture.draftRevisionId,
      expectedImageIntentVersion: await readFixtureImageIntentVersion(
        db,
        fixture,
      ),
      expectedRevisionVersion: 1,
      idempotencyKey: incompleteKey,
      modelOptionKey: fixture.modelOptionKey,
      requestHash: commandHash({ incompleteKey, proof: "missing-extract" }),
      requestId: null,
    });
    assert.equal(incomplete.status, "not_found");
    assert.deepEqual(
      await imageCommandFootprint(db, workspaceId, incompleteKey),
      { operations: 0, outboxEvents: 0, usageEvents: 0 },
    );

    const direct = await bindRssExtract(db, fixture, binding, "direct");
    const directOperation = await startFixtureImageGeneration(
      db,
      fixture,
      "direct-extract",
    );
    await proveQualifiedImageSelection(
      db,
      runtime,
      gateway,
      fixture,
      directOperation,
      "direct",
      direct.enrichmentId,
    );

    const historicalOperation = await startFixtureImageGeneration(
      db,
      fixture,
      "historical-feed-only",
    );
    await makeRssBindingIncomplete(db, binding.copyOperationId, true);
    await proveFeedImageSelection(
      db,
      runtime,
      gateway,
      fixture,
      historicalOperation,
      adapter,
      binding.sourceItemRevisionId,
    );

    const firecrawl = await bindRssExtract(db, fixture, binding, "firecrawl");
    const firecrawlOperation = await startFixtureImageGeneration(
      db,
      fixture,
      "firecrawl-extract",
    );
    await proveQualifiedImageSelection(
      db,
      runtime,
      gateway,
      fixture,
      firecrawlOperation,
      "firecrawl",
      firecrawl.enrichmentId,
    );

    console.log(
      JSON.stringify({
        fallbackProvenance: "rss_feed:pinned_source_item_revision",
        incompleteBinding: "not_found:zero_operation_outbox_usage",
        preflight: "zero_operation_outbox_usage",
        qualifyingProvenance: ["rss_feed", "direct", "firecrawl"],
        proof: "image-source-readiness",
      }),
    );
  } finally {
    if (binding) await restorePromoFixture(db, fixture, binding);
    await cleanupFixture(
      db,
      fixture.workspaceId,
      fixture.platformDraftId,
      fixture.mediaBrandId,
      fixture.reference.id,
    );
    if (binding) await cleanupRssFixture(db, binding);
  }
}

async function convertFixtureToRss(
  db: Executor,
  fixture: Fixture,
): Promise<RssFixtureBinding> {
  const [draft] = await db
    .select({ promoIdeaId: platformDraft.promoIdeaId })
    .from(platformDraft)
    .where(eq(platformDraft.id, fixture.platformDraftId));
  if (!draft?.promoIdeaId) throw new Error("RSS_FIXTURE_PROMO_REQUIRED");
  const [promo] = await db
    .select({ analysisModelUnitId: promoIdea.analysisModelUnitId })
    .from(promoIdea)
    .where(eq(promoIdea.id, draft.promoIdeaId));
  const [modelUnit] = promo
    ? await db
        .select({ analysisRunId: analysisModelUnit.analysisRunId })
        .from(analysisModelUnit)
        .where(eq(analysisModelUnit.id, promo.analysisModelUnitId))
    : [];
  const [revision] = await db
    .select({ copyGenerationUnitId: copyVariant.copyGenerationUnitId })
    .from(draftRevision)
    .innerJoin(
      copyVariant,
      eq(copyVariant.id, draftRevision.originatingCopyVariantId),
    )
    .where(eq(draftRevision.id, fixture.draftRevisionId));
  if (!promo || !modelUnit || !revision) {
    throw new Error("RSS_FIXTURE_GRAPH_REQUIRED");
  }
  const [unit] = await db
    .select({ copyOperationId: copyGenerationUnit.copyGenerationId })
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.id, revision.copyGenerationUnitId));
  if (!unit) throw new Error("RSS_FIXTURE_COPY_REQUIRED");

  const sourceId = randomUUID();
  const sourceItemId = randomUUID();
  const sourceItemRevisionId = randomUUID();
  const editorialSelectionId = randomUUID();
  const endpoint = `https://example.com/${sourceId}/feed`;
  const articleUrl = `https://example.com/${sourceItemId}`;
  await db.transaction(async (tx) => {
    await tx.insert(source).values({
      articleFetchMode: "direct_then_firecrawl",
      contentLocale: "en",
      enabled: true,
      endpoint,
      id: sourceId,
      key: `${FIXTURE_PREFIX}-rss-${sourceId}`,
      name: "Image generation RSS probe",
      origin: "rss",
      workspaceId: fixture.workspaceId,
    });
    await tx.insert(sourceItem).values({
      attribution: "Image generation RSS probe",
      contentLocale: "en",
      externalId: sourceItemId,
      id: sourceItemId,
      origin: "rss",
      publishedAt: new Date(),
      sourceId,
      title: "Image generation RSS probe article",
      url: articleUrl,
      workspaceId: fixture.workspaceId,
    });
    await tx.insert(sourceItemRevision).values({
      canonicalUrl: articleUrl,
      contentHash: hash("feed-only probe text"),
      contentLocale: "en",
      id: sourceItemRevisionId,
      revisionNumber: 1,
      sourceItemId,
      summary: "feed-only probe text",
      title: "Image generation RSS probe article",
      workspaceId: fixture.workspaceId,
    });
    await tx.insert(analysisRunItem).values({
      analysisRunId: modelUnit.analysisRunId,
      eligibility: "candidate",
      sourceItemId,
      sourceItemRevisionId,
      workspaceId: fixture.workspaceId,
    });
    await tx.insert(editorialSelection).values({
      analysisModelUnitId: promo.analysisModelUnitId,
      id: editorialSelectionId,
      rank: 1,
      sourceItemId,
      suggestedPlatform: "telegram",
      workspaceId: fixture.workspaceId,
    });
    await tx
      .update(platformDraft)
      .set({ editorialSelectionId, promoIdeaId: null })
      .where(eq(platformDraft.id, fixture.platformDraftId));
    await tx
      .update(copyGeneration)
      .set({
        limited: true,
        limitedReason: "fetch_failed",
        pageContentHash: null,
        sourceItemEnrichmentId: null,
        sourceItemRevisionId,
      })
      .where(eq(copyGeneration.operationId, unit.copyOperationId));
  });
  return {
    copyOperationId: unit.copyOperationId,
    editorialSelectionId,
    enrichmentOperationIds: [],
    promoIdeaId: draft.promoIdeaId,
    sourceId,
    sourceItemId,
    sourceItemRevisionId,
  };
}

async function bindRssExtract(
  db: Executor,
  fixture: Fixture,
  binding: RssFixtureBinding,
  adapter: "direct" | "firecrawl",
) {
  const operationId = randomUUID();
  const attemptId = randomUUID();
  const enrichmentId = randomUUID();
  const extract = `${adapter} full article extract ${"content ".repeat(300)}`;
  const pageContentHash = hash(extract);
  await db.transaction(async (tx) => {
    await tx.insert(operation).values({
      actor: fixture.actorId,
      commandType: `${FIXTURE_PREFIX}:rss-${adapter}`,
      id: operationId,
      idempotencyKey: operationId,
      lifecycle: "succeeded",
      requestHash: hash(operationId),
      workspaceId: fixture.workspaceId,
    });
    await tx.insert(operationAttempt).values({
      attemptNumber: 1,
      id: attemptId,
      operationId,
      outcome: "succeeded",
      workspaceId: fixture.workspaceId,
    });
    await tx.insert(sourceItemEnrichment).values({
      adapter,
      brief: null,
      extract,
      fallbackReason: adapter === "firecrawl" ? "fetch_failed" : null,
      id: enrichmentId,
      operationAttemptId: attemptId,
      pageContentHash,
      policyVersion: `${FIXTURE_PREFIX}:${adapter}:${enrichmentId}`,
      providerRequestId: null,
      sourceItemRevisionId: binding.sourceItemRevisionId,
      workspaceId: fixture.workspaceId,
    });
    await tx
      .update(copyGeneration)
      .set({
        limited: false,
        limitedReason: null,
        pageContentHash,
        sourceItemEnrichmentId: enrichmentId,
      })
      .where(eq(copyGeneration.operationId, binding.copyOperationId));
  });
  binding.enrichmentOperationIds.push(operationId);
  return { enrichmentId, operationId };
}

async function makeRssBindingIncomplete(
  db: Executor,
  copyOperationId: string,
  limited: boolean,
) {
  await db
    .update(copyGeneration)
    .set({
      limited,
      limitedReason: limited ? "fetch_failed" : null,
      pageContentHash: null,
      sourceItemEnrichmentId: null,
    })
    .where(eq(copyGeneration.operationId, copyOperationId));
}

async function startFixtureImageGeneration(
  db: Executor,
  fixture: Fixture,
  proof: string,
) {
  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, fixture.workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: await readFixtureImageIntentVersion(
      db,
      fixture,
    ),
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey, proof }),
    requestId: null,
  });
  assert.equal(created.status, "created");
  if (!("operationId" in created)) {
    throw new Error("RSS_IMAGE_OPERATION_NOT_CREATED");
  }
  return created.operationId;
}

async function readFixtureImageIntentVersion(
  db: Executor,
  fixture: Fixture,
): Promise<number> {
  const [revision] = await db
    .select({ imageIntentVersion: draftRevision.imageIntentVersion })
    .from(draftRevision)
    .where(
      and(
        eq(draftRevision.workspaceId, fixture.workspaceId),
        eq(draftRevision.id, fixture.draftRevisionId),
      ),
    );
  if (!revision) throw new Error("IMAGE_FIXTURE_REVISION_NOT_FOUND");
  return revision.imageIntentVersion;
}

async function proveQualifiedImageSelection(
  db: Executor,
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  fixture: Fixture,
  operationId: string,
  adapter: "direct" | "firecrawl",
  enrichmentId: string,
) {
  const authorized = await loadAuthorizedImageSource(
    db,
    fixture.workspaceId,
    operationId,
  );
  assert.equal(authorized?.source.kind, "rss");
  assert.equal(
    authorized?.source.kind === "rss" ? authorized.source.limited : null,
    false,
  );
  const [enrichment] = await db
    .select({ adapter: sourceItemEnrichment.adapter })
    .from(sourceItemEnrichment)
    .where(eq(sourceItemEnrichment.id, enrichmentId));
  assert.equal(enrichment?.adapter, adapter);
  const token = `image-source-${adapter}:${randomUUID()}`;
  const claim = await claimOperationExecution(db, fixture.workspaceId, {
    claimedBy: token,
    id: operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  assert.equal(claim.status, "claimed");
  assert.equal(
    (
      await executeImageSelection(runtime, gateway, {
        operationId,
        token,
        workspaceId: fixture.workspaceId,
      })
    ).status,
    "succeeded",
  );
  await settleFixtureImageOperation(db, fixture, operationId, "cancelled");
}

async function proveFeedImageSelection(
  db: Executor,
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  fixture: Fixture,
  operationId: string,
  adapter: DeterministicImageAdapter,
  sourceRevisionId: string,
) {
  const authorized = await loadAuthorizedImageSource(
    db,
    fixture.workspaceId,
    operationId,
  );
  assert.equal(authorized?.source.kind, "rss");
  if (authorized?.source.kind !== "rss") {
    throw new Error("RSS_FEED_SOURCE_REQUIRED");
  }
  assert.equal(authorized.source.limited, true);
  const token = `image-source-feed:${randomUUID()}`;
  const claim = await claimOperationExecution(db, fixture.workspaceId, {
    claimedBy: token,
    id: operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  assert.equal(claim.status, "claimed");
  const callsBefore = adapter.structuredCalls;
  assert.equal(
    (
      await executeImageSelection(runtime, gateway, {
        operationId,
        token,
        workspaceId: fixture.workspaceId,
      })
    ).status,
    "succeeded",
  );
  assert.equal(adapter.structuredCalls, callsBefore + 1);
  const [projection] = await db
    .select({
      contentHash: imageBrief.rssContentHash,
      kind: imageBrief.sourceProjectionKind,
      sourceRevisionId: imageBrief.rssSourceItemRevisionId,
    })
    .from(imageGeneration)
    .innerJoin(
      imageBrief,
      and(
        eq(imageBrief.id, imageGeneration.imageBriefId),
        eq(imageBrief.workspaceId, imageGeneration.workspaceId),
      ),
    )
    .where(eq(imageGeneration.operationId, operationId));
  assert.deepEqual(projection, {
    contentHash: authorized.source.contentHash,
    kind: "rss_feed",
    sourceRevisionId,
  });
  await settleFixtureImageOperation(db, fixture, operationId, "cancelled");
}

async function settleFixtureImageOperation(
  db: Executor,
  fixture: Fixture,
  operationId: string,
  lifecycle: "cancelled" | "failed",
) {
  const context = await findImageExecutionContext(
    db,
    fixture.workspaceId,
    operationId,
  );
  if (!context?.claimedBy) throw new Error("RSS_IMAGE_CLAIM_REQUIRED");
  assert.ok(
    await settleImageOperationAndWakeNext(db, fixture.workspaceId, {
      claimedBy: context.claimedBy,
      expectedVersion: context.operationVersion,
      lifecycle,
      mediaBrandId: fixture.mediaBrandId,
      operationId,
    }),
  );
}

async function imageCommandFootprint(
  db: Executor,
  workspaceId: string,
  idempotencyKey: string,
) {
  const rows = await db
    .select({
      operationId: operation.id,
      outboxEventId: outboxEvent.id,
      usageEventId: aiUsageEvent.id,
    })
    .from(operation)
    .leftJoin(
      outboxEvent,
      and(
        eq(outboxEvent.operationId, operation.id),
        eq(outboxEvent.workspaceId, operation.workspaceId),
      ),
    )
    .leftJoin(
      aiUsageEvent,
      and(
        eq(aiUsageEvent.operationId, operation.id),
        eq(aiUsageEvent.workspaceId, operation.workspaceId),
      ),
    )
    .where(
      and(
        eq(operation.workspaceId, workspaceId),
        eq(operation.commandType, `${IMAGE_GENERATION_COMMAND_PREFIX}start`),
        eq(operation.idempotencyKey, idempotencyKey),
      ),
    );
  return {
    operations: new Set(rows.map((row) => row.operationId)).size,
    outboxEvents: new Set(
      rows.flatMap((row) => (row.outboxEventId ? [row.outboxEventId] : [])),
    ).size,
    usageEvents: new Set(
      rows.flatMap((row) => (row.usageEventId ? [row.usageEventId] : [])),
    ).size,
  };
}

async function restorePromoFixture(
  db: Executor,
  fixture: Fixture,
  binding: RssFixtureBinding,
) {
  await db.transaction(async (tx) => {
    await tx
      .update(platformDraft)
      .set({ editorialSelectionId: null, promoIdeaId: binding.promoIdeaId })
      .where(eq(platformDraft.id, fixture.platformDraftId));
    await tx
      .update(copyGeneration)
      .set({
        limited: false,
        limitedReason: null,
        pageContentHash: null,
        sourceItemEnrichmentId: null,
        sourceItemRevisionId: null,
      })
      .where(eq(copyGeneration.operationId, binding.copyOperationId));
    await tx
      .delete(editorialSelection)
      .where(eq(editorialSelection.id, binding.editorialSelectionId));
  });
}

async function cleanupRssFixture(db: Executor, binding: RssFixtureBinding) {
  await db.transaction(async (tx) => {
    await tx
      .delete(sourceItemEnrichment)
      .where(
        eq(
          sourceItemEnrichment.sourceItemRevisionId,
          binding.sourceItemRevisionId,
        ),
      );
    if (binding.enrichmentOperationIds.length > 0) {
      await tx
        .delete(operationAttempt)
        .where(
          inArray(operationAttempt.operationId, binding.enrichmentOperationIds),
        );
      await tx
        .delete(operation)
        .where(inArray(operation.id, binding.enrichmentOperationIds));
    }
    await tx.delete(sourceItem).where(eq(sourceItem.id, binding.sourceItemId));
    await tx.delete(source).where(eq(source.id, binding.sourceId));
  });
}

async function proveImageParentScheduling(
  db: Executor,
  workspaceId: string,
  template: CustomerTemplate,
  fingerprint: string,
  identity: WorkerRuntime["identity"],
) {
  const primary = await createFixture(db, workspaceId, template, fingerprint);
  const secondary = await createFixture(db, workspaceId, template, fingerprint);
  try {
    const runtime: WorkerRuntime = {
      db,
      identity,
      template: primary.template,
    };
    const client = new Inngest({
      appVersion: `image-parent-scheduling-${randomUUID()}`,
      id: `rz-image-parent-scheduling-${randomUUID()}`,
    });
    const [parent] = createImageGenerationFunctions(client, runtime, () => {
      throw new Error("IMAGE_PROVIDER_EFFECT_FORBIDDEN");
    });
    if (!parent) throw new Error("IMAGE_PARENT_SCHEDULING_FUNCTION_MISSING");
    const handler = (
      parent as unknown as {
        fn: (input: never) => Promise<unknown>;
      }
    ).fn;

    const failedOperationId = await startFixtureImageGeneration(
      db,
      primary,
      "parent-immediate-stage-failure",
    );
    const failureSleeps: string[] = [];
    const failureInvokes: string[] = [];
    const failed = await handler({
      event: {
        data: {
          imageGenerationId: failedOperationId,
          operationId: failedOperationId,
          schemaVersion: 1,
          workspaceId,
        },
      },
      runId: randomUUID(),
      step: {
        invoke: async (id: string) => {
          failureInvokes.push(id);
          return { operationId: failedOperationId, status: "failed" };
        },
        realtime: { publish: async () => undefined },
        run: async (id: string, execute: () => Promise<unknown>) =>
          id.startsWith("notify-") ? "unavailable" : execute(),
        sleep: async (id: string) => {
          failureSleeps.push(id);
        },
      },
    } as never);
    assert.deepEqual(failed, {
      operationId: failedOperationId,
      status: "failed",
    });
    assert.deepEqual(failureInvokes, ["image-stage-selection"]);
    assert.deepEqual(failureSleeps, []);
    const failedContext = await findImageExecutionContext(
      db,
      workspaceId,
      failedOperationId,
    );
    assert.equal(failedContext?.operationLifecycle, "failed");
    assert.equal(failedContext?.claimedBy, null);

    const firstOperationId = await startFixtureImageGeneration(
      db,
      primary,
      "parent-brand-first",
    );
    await db
      .update(operation)
      .set({ createdAt: new Date(Date.now() - 60_000) })
      .where(eq(operation.id, firstOperationId));
    await db
      .update(platformDraft)
      .set({ mediaBrandId: primary.mediaBrandId })
      .where(eq(platformDraft.id, secondary.platformDraftId));
    const waitingOperationId = await startFixtureImageGeneration(
      db,
      secondary,
      "parent-brand-waiting",
    );
    await db
      .update(outboxEvent)
      .set({ dispatchedAt: new Date() })
      .where(eq(outboxEvent.operationId, waitingOperationId));
    const firstToken = `image-parent-first:${randomUUID()}`;
    const firstClaim = await claimOperationExecution(db, workspaceId, {
      claimedBy: firstToken,
      id: firstOperationId,
      leaseExpiresAt: new Date(Date.now() + 120_000),
      now: new Date(),
    });
    if (firstClaim.status !== "claimed") {
      throw new Error("IMAGE_PARENT_FIRST_CLAIM_REJECTED");
    }
    const queueSleeps: string[] = [];
    const waiting = await handler({
      event: {
        data: {
          imageGenerationId: waitingOperationId,
          operationId: waitingOperationId,
          schemaVersion: 1,
          workspaceId,
        },
      },
      runId: randomUUID(),
      step: {
        run: async (id: string, execute: () => Promise<unknown>) => {
          const result = await execute();
          if (id === "image-brand-admission") {
            assert.equal(result, firstOperationId);
            assert.ok(
              await settleImageOperationAndWakeNext(db, workspaceId, {
                claimedBy: firstToken,
                expectedVersion: firstClaim.operation.version,
                lifecycle: "cancelled",
                mediaBrandId: primary.mediaBrandId,
                operationId: firstOperationId,
              }),
            );
          }
          return result;
        },
        sleep: async (id: string) => {
          queueSleeps.push(id);
        },
      },
    } as never);
    assert.deepEqual(waiting, {
      operationId: waitingOperationId,
      status: "waiting_for_brand",
    });
    assert.deepEqual(queueSleeps, []);
    const pendingWake = await db
      .select({ id: outboxEvent.id })
      .from(outboxEvent)
      .where(
        and(
          eq(outboxEvent.workspaceId, workspaceId),
          eq(outboxEvent.operationId, waitingOperationId),
          eq(
            outboxEvent.eventType,
            OPERATION_IMAGE_GENERATION_REQUESTED_EVENT_NAME,
          ),
          isNull(outboxEvent.dispatchedAt),
          isNull(outboxEvent.exhaustedAt),
        ),
      );
    assert.equal(pendingWake.length, 1);
    assert.equal(
      (await findImageExecutionContext(db, workspaceId, waitingOperationId))
        ?.operationLifecycle,
      "queued",
    );

    console.log(
      JSON.stringify({
        brandWaitSleeps: queueSleeps.length,
        immediateFailureSleeps: failureSleeps.length,
        pendingWakeEvents: pendingWake.length,
        proof: "image-parent-scheduling",
      }),
    );
  } finally {
    await cleanupFixture(
      db,
      secondary.workspaceId,
      secondary.platformDraftId,
      secondary.mediaBrandId,
      secondary.reference.id,
    );
    await cleanupFixture(
      db,
      primary.workspaceId,
      primary.platformDraftId,
      primary.mediaBrandId,
      primary.reference.id,
    );
  }
}

type Fixture = {
  actorId: string;
  draftRevisionId: string;
  fallback: ImageProfile["fallbackBrief"];
  mediaBrandId: string;
  modelOptionKey: string;
  platformDraftId: string;
  profile: ImageProfile;
  promoIdeaId: string;
  reference: { checksum: string; id: string; objectKey: string };
  template: CustomerTemplate;
  workspaceId: string;
};

async function createFixture(
  db: Executor,
  workspaceId: string,
  template: CustomerTemplate,
  fingerprint: string,
  sourceBrandKey?: string,
  contentLocale: "en" | "fa" = "en",
  modelOptionKey?: string,
): Promise<Fixture> {
  const [actor] = await db
    .select({ id: user.id })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);
  const templateBrand = template.mediaBrands.find(
    (brand) =>
      brand.imageProfile &&
      (sourceBrandKey === undefined || brand.key === sourceBrandKey),
  );
  const imageModel = template.editorial.drafting.image.models.find(
    (model) =>
      model.enabled &&
      (modelOptionKey === undefined || model.key === modelOptionKey) &&
      template.models?.tasks[`image-generation:${model.key}`] !== undefined,
  );
  if (!actor || !templateBrand?.imageProfile || !imageModel) {
    throw new Error("IMAGE_FIXTURE_TEMPLATE_REQUIRED");
  }
  const brandId = randomUUID();
  const brandKey = `${FIXTURE_PREFIX}-${brandId}`;
  const analysisOperationId = randomUUID();
  const analysisRunId = randomUUID();
  const modelUnitId = randomUUID();
  const promoIdeaId = randomUUID();
  const draftId = randomUUID();
  const copyOperationId = randomUUID();
  const copyAttemptId = randomUUID();
  const copyUnitId = randomUUID();
  const variantId = randomUUID();
  const revisionId = randomUUID();
  const referenceId = randomUUID();
  const referenceObjectKey = `workspaces/${workspaceId}/probe-references/${referenceId}.png`;
  const referenceBytes = readFileSync(
    resolve(
      resolveArtifactRoot(import.meta.url),
      "customer-templates",
      "crypto",
      "brand-logos",
      "coin-hall.png",
    ),
  );
  const referenceMetadata = await sharp(referenceBytes).metadata();
  if (!referenceMetadata.width || !referenceMetadata.height) {
    throw new Error("IMAGE_FIXTURE_REFERENCE_DIMENSIONS_REQUIRED");
  }
  const referenceChecksum = hash(referenceBytes);
  const fixtureTemplate: CustomerTemplate = {
    ...template,
    mediaBrands: [
      ...template.mediaBrands,
      { ...templateBrand, key: brandKey, name: "Image generation probe brand" },
    ],
  };
  const profile = imageProfileSchema.parse(
    JSON.parse(
      readFileSync(
        resolve(
          resolveArtifactRoot(import.meta.url),
          "customer-templates",
          template.customer.key,
          templateBrand.imageProfile,
        ),
        "utf8",
      ),
    ),
  );
  await workerStorage().put(referenceObjectKey, referenceBytes, "image/png");
  try {
    await db.transaction(async (tx) => {
      await tx.insert(mediaBrand).values({
        id: brandId,
        key: brandKey,
        name: "Image generation probe brand",
        sortOrder: 900_000,
        workspaceId,
      });
      await tx.insert(operation).values([
        {
          actor: actor.id,
          commandType: `${FIXTURE_PREFIX}:analysis`,
          id: analysisOperationId,
          idempotencyKey: analysisOperationId,
          lifecycle: "succeeded",
          requestHash: hash(analysisOperationId),
          workspaceId,
        },
        {
          actor: actor.id,
          commandType: `${FIXTURE_PREFIX}:copy`,
          id: copyOperationId,
          idempotencyKey: copyOperationId,
          lifecycle: "succeeded",
          requestHash: hash(copyOperationId),
          workspaceId,
        },
      ]);
      await tx.insert(analysisRun).values({
        configuration: {
          kind: "promo",
          models: ["probe"],
          platforms: template.editorial.drafting.copy.platforms.map(
            ({ platform }) => platform,
          ),
          promo: {
            brands: [brandKey],
            prompts: { [brandKey]: "deterministic local fixture" },
          },
        },
        id: analysisRunId,
        kind: "promo",
        operationId: analysisOperationId,
        semanticStatus: "skipped",
        templateFingerprint: fingerprint,
        workspaceId,
      });
      await tx.insert(analysisModelUnit).values({
        analysisRunId,
        id: modelUnitId,
        mediaBrandId: brandId,
        modelOptionKey: "probe",
        status: "pending",
        taskKey: "promo",
        workspaceId,
      });
      await tx.insert(promoIdea).values({
        analysisModelUnitId: modelUnitId,
        angle: "Disposable angle",
        description: "Disposable description",
        id: promoIdeaId,
        rank: 1,
        title: "Disposable title",
        workspaceId,
      });
      await tx.insert(platformDraft).values({
        id: draftId,
        lanePosition: 1,
        mediaBrandId: brandId,
        platform: "telegram",
        promoIdeaId,
        workspaceId,
      });
      await tx.insert(copyGeneration).values({
        brandPolicyFingerprint: FIXTURE_PREFIX,
        configurationVersion: FIXTURE_PREFIX,
        customerTemplateFingerprint: fingerprint,
        modelOptionKey: "probe",
        operationId: copyOperationId,
        platformDraftId: draftId,
        promptVersion: FIXTURE_PREFIX,
        requestedContentLocale: contentLocale,
        workspaceId,
      });
      await tx.insert(operationAttempt).values({
        attemptNumber: 1,
        id: copyAttemptId,
        operationId: copyOperationId,
        outcome: "succeeded",
        workspaceId,
      });
      await tx.insert(copyGenerationUnit).values({
        copyGenerationId: copyOperationId,
        id: copyUnitId,
        operationAttemptId: copyAttemptId,
        status: "succeeded",
        variantKey: "fixture",
        workspaceId,
      });
      await tx.insert(copyVariant).values({
        body: "Disposable body",
        contentLocale,
        copyGenerationUnitId: copyUnitId,
        hashtags: ["#fixture"],
        headline: "Disposable headline",
        id: variantId,
        workspaceId,
      });
      await tx.insert(draftRevision).values({
        authoredBy: actor.id,
        body: "Disposable body",
        contentLocale,
        hashtags: ["#fixture"],
        headline: "Disposable headline",
        id: revisionId,
        originatingCopyVariantId: variantId,
        platformDraftId: draftId,
        revisionNumber: 1,
        workspaceId,
      });
      await tx
        .update(platformDraft)
        .set({ activeRevisionId: revisionId, revisionVersion: 1 })
        .where(eq(platformDraft.id, draftId));
      await tx.insert(mediaAsset).values({
        actualBytes: referenceBytes.byteLength,
        checksum: referenceChecksum,
        declaredBytes: referenceBytes.byteLength,
        height: referenceMetadata.height,
        id: referenceId,
        kind: `${FIXTURE_PREFIX}:reference`,
        lifecycle: "verified",
        mimeType: "image/png",
        objectKey: referenceObjectKey,
        verifiedAt: new Date(),
        width: referenceMetadata.width,
        workspaceId,
      });
    });
  } catch (error) {
    await workerStorage().delete([referenceObjectKey]);
    throw error;
  }
  return {
    actorId: actor.id,
    draftRevisionId: revisionId,
    fallback: profile.fallbackBrief,
    mediaBrandId: brandId,
    modelOptionKey: imageModel.key,
    platformDraftId: draftId,
    profile,
    promoIdeaId,
    reference: {
      checksum: referenceChecksum,
      id: referenceId,
      objectKey: referenceObjectKey,
    },
    template: fixtureTemplate,
    workspaceId,
  };
}

function proveDirectionBounds() {
  const exactBound = operatorImageDirectionSchema.parse("😀".repeat(1_000));
  assert.ok(exactBound);
  assert.equal([...exactBound].length, 1_000);
  assert.equal(new TextEncoder().encode(exactBound).byteLength, 4_000);
  assert.throws(() => operatorImageDirectionSchema.parse("a".repeat(1_001)));
  assert.throws(() => operatorImageDirectionSchema.parse("😀".repeat(1_001)));
  assert.throws(() => operatorImageDirectionSchema.parse("safe\u0007unsafe"));
  const loneSurrogate = operatorImageDirectionSchema.parse("\ud800");
  assert.equal(loneSurrogate, "\ud800");
  assert.equal(new TextEncoder().encode(loneSurrogate).byteLength, 3);
}

function proveCreativeBriefNormalizationProfiles(template: CustomerTemplate) {
  const customerRoot = resolve(
    resolveArtifactRoot(import.meta.url),
    "customer-templates",
    template.customer.key,
  );
  const proven = template.mediaBrands.flatMap((brand) => {
    if (!brand.imageProfile) return [];
    const profile = imageProfileSchema.parse(
      JSON.parse(
        readFileSync(resolve(customerRoot, brand.imageProfile), "utf8"),
      ),
    );
    const fallback = profile.fallbackBrief;
    assert.deepEqual(
      normalizeCreativeBrief(profile, fallback.selection, fallback.brief),
      { brief: fallback.brief, failures: [] },
    );
    for (const [familyKey, family] of Object.entries(profile.families)) {
      const selection = { axes: family.defaultAxes, family: familyKey };
      const maxWords = profile.textPolicy.headlineMaxWords;
      const uppercase =
        family.headlineUppercase ??
        profile.textPolicy.headlineUppercase ??
        false;
      const normalized = normalizeCreativeBrief(profile, selection, {
        dataElements: Array.from(
          { length: family.dataBudget + 3 },
          (_, index) => ({ label: `label ${index}`, value: "۱۲۳۴۵۶۷۸۹۰۱" }),
        ),
        headline: Array.from(
          { length: maxWords + 5 },
          (_, index) => `کلمه${index}`,
        ).join("  "),
        subjectScene: "A neutral scene with no restricted subject.",
      });
      assert.deepEqual(normalized.failures, []);
      assert.equal(normalized.brief.headline.split(" ").length, maxWords);
      assert.equal(
        normalized.brief.headline,
        uppercase
          ? normalized.brief.headline.toLocaleUpperCase("und")
          : normalized.brief.headline,
      );
      assert.equal(normalized.brief.dataElements.length, family.dataBudget);
      assert.equal(
        normalized.brief.dataElements.every(
          (item) =>
            [...item.value].length ===
            Math.min(11, family.dataValueMaxLength ?? 11),
        ),
        true,
      );
    }
    const banned = profile.restrictions.bannedSubjectTerms?.[0];
    if (banned !== undefined) {
      assert.deepEqual(
        normalizeCreativeBrief(profile, fallback.selection, {
          ...fallback.brief,
          subjectScene: `A hall scene featuring a ${banned.toLocaleUpperCase("und")} on a plinth.`,
        }).failures,
        ["BANNED_TERM"],
      );
      assert.deepEqual(
        normalizeCreativeBrief(profile, fallback.selection, {
          ...fallback.brief,
          headline: [
            ...Array.from(
              { length: profile.textPolicy.headlineMaxWords },
              (_, index) => `کلمه${index}`,
            ),
            banned,
          ].join(" "),
        }).failures,
        [],
      );
    }
    return [brand.key];
  });
  assert.deepEqual([...proven].sort(), [
    "chain-reporter",
    "coin-hall",
    "meta-coin-guard",
    "rz-prime",
  ]);
  return proven.length;
}

function proveSelectionOutputSchema(template: CustomerTemplate) {
  const root = resolveArtifactRoot(import.meta.url);
  const customerRoot = resolve(
    root,
    "customer-templates",
    template.customer.key,
  );
  const proven = template.mediaBrands.flatMap((brand) => {
    if (!brand.imageProfile) return [];
    const profile = imageProfileSchema.parse(
      JSON.parse(
        readFileSync(resolve(customerRoot, brand.imageProfile), "utf8"),
      ),
    );
    const schema = buildSelectionOutputSchema(profile);
    const optional = new Set(profile.restrictions.optionalAxes ?? []);
    assert.equal(Object.keys(profile.families).length > 0, true);
    assert.equal(
      Object.values(profile.axes).every(
        (values) => Object.keys(values).length > 0,
      ),
      true,
    );
    assert.deepEqual(
      JSON.parse(
        JSON.stringify(
          z.toJSONSchema(schema, {
            io: "input",
            reused: "inline",
            target: "draft-7",
          }),
        ),
      ),
      {
        $schema: "http://json-schema.org/draft-07/schema#",
        additionalProperties: false,
        properties: {
          axes: {
            additionalProperties: false,
            properties: Object.fromEntries(
              Object.entries(profile.axes).map(([axisName, values]) => [
                axisName,
                optional.has(axisName)
                  ? {
                      anyOf: [
                        { enum: Object.keys(values), type: "string" },
                        { type: "null" },
                      ],
                    }
                  : { enum: Object.keys(values), type: "string" },
              ]),
            ),
            required: Object.keys(profile.axes),
            type: "object",
          },
          family: { enum: Object.keys(profile.families), type: "string" },
        },
        required: ["axes", "family"],
        type: "object",
      },
    );
    const fallback = profile.fallbackBrief;
    assert.deepEqual(schema.parse(fallback.selection), fallback.selection);
    return [brand.key];
  });
  assert.deepEqual([...proven].sort(), [
    "chain-reporter",
    "coin-hall",
    "meta-coin-guard",
    "rz-prime",
  ]);
  return proven.length;
}

function proveImagePromptProfileBounds(template: CustomerTemplate) {
  const root = resolveArtifactRoot(import.meta.url);
  const customerRoot = resolve(
    root,
    "customer-templates",
    template.customer.key,
  );
  const lengths = Object.fromEntries(
    template.mediaBrands.flatMap((brand) => {
      if (!brand.imageProfile) return [];
      const profile = imageProfileSchema.parse(
        JSON.parse(
          readFileSync(resolve(customerRoot, brand.imageProfile), "utf8"),
        ),
      );
      const fallback = profile.fallbackBrief;
      return [
        [
          brand.key,
          assembleImagePrompt({
            brief: fallback.brief,
            brandBible: brand.brandBible
              ? readFileSync(resolve(customerRoot, brand.brandBible), "utf8")
              : "Follow the declared media-brand policy and official reference only.",
            contentLocale: "en",
            profile,
            selection: fallback.selection,
          }).prompt.length,
        ],
      ];
    }),
  );
  assert.deepEqual(lengths, {
    "chain-reporter": 2_384,
    "coin-hall": 41_097,
    "meta-coin-guard": 26_610,
    "rz-prime": 32_919,
  });
  assert.equal(
    Object.values(lengths).every((length) => length <= 48_000),
    true,
  );
}

async function proveGatewayBounds(
  gateway: ReturnType<typeof createWorkerModelGateway>,
  adapter: DeterministicImageAdapter,
) {
  if (!gateway.invokeImage) throw new Error("IMAGE_GATEWAY_REQUIRED");
  const imageCalls = adapter.imageCalls;
  await assert.rejects(
    gateway.invokeImage({
      compensatePreparedResult: async () => "compensated",
      deadlineMs: 1,
      invocationKey: "primary",
      operationAttemptId: randomUUID(),
      operationId: randomUUID(),
      persistResult: async () => undefined,
      prepareResult: async () => {
        throw new Error("IMAGE_BOUND_DISPATCHED");
      },
      prompt: "x".repeat(48_001),
      rejectUnpreparedResult: async () => "rejected",
      resolvePreparedResult: async () => "absent",
      taskKey: "image-generation:gpt-image",
      workspaceId: randomUUID(),
    }),
    (error: unknown) =>
      error instanceof ModelGatewayInvocationError &&
      error.usageEventId === null,
  );
  assert.equal(adapter.imageCalls, imageCalls);
  const structuredCalls = adapter.structuredCalls;
  await assert.rejects(
    gateway.invokeStructured({
      deadlineMs: 1,
      invocationKey: "primary",
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      operationAttemptId: randomUUID(),
      operationId: randomUUID(),
      outputName: "image_template_selection",
      persistResult: async () => undefined,
      prompt: "x".repeat(24_001),
      schema: templateSelectionSchema,
      taskKey: "image-template-selection",
      workspaceId: randomUUID(),
    }),
    (error: unknown) =>
      error instanceof ModelGatewayInvocationError &&
      error.usageEventId === null,
  );
  assert.equal(adapter.structuredCalls, structuredCalls);
  assert.equal(MAX_OUTPUT_TOKENS, 8_192);
}

type GatewayMatrixScript =
  | { kind: "binding" }
  | { kind: "configuration" }
  | { kind: "reclaim" }
  | { kind: "claim-loss"; selection: TemplateSelection }
  | {
      fallback: boolean;
      kind: "legacy-selection";
      selection: TemplateSelection;
    }
  | {
      ambiguous?: boolean;
      code?: ModelGatewayInvocationError["code"];
      kind: "usage";
      loseClaimAfterPersist?: boolean;
      mismatch?: boolean;
      proveFences?: boolean;
      selection?: TemplateSelection;
      status: "cancelled" | "failed" | "pending" | "succeeded" | "unknown";
      truth?:
        | "creative-absent-prompt"
        | "creative-structured-failure"
        | "selection-accepted"
        | "selection-rejection";
    }
  | { kind: "absent" };

class GatewayMatrix implements ModelGateway {
  imageCalls = 0;
  reclaimedToken: string | null = null;
  structuredCalls = 0;

  constructor(
    private readonly db: Executor,
    private readonly scripts: GatewayMatrixScript[],
  ) {}

  async embedMany(): Promise<never> {
    throw new Error("GATEWAY_MATRIX_EMBEDDING_FORBIDDEN");
  }

  async invokeImage(input: ImageModelInvocation): Promise<never> {
    this.imageCalls += 1;
    return this.invoke(input, "image");
  }

  async invokeStructured<TOutput>(
    input: StructuredModelInvocation<TOutput>,
  ): Promise<never> {
    this.structuredCalls += 1;
    return this.invoke(input, "chat");
  }

  private async invoke<TOutput>(
    input: ImageModelInvocation | StructuredModelInvocation<TOutput>,
    apiKind: "chat" | "image",
  ): Promise<never> {
    const script = this.scripts.shift();
    if (!script) throw new Error("GATEWAY_MATRIX_SCRIPT_EXHAUSTED");
    if (script.kind === "binding") {
      throw new ModelBindingError("synthetic missing binding");
    }
    if (script.kind === "configuration") {
      throw new ModelTaskConfigurationError("synthetic task configuration");
    }
    if (script.kind === "absent") {
      throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
        usageEventId: randomUUID(),
      });
    }
    if (script.kind === "legacy-selection") {
      if (!("schema" in input) || !input.claimFence) {
        throw new Error("GATEWAY_MATRIX_STRUCTURED_CLAIM_REQUIRED");
      }
      const current = await loadImageProviderInput(
        this.db,
        input.workspaceId,
        input.operationId,
      );
      if (!current) throw new Error("GATEWAY_MATRIX_IMAGE_BRIEF_REQUIRED");
      assert.equal(
        await persistClaimedImageSelection(this.db, input.workspaceId, {
          attemptId: input.operationAttemptId,
          claimedBy: input.claimFence.claimedBy,
          expectedVersion: input.claimFence.expectedVersion,
          fallback: script.fallback,
          ...(script.fallback
            ? {
                fallbackCode: "VALIDATION_FAILED" as const,
                varietyDegraded: true,
              }
            : {}),
          imageBriefId: current.brief.id,
          operationId: input.operationId,
          rejections: current.brief.selectionRejections,
          selection: script.selection,
        }),
        true,
      );
      throw new Error("GATEWAY_MATRIX_LEGACY_SELECTION_CRASH");
    }
    if (script.kind === "reclaim") {
      await this.stealClaim(input);
      await assert.rejects(
        insertPendingUsage(this.db, input.workspaceId, {
          apiKind,
          backend: "remote",
          claimFence: {
            claimedBy: input.claimFence?.claimedBy ?? "",
            expectedVersion: input.claimFence?.expectedVersion ?? -1,
            now: new Date(),
          },
          invocationKey: input.invocationKey,
          operationAttemptId: input.operationAttemptId,
          operationId: input.operationId,
          providerGateway: "openrouter",
          requestedModel: "probe/no-provider",
          taskKey: input.taskKey,
        }),
        /claim fence lost/,
      );
      throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED");
    }

    const claimFence = input.claimFence;
    if (!claimFence) throw new Error("GATEWAY_MATRIX_CLAIM_FENCE_REQUIRED");
    const pendingInput = {
      apiKind,
      backend: "remote" as const,
      claimFence: { ...claimFence, now: new Date() },
      invocationKey: input.invocationKey,
      operationAttemptId: input.operationAttemptId,
      operationId: input.operationId,
      providerGateway: "openrouter" as const,
      requestedModel: "probe/no-provider",
      taskKey: input.taskKey,
    };
    if (script.kind === "usage" && script.proveFences) {
      await assert.rejects(
        insertPendingUsage(this.db, input.workspaceId, {
          ...pendingInput,
          operationAttemptId: randomUUID(),
        }),
        /operation-attempt identity mismatch/,
      );
      await assert.rejects(
        insertPendingUsage(this.db, input.workspaceId, {
          ...pendingInput,
          claimFence: {
            ...pendingInput.claimFence,
            claimedBy: `wrong:${randomUUID()}`,
          },
        }),
        /claim fence lost/,
      );
      await assert.rejects(
        insertPendingUsage(this.db, input.workspaceId, {
          ...pendingInput,
          claimFence: {
            ...pendingInput.claimFence,
            expectedVersion: pendingInput.claimFence.expectedVersion + 1,
          },
        }),
        /claim fence lost/,
      );
      await assert.rejects(
        insertPendingUsage(this.db, input.workspaceId, {
          ...pendingInput,
          operationId: randomUUID(),
        }),
        /claim fence lost/,
      );
    }
    const pending = await insertPendingUsage(
      this.db,
      input.workspaceId,
      pendingInput,
    );
    assert.equal(pending.inserted, true);
    if (script.kind === "claim-loss") {
      if (!("schema" in input)) {
        throw new Error("GATEWAY_MATRIX_STRUCTURED_TRUTH_REQUIRED");
      }
      const candidate = input.schema.parse(script.selection);
      await this.stealClaim(input);
      await assert.rejects(
        finalizeUsageWithResult(
          this.db,
          input.workspaceId,
          {
            claimFence: {
              ...claimFence,
              now: new Date(),
              operationId: input.operationId,
            },
            costAuthority: "unknown",
            id: pending.event.id,
            status: "succeeded",
          },
          (tx) => input.persistResult(tx, candidate),
        ),
        /claim fence lost/,
      );
      throw new ModelGatewayInvocationError("MODEL_INVOCATION_FAILED", {
        ambiguous: true,
        usageEventId: pending.event.id,
      });
    }
    if (script.status !== "pending") {
      const finalizeInput = {
        claimFence: {
          ...claimFence,
          now: new Date(),
          operationId: input.operationId,
        },
        costAuthority: "unknown" as const,
        id: pending.event.id,
        status: script.status,
      };
      if (
        script.truth === "selection-rejection" ||
        script.truth === "creative-structured-failure"
      ) {
        if (!("schema" in input) || !input.persistDefiniteFailure) {
          throw new Error("GATEWAY_MATRIX_STRUCTURED_FAILURE_REQUIRED");
        }
        const finalized = await finalizeUsageWithResult(
          this.db,
          input.workspaceId,
          { ...finalizeInput, status: "failed" },
          (tx) =>
            input.persistDefiniteFailure?.(tx, {
              code: "STRUCTURED_OUTPUT_INVALID",
            }) ?? Promise.resolve(),
        );
        assert.equal(finalized.status, "updated");
        if (script.loseClaimAfterPersist) {
          await this.stealClaim(input);
        }
        throw new ModelGatewayInvocationError("STRUCTURED_OUTPUT_INVALID", {
          usageEventId: pending.event.id,
        });
      }
      if (script.truth) {
        if (!("schema" in input)) {
          throw new Error("GATEWAY_MATRIX_STRUCTURED_TRUTH_REQUIRED");
        }
        const candidate = input.schema.parse(
          script.truth === "selection-accepted"
            ? script.selection
            : {
                dataElements: [],
                headline: Array.from({ length: 200 }, () => "word").join(" "),
                subjectScene: "Synthetic rejected matrix scene",
              },
        );
        const finalized = await finalizeUsageWithResult(
          this.db,
          input.workspaceId,
          finalizeInput,
          (tx) => input.persistResult(tx, candidate),
        );
        assert.equal(finalized.status, "updated");
      } else {
        const finalized = await finalizeUsage(
          this.db,
          input.workspaceId,
          finalizeInput,
        );
        assert.equal(finalized.status, "updated");
      }
    }
    if (script.loseClaimAfterPersist) {
      await this.stealClaim(input);
    }
    throw new ModelGatewayInvocationError(
      script.code ?? "MODEL_INVOCATION_FAILED",
      {
        ambiguous: script.ambiguous,
        usageEventId: script.mismatch ? randomUUID() : pending.event.id,
      },
    );
  }

  private async stealClaim<TOutput>(
    input: ImageModelInvocation | StructuredModelInvocation<TOutput>,
  ) {
    await this.db
      .update(operation)
      .set({ leaseExpiresAt: new Date(0) })
      .where(eq(operation.id, input.operationId));
    const reclaimedBy = `gateway-matrix-reclaimed:${randomUUID()}`;
    const reclaimed = await claimOperationExecution(
      this.db,
      input.workspaceId,
      {
        claimedBy: reclaimedBy,
        id: input.operationId,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        now: new Date(),
      },
    );
    assert.equal(reclaimed.status, "claimed");
    this.reclaimedToken = reclaimedBy;
  }
}

async function assertGatewayMatrixSucceeded(input: {
  actualStatus: string;
  branch: string;
  db: Executor;
  gatewayCallCount: number;
  operation: { operationId: string; token: string; workspaceId: string };
  scenario: string;
}) {
  if (input.actualStatus === "succeeded") return;

  const [operationState] = await input.db
    .select({
      claimedBy: operation.claimedBy,
      leaseExpiresAt: operation.leaseExpiresAt,
      lifecycle: operation.lifecycle,
      version: operation.version,
    })
    .from(operation)
    .where(
      and(
        eq(operation.id, input.operation.operationId),
        eq(operation.workspaceId, input.operation.workspaceId),
      ),
    );
  const selectionAttemptId = stableImageIdentity(
    input.operation.operationId,
    "selection",
  );
  const [selectionAttempt] = await input.db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      and(
        eq(operationAttempt.id, selectionAttemptId),
        eq(operationAttempt.workspaceId, input.operation.workspaceId),
      ),
    );
  const providerInput = await loadImageProviderInput(
    input.db,
    input.operation.workspaceId,
    input.operation.operationId,
  );
  const usage = await listImageStageUsage(
    input.db,
    input.operation.workspaceId,
    selectionAttemptId,
  );
  const invocationOrder = ["primary", "retry-1", "fallback"] as const;

  throw new Error(
    `GATEWAY_MATRIX_EXPECTED_SUCCEEDED ${JSON.stringify({
      actualStatus: input.actualStatus,
      branch: input.branch,
      claimMatches: operationState
        ? operationState.claimedBy === input.operation.token
        : null,
      gatewayCallCount: input.gatewayCallCount,
      operation: operationState
        ? {
            leaseValid: operationState.leaseExpiresAt
              ? operationState.leaseExpiresAt.getTime() > Date.now()
              : false,
            lifecycle: operationState.lifecycle,
            version: operationState.version,
          }
        : null,
      persistedSelection: providerInput
        ? providerInput.brief.templateSelection !== null
        : false,
      persistedFallback: providerInput?.brief.deterministicFallback ?? null,
      scenario: input.scenario,
      selectionAttempt: selectionAttempt ?? null,
      usage: usage
        .map((row) => ({
          invocationKey: row.invocationKey,
          status: row.status,
        }))
        .toSorted(
          (left, right) =>
            invocationOrder.indexOf(left.invocationKey) -
            invocationOrder.indexOf(right.invocationKey),
        ),
    })}`,
  );
}

async function beginGatewayMatrixOperation(
  db: Executor,
  runtime: WorkerRuntime,
  fixture: Fixture,
  scenario: string,
  stage: "creative" | "provider" | "selection",
) {
  const imageIntentVersion = await readFixtureImageIntentVersion(db, fixture);

  const idempotencyKey = randomUUID();
  const created = await startImageGeneration(db, fixture.workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: imageIntentVersion,
    expectedRevisionVersion: 1,
    idempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({ idempotencyKey, proof: "gateway-error-matrix" }),
    requestId: null,
  });
  assert.equal(created.status, "created");
  if (!("operationId" in created)) {
    throw new Error("GATEWAY_MATRIX_OPERATION_NOT_CREATED");
  }
  const staleIdempotencyKey = randomUUID();
  const stale = await startImageGeneration(db, fixture.workspaceId, {
    actor: fixture.actorId,
    draftRevisionId: fixture.draftRevisionId,
    expectedImageIntentVersion: imageIntentVersion,
    expectedRevisionVersion: 1,
    idempotencyKey: staleIdempotencyKey,
    modelOptionKey: fixture.modelOptionKey,
    requestHash: commandHash({
      idempotencyKey: staleIdempotencyKey,
      proof: "gateway-error-matrix-stale-intent",
    }),
    requestId: null,
  });
  assert.equal(stale.status, "image_intent_conflict");

  const token = `gateway-matrix:${randomUUID()}`;
  const claimed = await claimOperationExecution(db, fixture.workspaceId, {
    claimedBy: token,
    id: created.operationId,
    leaseExpiresAt: new Date(Date.now() + 120_000),
    now: new Date(),
  });
  assert.equal(claimed.status, "claimed");
  const input = {
    operationId: created.operationId,
    token,
    workspaceId: fixture.workspaceId,
  };
  if (stage !== "selection") {
    const adapter = new DeterministicImageAdapter(fixture.fallback, "accepted");
    const gateway = createWorkerModelGateway({
      adapters: { local: adapter, remote: adapter },
      bindings: {},
      executor: db,
      identity: runtime.identity,
      template: runtime.template,
    });
    await assertGatewayMatrixSucceeded({
      actualStatus: (await executeImageSelection(runtime, gateway, input))
        .status,
      branch: "prerequisite-selection",
      db,
      gatewayCallCount: adapter.structuredCalls,
      operation: input,
      scenario,
    });
    assert.equal(adapter.structuredCalls, 1);
    assert.equal(adapter.imageCalls, 0);
    if (stage === "provider") {
      await assertGatewayMatrixSucceeded({
        actualStatus: (await executeImageCreativeBrief(runtime, gateway, input))
          .status,
        branch: "prerequisite-creative",
        db,
        gatewayCallCount: adapter.structuredCalls,
        operation: input,
        scenario,
      });
      assert.equal(adapter.structuredCalls, 2);
      assert.equal(adapter.imageCalls, 0);
    }
  }
  return input;
}

async function cancelGatewayMatrixOperation(
  db: Executor,
  fixture: Fixture,
  operationId: string,
) {
  const context = await findImageExecutionContext(
    db,
    fixture.workspaceId,
    operationId,
  );
  if (context?.operationLifecycle !== "running" || !context.claimedBy) {
    return;
  }
  assert.ok(
    await settleImageOperationAndWakeNext(db, fixture.workspaceId, {
      claimedBy: context.claimedBy,
      expectedVersion: context.operationVersion,
      lifecycle: "cancelled",
      mediaBrandId: fixture.mediaBrandId,
      operationId,
    }),
  );
}

async function proveGatewayErrorSlotMatrix(
  db: Executor,
  runtime: WorkerRuntime,
  fixture: Fixture,
) {
  const selectionAdvance = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "selection-definite-slot-exhaustion",
    "selection",
  );
  const selectionAdvanceGateway = new GatewayMatrix(db, [
    { kind: "usage", proveFences: true, status: "failed" },
    { kind: "usage", status: "cancelled" },
    {
      kind: "usage",
      status: "succeeded",
      truth: "selection-rejection",
    },
  ]);
  await assertGatewayMatrixSucceeded({
    actualStatus: (
      await executeImageSelection(
        runtime,
        selectionAdvanceGateway,
        selectionAdvance,
      )
    ).status,
    branch: "same-call-deterministic-fallback",
    db,
    gatewayCallCount: selectionAdvanceGateway.structuredCalls,
    operation: selectionAdvance,
    scenario: "selection-definite-slot-exhaustion",
  });
  assert.equal(selectionAdvanceGateway.structuredCalls, 3);
  const selectionAdvanceTruth = await loadImageProviderInput(
    db,
    fixture.workspaceId,
    selectionAdvance.operationId,
  );
  assert.equal(selectionAdvanceTruth?.brief.deterministicFallback, true);
  const [selectionAdvanceAttempt] = await db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      eq(
        operationAttempt.id,
        stableImageIdentity(selectionAdvance.operationId, "selection"),
      ),
    );
  assert.deepEqual(selectionAdvanceAttempt, {
    failureCode: "VALIDATION_FAILED",
    outcome: "failed_terminal",
  });
  await cancelGatewayMatrixOperation(db, fixture, selectionAdvance.operationId);

  const acceptedAcknowledgementLoss = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "selection-accepted-acknowledgement-loss",
    "selection",
  );
  const acceptedAcknowledgementLossGateway = new GatewayMatrix(db, [
    {
      kind: "usage",
      selection: fixture.fallback.selection,
      status: "succeeded",
      truth: "selection-accepted",
    },
  ]);
  await assertGatewayMatrixSucceeded({
    actualStatus: (
      await executeImageSelection(
        runtime,
        acceptedAcknowledgementLossGateway,
        acceptedAcknowledgementLoss,
      )
    ).status,
    branch: "accepted-acknowledgement-loss",
    db,
    gatewayCallCount: acceptedAcknowledgementLossGateway.structuredCalls,
    operation: acceptedAcknowledgementLoss,
    scenario: "selection-accepted-acknowledgement-loss",
  });
  await assertGatewayMatrixSucceeded({
    actualStatus: (
      await executeImageSelection(
        runtime,
        acceptedAcknowledgementLossGateway,
        acceptedAcknowledgementLoss,
      )
    ).status,
    branch: "accepted-idempotent-replay",
    db,
    gatewayCallCount: acceptedAcknowledgementLossGateway.structuredCalls,
    operation: acceptedAcknowledgementLoss,
    scenario: "selection-accepted-acknowledgement-loss",
  });
  assert.equal(acceptedAcknowledgementLossGateway.structuredCalls, 1);
  const [acceptedAttempt] = await db
    .select({
      failureCode: operationAttempt.failureCode,
      outcome: operationAttempt.outcome,
    })
    .from(operationAttempt)
    .where(
      eq(
        operationAttempt.id,
        stableImageIdentity(
          acceptedAcknowledgementLoss.operationId,
          "selection",
        ),
      ),
    );
  assert.deepEqual(acceptedAttempt, {
    failureCode: null,
    outcome: "succeeded",
  });
  await cancelGatewayMatrixOperation(
    db,
    fixture,
    acceptedAcknowledgementLoss.operationId,
  );

  const restartBeforeFallback = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "selection-restart-before-fallback",
    "selection",
  );
  const restartBeforeFallbackGateway = new GatewayMatrix(db, [
    { kind: "usage", status: "failed" },
    { kind: "usage", status: "cancelled" },
    {
      kind: "usage",
      loseClaimAfterPersist: true,
      status: "succeeded",
      truth: "selection-rejection",
    },
  ]);
  assert.equal(
    (
      await executeImageSelection(
        runtime,
        restartBeforeFallbackGateway,
        restartBeforeFallback,
      )
    ).status,
    "waiting",
  );
  assert.equal(restartBeforeFallbackGateway.structuredCalls, 3);
  assert.equal(
    (
      await loadImageProviderInput(
        db,
        fixture.workspaceId,
        restartBeforeFallback.operationId,
      )
    )?.brief.templateSelection,
    null,
  );
  if (!restartBeforeFallbackGateway.reclaimedToken) {
    throw new Error("GATEWAY_MATRIX_RECLAIM_TOKEN_MISSING");
  }
  const restartGateway = new GatewayMatrix(db, []);
  const restartOperation = {
    ...restartBeforeFallback,
    token: restartBeforeFallbackGateway.reclaimedToken,
  };
  await assertGatewayMatrixSucceeded({
    actualStatus: (
      await executeImageSelection(runtime, restartGateway, restartOperation)
    ).status,
    branch: "restart-deterministic-fallback-without-new-slot",
    db,
    gatewayCallCount: restartGateway.structuredCalls,
    operation: restartOperation,
    scenario: "selection-restart-before-fallback",
  });
  assert.equal(restartGateway.structuredCalls, 0);
  assert.equal(
    (
      await loadImageProviderInput(
        db,
        fixture.workspaceId,
        restartBeforeFallback.operationId,
      )
    )?.brief.deterministicFallback,
    true,
  );
  await cancelGatewayMatrixOperation(
    db,
    fixture,
    restartBeforeFallback.operationId,
  );

  for (const fallback of [false, true]) {
    const legacy = await beginGatewayMatrixOperation(
      db,
      runtime,
      fixture,
      fallback
        ? "selection-legacy-fallback-recovery"
        : "selection-legacy-accepted-recovery",
      "selection",
    );
    const legacyGateway = new GatewayMatrix(db, [
      {
        fallback,
        kind: "legacy-selection",
        selection: fixture.fallback.selection,
      },
    ]);
    await assert.rejects(
      executeImageSelection(runtime, legacyGateway, legacy),
      /GATEWAY_MATRIX_LEGACY_SELECTION_CRASH/,
    );
    const [unsettled] = await db
      .select({ outcome: operationAttempt.outcome })
      .from(operationAttempt)
      .where(
        eq(
          operationAttempt.id,
          stableImageIdentity(legacy.operationId, "selection"),
        ),
      );
    assert.equal(unsettled?.outcome, null);
    const legacyRestartGateway = new GatewayMatrix(db, []);
    await assertGatewayMatrixSucceeded({
      actualStatus: (
        await executeImageSelection(runtime, legacyRestartGateway, legacy)
      ).status,
      branch: fallback
        ? "legacy-fallback-restart-reconciliation"
        : "legacy-accepted-restart-reconciliation",
      db,
      gatewayCallCount: legacyRestartGateway.structuredCalls,
      operation: legacy,
      scenario: fallback
        ? "selection-legacy-fallback-recovery"
        : "selection-legacy-accepted-recovery",
    });
    assert.equal(legacyRestartGateway.structuredCalls, 0);
    const [recovered] = await db
      .select({
        failureCode: operationAttempt.failureCode,
        outcome: operationAttempt.outcome,
      })
      .from(operationAttempt)
      .where(
        eq(
          operationAttempt.id,
          stableImageIdentity(legacy.operationId, "selection"),
        ),
      );
    assert.deepEqual(recovered, {
      failureCode: fallback ? "VALIDATION_FAILED" : null,
      outcome: fallback ? "failed_terminal" : "succeeded",
    });
    await cancelGatewayMatrixOperation(db, fixture, legacy.operationId);
  }

  const claimLoss = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "selection-claim-loss-after-persist",
    "selection",
  );
  const claimLossGateway = new GatewayMatrix(db, [
    { kind: "claim-loss", selection: fixture.fallback.selection },
  ]);
  assert.equal(
    (await executeImageSelection(runtime, claimLossGateway, claimLoss)).status,
    "waiting",
  );
  const claimLossTruth = await loadImageProviderInput(
    db,
    fixture.workspaceId,
    claimLoss.operationId,
  );
  assert.equal(claimLossTruth?.brief.templateSelection, null);
  const [claimLossAttempt] = await db
    .select({ outcome: operationAttempt.outcome })
    .from(operationAttempt)
    .where(
      eq(
        operationAttempt.id,
        stableImageIdentity(claimLoss.operationId, "selection"),
      ),
    );
  assert.equal(claimLossAttempt?.outcome, null);
  assert.equal(claimLossGateway.structuredCalls, 1);
  await cancelGatewayMatrixOperation(db, fixture, claimLoss.operationId);

  for (const status of ["pending", "unknown"] as const) {
    const input = await beginGatewayMatrixOperation(
      db,
      runtime,
      fixture,
      `selection-${status}-usage-replay`,
      "selection",
    );
    const gateway = new GatewayMatrix(db, [{ kind: "usage", status }]);
    assert.equal(
      (await executeImageSelection(runtime, gateway, input)).status,
      "waiting",
    );
    assert.equal(
      (await executeImageSelection(runtime, gateway, input)).status,
      "waiting",
    );
    assert.equal(gateway.structuredCalls, 1);
    await cancelGatewayMatrixOperation(db, fixture, input.operationId);
  }

  const ambiguous = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "selection-ambiguous-pending-usage",
    "selection",
  );
  const ambiguousGateway = new GatewayMatrix(db, [
    { ambiguous: true, kind: "usage", status: "pending" },
  ]);
  assert.equal(
    (await executeImageSelection(runtime, ambiguousGateway, ambiguous)).status,
    "waiting",
  );
  const ambiguousTruth = await inspectImageAttemptTruth(
    db,
    fixture.workspaceId,
    ambiguous.operationId,
  );
  assert.equal(
    ambiguousTruth.rows.some((row) => row.attemptOutcome === "ambiguous"),
    true,
  );
  assert.equal(
    (await executeImageSelection(runtime, ambiguousGateway, ambiguous)).status,
    "waiting",
  );
  assert.equal(ambiguousGateway.structuredCalls, 1);
  await cancelGatewayMatrixOperation(db, fixture, ambiguous.operationId);

  for (const [scenario, script] of [
    ["selection-absent-usage-identity", { kind: "absent" }],
    [
      "selection-mismatched-usage-identity",
      { kind: "usage", mismatch: true, status: "pending" },
    ],
    [
      "selection-unexplained-succeeded-usage",
      { kind: "usage", status: "succeeded" },
    ],
    [
      "selection-template-drift",
      { code: "TEMPLATE_DRIFT", kind: "usage", status: "pending" },
    ],
  ] satisfies Array<readonly [string, GatewayMatrixScript]>) {
    const input = await beginGatewayMatrixOperation(
      db,
      runtime,
      fixture,
      scenario,
      "selection",
    );
    const gateway = new GatewayMatrix(db, [script]);
    await assert.rejects(
      executeImageSelection(runtime, gateway, input),
      ModelGatewayInvocationError,
    );
    assert.equal(gateway.structuredCalls, 1);
    await cancelGatewayMatrixOperation(db, fixture, input.operationId);
  }

  for (const [scenario, script, expected] of [
    ["selection-binding-error", { kind: "binding" }, ModelBindingError],
    [
      "selection-configuration-error",
      { kind: "configuration" },
      ModelTaskConfigurationError,
    ],
  ] as const) {
    const input = await beginGatewayMatrixOperation(
      db,
      runtime,
      fixture,
      scenario,
      "selection",
    );
    const gateway = new GatewayMatrix(db, [script]);
    await assert.rejects(
      executeImageSelection(runtime, gateway, input),
      expected,
    );
    await cancelGatewayMatrixOperation(db, fixture, input.operationId);
  }

  const creative = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "creative-definite-slot-exhaustion",
    "creative",
  );
  const creativeGateway = new GatewayMatrix(db, [
    {
      kind: "usage",
      status: "failed",
      truth: "creative-structured-failure",
    },
    {
      kind: "usage",
      status: "failed",
      truth: "creative-structured-failure",
    },
    {
      kind: "usage",
      status: "failed",
      truth: "creative-structured-failure",
    },
  ]);
  assert.equal(
    (await executeImageCreativeBrief(runtime, creativeGateway, creative))
      .status,
    "failed",
  );
  assert.equal(creativeGateway.structuredCalls, 3);
  assert.equal(
    (
      await loadImageProviderInput(
        db,
        fixture.workspaceId,
        creative.operationId,
      )
    )?.brief.providerPrompt,
    null,
  );
  await cancelGatewayMatrixOperation(db, fixture, creative.operationId);

  const provider = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "provider-unexplained-succeeded-usage",
    "provider",
  );
  const providerGateway = new GatewayMatrix(db, [
    { kind: "usage", status: "succeeded" },
  ]);
  await assert.rejects(
    executeImageProvider(runtime, providerGateway, provider),
    ModelGatewayInvocationError,
  );
  assert.equal(providerGateway.imageCalls, 1);
  await cancelGatewayMatrixOperation(db, fixture, provider.operationId);

  const reclaimed = await beginGatewayMatrixOperation(
    db,
    runtime,
    fixture,
    "selection-reclaimed-owner",
    "selection",
  );
  const reclaimedGateway = new GatewayMatrix(db, [{ kind: "reclaim" }]);
  await assert.rejects(
    executeImageSelection(runtime, reclaimedGateway, reclaimed),
    ModelGatewayInvocationError,
  );
  assert.equal(reclaimedGateway.structuredCalls, 1);
  await cancelGatewayMatrixOperation(db, fixture, reclaimed.operationId);
}

async function proveObservedOpenRouterResponse() {
  const requestedModel = "synthetic/image-model";
  const datedModel = `${requestedModel}-20260528`;
  let imageRequests = 0;
  const invoke = (scenario: string) => {
    return createOpenRouterAdapter("deterministic-no-provider", {
      fetch: async (_input, init) => {
        imageRequests += 1;
        const request = JSON.parse(String(init?.body)) as {
          model?: string;
          n?: number;
        };
        assert.equal(request.model, requestedModel);
        assert.equal(request.n, 1);
        if (scenario === "transport") {
          throw new TypeError("synthetic transport");
        }
        if (scenario === "timeout") {
          throw new DOMException("synthetic timeout", "TimeoutError");
        }
        if (scenario.startsWith("http")) {
          return new Response(
            JSON.stringify({ error: { message: "rejected" } }),
            {
              headers: { "content-type": "application/json" },
              status:
                scenario === "http"
                  ? 422
                  : Number(scenario.slice("http-".length)),
            },
          );
        }
        return new Response(
          JSON.stringify({
            data: [{ b64_json: LOCAL_PNG.toString("base64") }],
            ...(scenario === "billed" || scenario === "exact"
              ? {
                  model: scenario === "exact" ? requestedModel : datedModel,
                  usage: {
                    completion_tokens: 1120,
                    cost: scenario === "exact" ? 0 : 0.071557,
                    prompt_tokens: 8714,
                    total_tokens: 9834,
                  },
                }
              : {}),
          }),
          {
            headers: {
              "content-type": "application/json",
              ...(scenario === "missing-identity"
                ? {}
                : { "x-generation-id": `gen-img-${scenario}` }),
            },
          },
        );
      },
    }).generateImage({
      deadlineMs: 13_500,
      model: requestedModel,
      prompt: "synthetic",
    });
  };

  const billed = await invoke("billed");
  assert.deepEqual(Buffer.from(billed.bytes), LOCAL_PNG);
  assert.equal(billed.mimeType, "image/png");
  assert.deepEqual(billed.observation, {
    completionTokens: 1120,
    costAuthority: "billed_openrouter",
    generationId: "gen-img-billed",
    openrouterCost: "0.071557",
    promptTokens: 8714,
    resolvedModel: datedModel,
    totalTokens: 9834,
  });
  const exact = await invoke("exact");
  assert.equal(exact.observation.resolvedModel, requestedModel);
  assert.equal(exact.observation.openrouterCost, "0");

  for (const [scenario, kind] of [
    ["missing-identity", "unknown"],
    ["http", "failed"],
    ["transport", "unknown"],
    ["timeout", "unknown"],
  ] as const) {
    await assert.rejects(invoke(scenario), (error: unknown) => {
      assert.ok(error instanceof AdapterInvocationError);
      assert.equal(error.kind, kind);
      if (scenario === "http") {
        assert.equal(error.observation.finishReason, "PROVIDER_REJECTED_4XX");
      }
      return true;
    });
  }
  for (const [status, code] of [
    [402, "INSUFFICIENT_CREDITS"],
    [403, "MODERATION_BLOCKED"],
    [429, "RATE_LIMITED"],
    [500, "PROVIDER_5XX"],
  ] as const) {
    await assert.rejects(invoke(`http-${status}`), (error: unknown) => {
      assert.ok(error instanceof AdapterInvocationError);
      assert.equal(error.kind, "failed");
      assert.equal(error.observation.finishReason, code);
      return true;
    });
  }
  assert.equal(imageRequests, 10);
}

async function proveRealStorageAmbiguity(db: Executor, workspaceId: string) {
  const storage = workerStorage();
  const invalidKey = `workspaces/${workspaceId}/image-originals/${randomUUID()}.png`;
  await assert.rejects(
    prepareProviderOriginal(storage, {
      bytes: new Uint8Array([1, 2, 3]),
      mediaAssetId: randomUUID(),
      mimeType: "image/png",
      objectKey: invalidKey,
    }),
    (error: unknown) =>
      error instanceof ImagePreparationError && !error.ambiguous,
  );
  await assert.rejects(storage.head(invalidKey));

  const raster = sharp({
    create: {
      background: { alpha: 1, b: 40, g: 30, r: 20 },
      channels: 4,
      height: 2,
      width: 3,
    },
  });
  for (const [extension, mimeType, bytes] of [
    ["jpg", "image/jpeg", await raster.clone().jpeg().toBuffer()],
    ["webp", "image/webp", await raster.clone().webp().toBuffer()],
  ] as const) {
    const objectKey = `workspaces/${workspaceId}/image-originals/${randomUUID()}.${extension}`;
    const preparedRaster = await prepareProviderOriginal(storage, {
      bytes,
      mediaAssetId: randomUUID(),
      mimeType,
      objectKey,
    });
    assert.deepEqual(
      {
        height: preparedRaster.height,
        mimeType: preparedRaster.mimeType,
        width: preparedRaster.width,
      },
      { height: 2, mimeType, width: 3 },
    );
    await storage.delete([objectKey]);
  }
  const mismatchKey = `workspaces/${workspaceId}/image-originals/${randomUUID()}.png`;
  await assert.rejects(
    prepareProviderOriginal(storage, {
      bytes: await raster.clone().jpeg().toBuffer(),
      mediaAssetId: randomUUID(),
      mimeType: "image/png",
      objectKey: mismatchKey,
    }),
    (error: unknown) =>
      error instanceof ImagePreparationError && !error.ambiguous,
  );
  await assert.rejects(storage.head(mismatchKey));

  const rollbackKey = `workspaces/${workspaceId}/image-originals/${randomUUID()}.png`;
  const rollbackMediaAssetId = randomUUID();
  const prepared = await prepareProviderOriginal(storage, {
    bytes: LOCAL_PNG,
    mediaAssetId: rollbackMediaAssetId,
    mimeType: "image/png",
    objectKey: rollbackKey,
  });
  const rollbackMarker = new Error("EXPECTED_MEDIA_ROLLBACK");
  await assert.rejects(
    db.transaction(async (tx) => {
      await tx.insert(mediaAsset).values({
        actualBytes: prepared.actualBytes,
        checksum: prepared.checksum,
        declaredBytes: prepared.actualBytes,
        height: prepared.height,
        id: prepared.mediaAssetId,
        kind: `${FIXTURE_PREFIX}:rollback`,
        lifecycle: "verified",
        mimeType: prepared.mimeType,
        objectKey: prepared.objectKey,
        verifiedAt: new Date(),
        width: prepared.width,
        workspaceId,
      });
      throw rollbackMarker;
    }),
    (error: unknown) => error === rollbackMarker,
  );
  assert.equal(
    (await resolveMediaAssetObjectOwnership(db, workspaceId, rollbackKey))
      .status,
    "absent",
  );
  assert.equal(
    (await compensateProviderOriginal(storage, rollbackKey)).status,
    "compensated",
  );

  const retainedKey = `workspaces/${workspaceId}/image-originals/${randomUUID()}.png`;
  const unreadable: Storage = {
    delete: (keys) => storage.delete(keys),
    getSignedUrl: (key, expiresIn) => storage.getSignedUrl(key, expiresIn),
    head: (key) => storage.head(key),
    list: (input) => storage.list(input),
    openRead: async (key) => {
      if (key === retainedKey) throw new Error("SYNTHETIC_UNCERTAIN_READ");
      return storage.openRead(key);
    },
    put: (key, body, contentType) => storage.put(key, body, contentType),
  };
  await assert.rejects(
    prepareProviderOriginal(unreadable, {
      bytes: LOCAL_PNG,
      mediaAssetId: randomUUID(),
      mimeType: "image/png",
      objectKey: retainedKey,
    }),
    (error: unknown) =>
      error instanceof ImagePreparationError && error.ambiguous,
  );
  assert.ok(await storage.head(retainedKey));
  await storage.delete([retainedKey]);

  const uncertainKey = `workspaces/${workspaceId}/image-originals/${randomUUID()}.png`;
  const corrupting: Storage = {
    delete: (keys) => storage.delete(keys),
    getSignedUrl: (key, expiresIn) => storage.getSignedUrl(key, expiresIn),
    head: (key) => storage.head(key),
    list: (input) => storage.list(input),
    openRead: async (key) =>
      key === uncertainKey
        ? { stream: new Blob([new Uint8Array([0])]).stream() }
        : storage.openRead(key),
    put: (key, body, contentType) => storage.put(key, body, contentType),
  };
  await assert.rejects(
    prepareProviderOriginal(corrupting, {
      bytes: LOCAL_PNG,
      mediaAssetId: randomUUID(),
      mimeType: "image/png",
      objectKey: uncertainKey,
    }),
    (error: unknown) =>
      error instanceof ImagePreparationError && error.ambiguous,
  );
  const ownership = await resolveMediaAssetObjectOwnership(
    db,
    workspaceId,
    uncertainKey,
  );
  assert.equal(ownership.status, "absent");
  if (ownership.status !== "absent") {
    throw new Error("STORAGE_OWNERSHIP_UNPROVEN");
  }
  assert.equal(
    (await compensateProviderOriginal(storage, uncertainKey)).status,
    "compensated",
  );
}

async function cleanupFixture(
  db: Executor,
  workspaceId: string,
  platformDraftId: string,
  mediaBrandId: string,
  extraOwnedAssetId?: string,
) {
  const generations = await db
    .select({
      briefId: imageGeneration.imageBriefId,
      finalId: imageGeneration.finalMediaAssetId,
      operationId: imageGeneration.operationId,
      originalId: imageGeneration.providerOriginalMediaAssetId,
      referenceId: imageGeneration.referenceMediaAssetId,
    })
    .from(imageGeneration)
    .innerJoin(
      draftRevision,
      eq(draftRevision.id, imageGeneration.draftRevisionId),
    )
    .where(
      and(
        eq(imageGeneration.workspaceId, workspaceId),
        eq(draftRevision.platformDraftId, platformDraftId),
      ),
    );
  const imageOperationIds = generations.map((item) => item.operationId);
  const briefIds = generations.flatMap((item) =>
    item.briefId ? [item.briefId] : [],
  );
  const originalIds = generations.flatMap((item) =>
    item.originalId ? [item.originalId] : [],
  );
  const assetIds = [
    ...new Set([
      ...originalIds,
      ...generations.flatMap((item) => (item.finalId ? [item.finalId] : [])),
      ...(extraOwnedAssetId ? [extraOwnedAssetId] : []),
      ...generations.flatMap((item) =>
        item.referenceId ? [item.referenceId] : [],
      ),
    ]),
  ];
  const assets =
    assetIds.length === 0
      ? []
      : await db
          .select({ objectKey: mediaAsset.objectKey })
          .from(mediaAsset)
          .where(
            and(
              eq(mediaAsset.workspaceId, workspaceId),
              inArray(mediaAsset.id, assetIds),
            ),
          );
  if (assets.length > 0) {
    await workerStorage().delete(assets.map((asset) => asset.objectKey));
  }
  const [revision] = await db
    .select({
      copyUnitId: copyVariant.copyGenerationUnitId,
      id: draftRevision.id,
    })
    .from(draftRevision)
    .innerJoin(
      copyVariant,
      eq(copyVariant.id, draftRevision.originatingCopyVariantId),
    )
    .where(eq(draftRevision.platformDraftId, platformDraftId));
  if (!revision) throw new Error("FIXTURE_REVISION_NOT_FOUND");
  const [unit] = await db
    .select({ copyOperationId: copyGenerationUnit.copyGenerationId })
    .from(copyGenerationUnit)
    .where(eq(copyGenerationUnit.id, revision.copyUnitId));
  const [draft] = await db
    .select({ promoIdeaId: platformDraft.promoIdeaId })
    .from(platformDraft)
    .where(eq(platformDraft.id, platformDraftId));
  if (!unit || !draft?.promoIdeaId) throw new Error("FIXTURE_GRAPH_INCOMPLETE");
  const promoIdeaId = draft.promoIdeaId;
  const [promo] = await db
    .select({ modelUnitId: promoIdea.analysisModelUnitId })
    .from(promoIdea)
    .where(eq(promoIdea.id, draft.promoIdeaId));
  if (!promo) throw new Error("FIXTURE_PROMO_NOT_FOUND");
  const [modelUnit] = await db
    .select({ analysisRunId: analysisModelUnit.analysisRunId })
    .from(analysisModelUnit)
    .where(eq(analysisModelUnit.id, promo.modelUnitId));
  if (!modelUnit) throw new Error("FIXTURE_MODEL_UNIT_NOT_FOUND");
  const [run] = await db
    .select({ operationId: analysisRun.operationId })
    .from(analysisRun)
    .where(eq(analysisRun.id, modelUnit.analysisRunId));
  if (!run) throw new Error("FIXTURE_RUN_NOT_FOUND");
  await db.transaction(async (tx) => {
    await tx
      .delete(draftRevisionCommandReceipt)
      .where(eq(draftRevisionCommandReceipt.platformDraftId, platformDraftId));
    if (imageOperationIds.length > 0) {
      await tx
        .delete(aiUsageEvent)
        .where(inArray(aiUsageEvent.operationId, imageOperationIds));
      await tx
        .delete(imageVarietyMemory)
        .where(
          inArray(imageVarietyMemory.imageGenerationId, imageOperationIds),
        );
      await tx
        .delete(imageGeneration)
        .where(inArray(imageGeneration.operationId, imageOperationIds));
    }
    if (briefIds.length > 0) {
      await tx.delete(imageBrief).where(inArray(imageBrief.id, briefIds));
    }
    await tx
      .update(platformDraft)
      .set({ activeRevisionId: null })
      .where(eq(platformDraft.id, platformDraftId));
    await tx
      .delete(draftRevision)
      .where(eq(draftRevision.platformDraftId, platformDraftId));
    if (assetIds.length > 0) {
      await tx
        .delete(mediaDerivation)
        .where(inArray(mediaDerivation.derivedMediaAssetId, assetIds));
      await tx.delete(mediaAsset).where(inArray(mediaAsset.id, assetIds));
    }
    if (imageOperationIds.length > 0) {
      await tx
        .delete(operationAttempt)
        .where(inArray(operationAttempt.operationId, imageOperationIds));
      await tx
        .delete(outboxEvent)
        .where(inArray(outboxEvent.operationId, imageOperationIds));
      await tx
        .delete(operation)
        .where(inArray(operation.id, imageOperationIds));
    }
    await tx
      .delete(copyVariant)
      .where(eq(copyVariant.copyGenerationUnitId, revision.copyUnitId));
    await tx
      .delete(copyGenerationUnit)
      .where(eq(copyGenerationUnit.id, revision.copyUnitId));
    await tx
      .delete(copyGeneration)
      .where(eq(copyGeneration.operationId, unit.copyOperationId));
    await tx
      .delete(operationAttempt)
      .where(eq(operationAttempt.operationId, unit.copyOperationId));
    await tx.delete(platformDraft).where(eq(platformDraft.id, platformDraftId));
    await tx.delete(promoIdea).where(eq(promoIdea.id, promoIdeaId));
    await tx
      .delete(analysisModelUnit)
      .where(eq(analysisModelUnit.id, promo.modelUnitId));
    await tx
      .delete(analysisRun)
      .where(eq(analysisRun.id, modelUnit.analysisRunId));
    await tx
      .delete(operation)
      .where(inArray(operation.id, [unit.copyOperationId, run.operationId]));
    await tx.delete(mediaBrand).where(eq(mediaBrand.id, mediaBrandId));
  });
  const [remaining] = await db
    .select({ id: operation.id })
    .from(operation)
    .where(inArray(operation.id, imageOperationIds));
  assert.equal(remaining, undefined);
  return "exact_fixture_removed";
}

function usageCount(db: Executor, operationId: string) {
  return db
    .select({ id: aiUsageEvent.id })
    .from(aiUsageEvent)
    .where(eq(aiUsageEvent.operationId, operationId))
    .then((rows) => rows.length);
}

function commandHash(value: unknown) {
  return hash(JSON.stringify(value));
}

function hash(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

function assertLocalServices() {
  const databaseUrl = new URL(workerEnv.DATABASE_URL);
  if (!workerEnv.S3_ENDPOINT) throw new Error("S3_ENDPOINT_PRESENCE_REQUIRED");
  const storageUrl = new URL(workerEnv.S3_ENDPOINT);
  if (
    !isLoopback(databaseUrl.hostname) ||
    !["/rz-chain-reporter", "/rz_chain_reporter_lifecycle_probe"].includes(
      databaseUrl.pathname,
    ) ||
    !isLoopback(storageUrl.hostname)
  ) {
    throw new Error("DISPOSABLE_PROJECT_LOCAL_FIXTURES_REQUIRED");
  }
}

function isLoopback(hostname: string) {
  return ["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname);
}

void (
  mode === "local"
    ? mainLocal()
    : mode === "inngest"
      ? mainInngest()
      : mode === "finalization"
        ? mainFinalization()
        : mode === "rearm-verify"
          ? mainRearmVerify(operationArgument ?? "")
          : mainPaid()
).catch((error: unknown) => {
  process.exitCode = EXIT_FAILURE;
  console.error(
    `image-generation probe failed [${error instanceof Error ? error.message : "UNKNOWN"}]`,
  );
});
