import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  closestSupportedAspectRatio,
  imageOptionCapabilityKeySchema,
  persistedMarketChartSpecSchema,
  workspaceCacheTag,
} from "@rz-chain-reporter/contracts";
import {
  IMAGE_GENERATION_TASK_PREFIX,
  marketCompositionCatalogSchema,
  marketInstrumentProfileSchema,
  modelTaskKeySchema,
} from "@rz-chain-reporter/customer-template/schema";
import { withWorkspaceContext } from "@rz-chain-reporter/db/executor";
import { markPendingAttemptUsageUnknown } from "@rz-chain-reporter/db/repositories/ai-usage-event";
import {
  attachMarketFinal,
  attachMarketProviderOriginal,
  listMarketGenerationUsage,
  loadMarketGenerationContext,
  persistMarketBrief,
  persistMarketBriefRejection,
  rejectMarketProviderOriginal,
  releaseMarketFinalizationForRetry,
  reserveMarketProviderOriginal,
  resolveMarketProviderOriginal,
} from "@rz-chain-reporter/db/repositories/market-generation";
import { getMarketSnapshotWithSeries } from "@rz-chain-reporter/db/repositories/market-snapshot";
import {
  claimOperationExecution,
  settleClaimedOperation,
} from "@rz-chain-reporter/db/repositories/operation";
import {
  allocateOperationAttemptWithId,
  settleOperationAttempt,
} from "@rz-chain-reporter/db/repositories/operation-attempt";
import { mediaAsset } from "@rz-chain-reporter/db/schema/media-asset";
import {
  formatMarketPercent,
  formatMarketValue,
} from "@rz-chain-reporter/market-chart";
import { ModelGatewayInvocationError } from "@rz-chain-reporter/model-gateway/errors";
import type { ModelGateway } from "@rz-chain-reporter/model-gateway/gateway";
import { and, eq } from "drizzle-orm";
import { NonRetriableError } from "inngest";
import { workerLogger } from "../logging/logger";
import {
  deterministicMarketBrief,
  MARKET_GENERATION_BRIEF_POLICY_VERSION,
  MARKET_GENERATION_BRIEF_SCHEMA_VERSION,
  MARKET_GENERATION_PROMPT_POLICY_VERSION,
  type MarketGenerationFacts,
  type MarketGenerationSeriesFact,
  marketGenerationBriefSchema,
} from "../market-generation/brief";
import { composeCenteredRail } from "../market-generation/compositor";
import {
  buildImagePrompt,
  normalizeAndValidateBrief,
} from "../market-generation/policy";
import { nextInvocationSlot } from "../market-generation/slots";
import { workerModelGateway } from "../model-gateway/worker-gateway";
import { resolveArtifactRoot } from "../runtime/artifact-root";
import { notifyMarketAnalysisChangedNow } from "../web-cache/market-analysis";
import { notifyCacheInvalidation } from "../web-cache/notify";
import type { WorkerInngestClient } from "./client";
import { durableEvents } from "./events";
import {
  compensateProviderOriginal,
  prepareBrandedFinal,
  prepareProviderOriginal,
  readStorageBytes,
  validateStaticRaster,
  workerStorage,
} from "./media-storage";
import { assertWorkspace, type WorkerRuntime } from "./runtime";

const FUNCTION_ID = "market-generation";
const LEASE_MS = 15 * 60_000;
const PROVIDER_DEADLINE_MS = 90_000;
const MAX_REFERENCE_BYTES = 900 * 1024;

function stableIdentity(operationId: string, purpose: string) {
  const hex = createHash("sha256")
    .update(`${operationId}:${purpose}`)
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((Number.parseInt(hex[16] ?? "0", 16) & 3) | 8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function claimant(operationId: string) {
  return `market-generation:${operationId}`;
}

function digest(value: string | Uint8Array) {
  return createHash("sha256").update(value).digest("hex");
}

async function notifyGenerationChanged(
  client: WorkerInngestClient,
  workspaceId: string,
  marketAnalysisId: string,
) {
  const usage = await notifyCacheInvalidation([
    workspaceCacheTag(workspaceId, "usage"),
  ]);
  if (usage !== "accepted" && usage !== "disabled") {
    throw new Error("MARKET_GENERATION_USAGE_NOTIFICATION_UNAVAILABLE");
  }
  const market = await notifyMarketAnalysisChangedNow(
    client,
    workspaceId,
    marketAnalysisId,
  );
  if (
    market.cacheInvalidation !== "accepted" &&
    market.cacheInvalidation !== "disabled"
  ) {
    throw new Error("MARKET_GENERATION_NOTIFICATION_UNAVAILABLE");
  }
}

type GenerationContext = NonNullable<
  Awaited<ReturnType<typeof loadMarketGenerationContext>>
>;

function customerTemplateRoot(runtime: WorkerRuntime) {
  return resolve(
    resolveArtifactRoot(import.meta.url),
    `customer-templates/${runtime.identity.customerTemplateKey}`,
  );
}

async function readCustomerJson(runtime: WorkerRuntime, path: string) {
  return JSON.parse(
    await readFile(resolve(customerTemplateRoot(runtime), path), "utf8"),
  );
}

function enabledMarketTemplate(runtime: WorkerRuntime) {
  const market = runtime.template.marketAnalysis;
  if (!market.enabled) {
    throw new NonRetriableError("MARKET_ANALYSIS_DISABLED");
  }
  return market;
}

async function loadCompositionVariant(
  runtime: WorkerRuntime,
  analysis: GenerationContext["analysis"],
) {
  const market = enabledMarketTemplate(runtime);
  const catalog = marketCompositionCatalogSchema.parse(
    await readCustomerJson(runtime, market.compositions),
  );
  const family = catalog.families.find(
    (entry) => entry.key === analysis.designFamilyKey,
  );
  const variant = family?.variants.find(
    (entry) => entry.key === analysis.designVariantKey,
  );
  if (!family || !variant)
    throw new NonRetriableError("MARKET_GENERATION_DESIGN_MISSING");
  return { family, variant };
}

async function marketFacts(
  runtime: WorkerRuntime,
  workspaceId: string,
  context: GenerationContext,
): Promise<MarketGenerationFacts> {
  const { analysis, generation } = context;
  if (!analysis.storyHeadline || !analysis.storySupportingText) {
    throw new NonRetriableError("MARKET_GENERATION_STORY_MISSING");
  }
  const market = enabledMarketTemplate(runtime);
  const instrument = market.instruments.find(
    (entry) => entry.enabled && entry.key === context.instrumentKey,
  );
  if (!instrument)
    throw new NonRetriableError("MARKET_GENERATION_OWNER_MISSING");
  const { family, variant } = await loadCompositionVariant(runtime, analysis);
  const profile = marketInstrumentProfileSchema.parse(
    await readCustomerJson(runtime, instrument.visualProfile),
  );
  const snapshot = analysis.currentSnapshotId
    ? await getMarketSnapshotWithSeries(
        runtime.db,
        workspaceId,
        analysis.currentSnapshotId,
      )
    : null;
  if (!snapshot)
    throw new NonRetriableError("MARKET_GENERATION_SNAPSHOT_MISSING");
  const spec = persistedMarketChartSpecSchema.parse(analysis.currentChartSpec);
  const descriptors = new Map(
    analysis.normalizedRequest.series.map((series) => [
      series.descriptorIdentity,
      series,
    ]),
  );
  const locale = analysis.contentLocale;
  const scale = snapshot.snapshot.scale;
  const ownerChange = snapshot.series.find(
    (entry) =>
      descriptors.get(entry.descriptorIdentity)?.controlledInstrumentId ===
      analysis.visualOwnerInstrumentId,
  )?.changePercent;
  const series = snapshot.series.map((entry): MarketGenerationSeriesFact => {
    const descriptor = descriptors.get(entry.descriptorIdentity);
    if (!descriptor) {
      throw new NonRetriableError("MARKET_GENERATION_SERIES_MISSING");
    }
    const base = {
      displayName: descriptor.displayName,
      role: entry.role,
      symbol: descriptor.symbol,
    };
    if (
      entry.outcome !== "succeeded" ||
      entry.startPrice === null ||
      entry.endPrice === null ||
      entry.changePercent === null
    ) {
      return { ...base, status: "unavailable" };
    }
    return {
      ...base,
      changePercent: formatMarketPercent(locale, Number(entry.changePercent)),
      color: spec.seriesColors[entry.descriptorIdentity] ?? null,
      endValue: formatMarketValue(locale, Number(entry.endPrice), scale),
      startValue: formatMarketValue(locale, Number(entry.startPrice), scale),
      status: "verified",
    };
  });
  return {
    contentLocale: locale,
    family: { displayName: family.displayName, key: family.key },
    headline: analysis.storyHeadline,
    output: { height: generation.outputHeight, width: generation.outputWidth },
    owner: {
      changePercent: ownerChange == null ? null : Number(ownerChange),
      name: instrument.name,
      profile,
      symbol: instrument.symbol,
    },
    period: snapshot.snapshot.period,
    scale,
    series,
    supportingText: analysis.storySupportingText,
    variant,
    verifiedClaims: series.flatMap((fact) =>
      fact.status === "verified"
        ? [
            `${fact.symbol} ${fact.changePercent}`,
            `${fact.symbol} ${fact.startValue} → ${fact.endValue}`,
          ]
        : [],
    ),
  };
}

function assertCurrent(
  context: NonNullable<Awaited<ReturnType<typeof loadMarketGenerationContext>>>,
) {
  if (
    context.analysis.currentGenerationId !== context.generation.id ||
    context.analysis.designApprovalFingerprint !==
      context.generation.expectedDesignFingerprint
  ) {
    return "superseded" as const;
  }
  if (context.operation.lifecycle !== "running") return "stale" as const;
  return "current" as const;
}

async function allocateAttempt(
  runtime: WorkerRuntime,
  context: NonNullable<Awaited<ReturnType<typeof loadMarketGenerationContext>>>,
  owner: string,
  stage: "brief" | "image",
) {
  return allocateOperationAttemptWithId(
    runtime.db,
    context.generation.workspaceId,
    context.operation.id,
    stableIdentity(context.operation.id, stage),
    { claimedBy: owner, expectedVersion: context.operation.version },
  );
}

async function settleAmbiguous(
  runtime: WorkerRuntime,
  workspaceId: string,
  attemptId: string,
) {
  await markPendingAttemptUsageUnknown(runtime.db, workspaceId, attemptId);
  return { status: "ambiguous" as const };
}

async function executeBrief(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  workspaceId: string,
  operationId: string,
  owner: string,
) {
  const context = await loadMarketGenerationContext(
    runtime.db,
    workspaceId,
    operationId,
  );
  if (!context || assertCurrent(context) !== "current")
    return { status: "stale" as const };
  if (context.generation.acceptedBrief) return { status: "persisted" as const };
  const facts = await marketFacts(runtime, workspaceId, context);
  const attempt = await allocateAttempt(runtime, context, owner, "brief");
  if (!attempt) return { status: "stale" as const };
  const guardedSchema = marketGenerationBriefSchema.superRefine(
    (brief, refinement) => {
      for (const rejection of normalizeAndValidateBrief(brief, facts)
        .rejections) {
        refinement.addIssue({
          code: "custom",
          message: rejection.code,
          path: rejection.path.split("."),
        });
      }
    },
  );
  const usage = await listMarketGenerationUsage(
    runtime.db,
    workspaceId,
    attempt.id,
  );
  const task = runtime.template.models?.tasks["market-art-director-brief"];
  const slots = task?.fallback
    ? (["primary", "retry-1", "fallback"] as const)
    : (["primary", "retry-1"] as const);
  let currentUsage = usage;
  while (true) {
    const next = nextInvocationSlot(slots, currentUsage);
    if (next.status === "blocked")
      return settleAmbiguous(runtime, workspaceId, attempt.id);
    if (next.status === "exhausted") break;
    try {
      await gateway.invokeStructured({
        deadlineMs: PROVIDER_DEADLINE_MS,
        instructions:
          "You are the Art Director for a factual market poster. Reference 1 (the approved sample) is binding for geometry, hierarchy, spacing, and finish but non-authoritative for content, palette, and atmosphere; the Visual Owner theme replaces the sample's world. Reference 2 (the approved chart) is the only factual chart. Return the brief fields only.",
        invocationKey: next.invocationKey,
        maxOutputTokens: 1_400,
        operationAttemptId: attempt.id,
        operationId,
        outputName: "marketArtDirectorBrief",
        persistDefiniteFailure: (tx) =>
          persistMarketBriefRejection(tx, workspaceId, {
            generationId: context.generation.id,
            rejection: {
              code: "POLICY_OR_SCHEMA_REJECTED",
              invocationKey: next.invocationKey,
            },
          }),
        persistResult: (tx, output) => {
          const accepted = normalizeAndValidateBrief(output, facts);
          return persistMarketBrief(tx, workspaceId, {
            acceptedBrief: accepted.brief,
            briefPolicyVersion: MARKET_GENERATION_BRIEF_POLICY_VERSION,
            briefSchemaVersion: MARKET_GENERATION_BRIEF_SCHEMA_VERSION,
            briefSource: "model",
            generationId: context.generation.id,
            policyRejections: accepted.rejections,
          });
        },
        prompt: JSON.stringify({
          contentLocale: facts.contentLocale,
          headline: facts.headline,
          supportingText: facts.supportingText,
          output: facts.output,
          template: {
            family: facts.family.displayName,
            variant: facts.variant.displayName,
            direction: facts.variant.direction,
            fallbackDirection: facts.variant.fallbackDirection,
            footerRailHeightRatio: facts.variant.footerRailHeightRatio,
          },
          visualOwner: {
            name: facts.owner.name,
            symbol: facts.owner.symbol,
            changePercent: facts.owner.changePercent,
            theme: facts.owner.profile.theme,
            motifs: facts.owner.profile.motifs,
            artDirection: facts.owner.profile.artDirection,
            frozenStyle: facts.owner.profile.frozenStyle,
            approvedScenes: facts.owner.profile.scenes,
          },
          series: facts.series,
          verifiedClaims: facts.verifiedClaims,
          rules: [
            "Return headline and supportingText exactly as supplied.",
            "backgroundScene must be exactly one approvedScenes entry, verbatim, chosen for the owner's verified movement and the headline.",
            "brandTranslation describes how the owner palette, materials, and motifs map onto the sample's surfaces, device or cards, and lighting without changing the template geometry.",
            "composition and chartTreatment refine the template direction; never move the chart out of the protected area or turn the family into another family.",
            "factualClaims may only repeat verifiedClaims entries verbatim.",
            "footerSafeArea keeps the footer rail empty and continuous; the model never draws logos, domains, or footer text.",
          ],
        }),
        schema: guardedSchema,
        taskKey: "market-art-director-brief",
        workspaceId,
        claimFence: {
          claimedBy: owner,
          expectedVersion: context.operation.version,
        },
      });
      await settleOperationAttempt(runtime.db, workspaceId, {
        id: attempt.id,
        outcome: "succeeded",
        claimFence: {
          claimedBy: owner,
          expectedVersion: context.operation.version,
          operationId,
        },
      });
      return { status: "persisted" as const };
    } catch (error) {
      if (!(error instanceof ModelGatewayInvocationError)) throw error;
      if (error.ambiguous)
        return settleAmbiguous(runtime, workspaceId, attempt.id);
      currentUsage = await listMarketGenerationUsage(
        runtime.db,
        workspaceId,
        attempt.id,
      );
    }
  }
  await runtime.db.transaction(async (tx) => {
    await withWorkspaceContext(tx, workspaceId);
    await persistMarketBrief(tx, workspaceId, {
      acceptedBrief: deterministicMarketBrief(facts),
      briefPolicyVersion: MARKET_GENERATION_BRIEF_POLICY_VERSION,
      briefSchemaVersion: MARKET_GENERATION_BRIEF_SCHEMA_VERSION,
      briefSource: "deterministic_fallback",
      fallbackCode: "MODEL_INVOCATION_FAILED",
      generationId: context.generation.id,
      policyRejections: [],
    });
  });
  await settleOperationAttempt(runtime.db, workspaceId, {
    id: attempt.id,
    outcome: "succeeded",
    claimFence: {
      claimedBy: owner,
      expectedVersion: context.operation.version,
      operationId,
    },
  });
  return { status: "fallback" as const };
}

async function verifiedReference(
  bytes: Uint8Array,
  metadata: {
    byteLength: number;
    mimeType: string;
    pixelHeight: number;
    pixelWidth: number;
    sha256: string;
  },
) {
  const decoded = await validateStaticRaster(bytes, {
    maxBytes: MAX_REFERENCE_BYTES,
    maxDimension: 4096,
    maxPixels: 16_000_000,
    mimeType: metadata.mimeType,
  });
  if (
    bytes.byteLength !== metadata.byteLength ||
    decoded.width !== metadata.pixelWidth ||
    decoded.height !== metadata.pixelHeight ||
    digest(bytes) !== metadata.sha256
  )
    throw new NonRetriableError("MARKET_GENERATION_REFERENCE_INVALID");
  return {
    bytes,
    height: decoded.height,
    mimeType: decoded.mimeType,
    width: decoded.width,
  };
}

async function executeImage(
  runtime: WorkerRuntime,
  gateway: ModelGateway,
  workspaceId: string,
  operationId: string,
  owner: string,
) {
  const context = await loadMarketGenerationContext(
    runtime.db,
    workspaceId,
    operationId,
  );
  if (!context || assertCurrent(context) !== "current")
    return { status: "stale" as const };
  if (context.generation.providerOriginalMediaAssetId)
    return { status: "persisted" as const };
  const brief = marketGenerationBriefSchema.parse(
    context.generation.acceptedBrief,
  );
  const attempt = await allocateAttempt(runtime, context, owner, "image");
  if (!attempt || !gateway.invokeImage) return { status: "stale" as const };
  const facts = await marketFacts(runtime, workspaceId, context);
  const { sample } = facts.variant;
  if (
    sample.path !== context.generation.referenceSampleKey ||
    sample.sha256 !== context.generation.referenceSampleChecksum
  )
    throw new NonRetriableError("MARKET_GENERATION_SAMPLE_SUPERSEDED");
  const sampleReference = await verifiedReference(
    await readFile(resolve(customerTemplateRoot(runtime), sample.path)),
    sample,
  );
  const [chart] = await runtime.db
    .select()
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.workspaceId, workspaceId),
        eq(mediaAsset.id, context.generation.chartMediaAssetId),
      ),
    );
  if (
    chart?.lifecycle !== "verified" ||
    !chart.checksum ||
    chart.checksum !== context.generation.chartMediaChecksum ||
    !chart.actualBytes ||
    !chart.width ||
    !chart.height ||
    chart.objectRemovedAt
  )
    throw new NonRetriableError("MARKET_GENERATION_CHART_INVALID");
  const chartBytes = await readStorageBytes(workerStorage(), chart.objectKey);
  const chartReference = await verifiedReference(chartBytes, {
    byteLength: chart.actualBytes,
    mimeType: chart.mimeType,
    pixelHeight: chart.height,
    pixelWidth: chart.width,
    sha256: chart.checksum,
  });
  const usage = await listMarketGenerationUsage(
    runtime.db,
    workspaceId,
    attempt.id,
  );
  const taskKey = modelTaskKeySchema.parse(
    `${IMAGE_GENERATION_TASK_PREFIX}${context.generation.imageOptionKey}`,
  );
  const aspectRatio = closestSupportedAspectRatio(
    imageOptionCapabilityKeySchema.parse(context.generation.imageOptionKey),
    facts.output,
  );
  const slots = runtime.template.models?.tasks[taskKey]?.fallback
    ? (["primary", "retry-1", "fallback"] as const)
    : (["primary", "retry-1"] as const);
  let currentUsage = usage;
  const prompt = buildImagePrompt(
    brief,
    facts,
    context.generation.operatorDirection ?? "",
  );
  while (true) {
    const next = nextInvocationSlot(slots, currentUsage);
    if (next.status === "blocked")
      return settleAmbiguous(runtime, workspaceId, attempt.id);
    if (next.status === "exhausted") return { status: "failed" as const };
    const mediaAssetId = stableIdentity(
      operationId,
      `provider-original:${next.invocationKey}`,
    );
    const objectKey = `${workspaceId}/market-generation-originals/${mediaAssetId}`;
    await reserveMarketProviderOriginal(runtime.db, workspaceId, {
      generationId: context.generation.id,
      mediaAssetId,
      objectKey,
    });
    try {
      await gateway.invokeImage({
        aspectRatio,
        compensatePreparedResult: async () => {
          const removed = await compensateProviderOriginal(
            workerStorage(),
            objectKey,
          );
          return removed.status;
        },
        deadlineMs: PROVIDER_DEADLINE_MS,
        invocationKey: next.invocationKey,
        operationAttemptId: attempt.id,
        operationId,
        persistResult: (tx, prepared) =>
          attachMarketProviderOriginal(tx, workspaceId, {
            generationId: context.generation.id,
            media: prepared,
            promptDigest: digest(prompt),
            promptPolicyVersion: MARKET_GENERATION_PROMPT_POLICY_VERSION,
          }),
        prepareResult: ({ bytes, mimeType }) =>
          prepareProviderOriginal(workerStorage(), {
            bytes,
            mediaAssetId,
            mimeType,
            objectKey,
          }),
        prompt,
        references: [sampleReference, chartReference],
        rejectUnpreparedResult: () =>
          rejectMarketProviderOriginal(runtime.db, workspaceId, mediaAssetId),
        resolvePreparedResult: () =>
          resolveMarketProviderOriginal(
            runtime.db,
            workspaceId,
            context.generation.id,
            mediaAssetId,
          ),
        taskKey,
        workspaceId,
        claimFence: {
          claimedBy: owner,
          expectedVersion: context.operation.version,
        },
      });
      await settleOperationAttempt(runtime.db, workspaceId, {
        id: attempt.id,
        outcome: "succeeded",
        claimFence: {
          claimedBy: owner,
          expectedVersion: context.operation.version,
          operationId,
        },
      });
      return { status: "persisted" as const };
    } catch (error) {
      if (!(error instanceof ModelGatewayInvocationError)) throw error;
      if (error.ambiguous)
        return settleAmbiguous(runtime, workspaceId, attempt.id);
      currentUsage = await listMarketGenerationUsage(
        runtime.db,
        workspaceId,
        attempt.id,
      );
    }
  }
}

async function executeFinal(
  runtime: WorkerRuntime,
  workspaceId: string,
  operationId: string,
) {
  const context = await loadMarketGenerationContext(
    runtime.db,
    workspaceId,
    operationId,
  );
  if (!context || assertCurrent(context) !== "current")
    return { status: "stale" as const };
  if (context.generation.finalMediaAssetId)
    return { status: "persisted" as const };
  const originalId = context.generation.providerOriginalMediaAssetId;
  const market = enabledMarketTemplate(runtime);
  const configured = market.instruments.find(
    (entry) => entry.enabled && entry.key === context.instrumentKey,
  );
  if (!originalId || !configured)
    throw new NonRetriableError("MARKET_GENERATION_FINAL_INPUT_MISSING");
  const [original] = await runtime.db
    .select()
    .from(mediaAsset)
    .where(
      and(
        eq(mediaAsset.workspaceId, workspaceId),
        eq(mediaAsset.id, originalId),
      ),
    );
  if (original?.lifecycle !== "verified" || original.objectRemovedAt)
    throw new NonRetriableError("MARKET_GENERATION_ORIGINAL_INVALID");
  const { variant } = await loadCompositionVariant(runtime, context.analysis);
  const profile = marketInstrumentProfileSchema.parse(
    await readCustomerJson(runtime, configured.visualProfile),
  );
  const footer = await verifiedReference(
    await readFile(
      resolve(customerTemplateRoot(runtime), configured.footerLockup.path),
    ),
    configured.footerLockup,
  );
  const bytes = await composeCenteredRail({
    footerLockup: footer.bytes,
    footerRailHeightRatio: variant.footerRailHeightRatio,
    height: context.generation.outputHeight,
    plateColor: profile.theme.background,
    providerOriginal: await readStorageBytes(
      workerStorage(),
      original.objectKey,
    ),
    width: context.generation.outputWidth,
  });
  const mediaAssetId = stableIdentity(operationId, "footer-lockup-final");
  const prepared = await prepareBrandedFinal(workerStorage(), {
    bytes,
    height: context.generation.outputHeight,
    mediaAssetId,
    objectKey: `${workspaceId}/market-generation-finals/${mediaAssetId}.png`,
    width: context.generation.outputWidth,
  });
  const attached = await attachMarketFinal(runtime.db, workspaceId, {
    final: prepared,
    generationId: context.generation.id,
  });
  return {
    status:
      attached && "superseded" in attached && !attached.superseded
        ? ("persisted" as const)
        : ("superseded" as const),
  };
}

export function createMarketGenerationFunctions(
  client: WorkerInngestClient,
  runtime: WorkerRuntime,
  gateway: ModelGateway = workerModelGateway(runtime),
) {
  const effect = client.createFunction(
    {
      id: FUNCTION_ID,
      retries: 3,
      timeouts: { finish: "15m" },
      triggers: [durableEvents.operationMarketGenerationRequested],
      onFailure: async ({ event }) => {
        const payload = event.data.event.data;
        const context = await loadMarketGenerationContext(
          runtime.db,
          payload.workspaceId,
          payload.operationId,
        );
        if (
          context?.operation.lifecycle === "running" &&
          context.operation.claimedBy === claimant(payload.operationId)
        ) {
          if (
            context.generation.providerOriginalMediaAssetId &&
            !context.generation.finalMediaAssetId
          ) {
            await releaseMarketFinalizationForRetry(
              runtime.db,
              payload.workspaceId,
              {
                claimedBy: context.operation.claimedBy,
                expectedVersion: context.operation.version,
                operationId: payload.operationId,
              },
            );
          } else {
            await settleClaimedOperation(runtime.db, payload.workspaceId, {
              id: payload.operationId,
              claimedBy: context.operation.claimedBy,
              expectedVersion: context.operation.version,
              lifecycle: "failed",
            });
          }
        }
        await notifyGenerationChanged(
          client,
          payload.workspaceId,
          payload.marketAnalysisId,
        ).catch(() => {
          workerLogger.warn(
            "worker.market-generation.notification-unavailable",
            {
              operationId: payload.operationId,
              workspaceId: payload.workspaceId,
            },
          );
        });
      },
    },
    async ({ event, step }) => {
      await assertWorkspace(runtime, event.data.workspaceId);
      const owner = claimant(event.data.operationId);
      const claimed = await claimOperationExecution(
        runtime.db,
        event.data.workspaceId,
        {
          id: event.data.operationId,
          claimedBy: owner,
          now: new Date(),
          leaseExpiresAt: new Date(Date.now() + LEASE_MS),
        },
      );
      if (claimed.status !== "claimed") {
        if (claimed.status === "terminal") {
          await notifyGenerationChanged(
            client,
            event.data.workspaceId,
            event.data.marketAnalysisId,
          );
        }
        return { status: claimed.status };
      }
      const brief = await step.run("persist-market-generation-brief", () =>
        executeBrief(
          runtime,
          gateway,
          event.data.workspaceId,
          event.data.operationId,
          owner,
        ),
      );
      if (brief.status === "ambiguous") {
        await settleClaimedOperation(runtime.db, event.data.workspaceId, {
          id: event.data.operationId,
          claimedBy: owner,
          expectedVersion: claimed.operation.version,
          lifecycle: "unknown",
        });
        return brief;
      }
      const image = await step.run(
        "persist-market-generation-provider-original",
        () =>
          executeImage(
            runtime,
            gateway,
            event.data.workspaceId,
            event.data.operationId,
            owner,
          ),
      );
      if (image.status === "ambiguous") {
        await settleClaimedOperation(runtime.db, event.data.workspaceId, {
          id: event.data.operationId,
          claimedBy: owner,
          expectedVersion: claimed.operation.version,
          lifecycle: "unknown",
        });
        return image;
      }
      if (image.status === "failed")
        throw new NonRetriableError("MARKET_GENERATION_PROVIDER_EXHAUSTED");
      const final = await step.run("persist-market-generation-final", () =>
        executeFinal(runtime, event.data.workspaceId, event.data.operationId),
      );
      const latest = await loadMarketGenerationContext(
        runtime.db,
        event.data.workspaceId,
        event.data.operationId,
      );
      if (
        latest?.operation.lifecycle === "running" &&
        latest.operation.claimedBy === owner
      ) {
        await settleClaimedOperation(runtime.db, event.data.workspaceId, {
          id: event.data.operationId,
          claimedBy: owner,
          expectedVersion: latest.operation.version,
          lifecycle: final.status === "persisted" ? "succeeded" : "cancelled",
        });
      }
      await notifyGenerationChanged(
        client,
        event.data.workspaceId,
        event.data.marketAnalysisId,
      );
      return final;
    },
  );
  return [effect];
}
