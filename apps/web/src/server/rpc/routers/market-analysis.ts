import "server-only";

import { randomUUID } from "node:crypto";
import type { ORPCErrorConstructorMap } from "@orpc/server";
import { installationProcedure } from "@rz-chain-reporter/api";
import {
  COPY_CONFIGURATION_VERSION,
  COPY_PROMPT_VERSION,
  IMAGE_OPTION_CAPABILITIES,
  imageOptionCapabilityKeySchema,
  MARKET_CHART_OUTPUT_DIMENSIONS,
  type MarketChartSpec,
  marketChartSpecSchema,
  prepareMarketPlatformInputSchema,
  prepareMarketPlatformResultSchema,
} from "@rz-chain-reporter/contracts";
import { classifyDbError } from "@rz-chain-reporter/db/db-error";
import { startCopyOperation } from "@rz-chain-reporter/db/repositories/copy-generation";
import {
  approveMarketChart,
  approveMarketDesign,
  approveMarketStage,
  approveMarketStory,
  createOwnedMarketAnalysis,
  finishMarketAnalysis,
  MARKET_ANALYSIS_CREATE_COMMAND,
  MARKET_VERIFICATION_COMMAND,
  retryMarketChartRender,
  saveOwnedMarketChartDefault,
  updateMarketAnalysisStage,
} from "@rz-chain-reporter/db/repositories/market-analysis-commands";
import { prepareMarketPlatform } from "@rz-chain-reporter/db/repositories/market-analysis-handoff";
import { getMarketChartDefault } from "@rz-chain-reporter/db/repositories/market-chart-default";
import {
  requestMarketGeneration,
  retryMarketGenerationFinalization,
} from "@rz-chain-reporter/db/repositories/market-generation";
import { getMediaAsset } from "@rz-chain-reporter/db/repositories/media-asset";

import { copyOperationResultSchema } from "@/features/editorial/schemas/drafts";
import {
  readMarketAnalysisOptions,
  readMarketAnalysisSelectionContext,
  readMarketSnapshotAttribution,
  readOwnedMarketAnalysisCommandState,
  readOwnedMarketDraftContentLocale,
  searchMarketComparisons,
} from "@/features/market-analysis/db/queries";
import {
  chartFingerprint,
  designFingerprint,
  finalFingerprint,
  generationFingerprint,
  hashPayload,
  marketRequestFingerprint,
  normalizeMarketChartSpec,
  renderContractVersion,
  storyFingerprint,
} from "@/features/market-analysis/lib/fingerprints";
import { normalizeMarketRequestSelection } from "@/features/market-analysis/lib/normalize-market-request";
import {
  initialChartSpec,
  marketBrandKeyForInstrument,
  marketCompositionCatalog,
  marketInstrumentProfile,
  marketInstrumentTemplate,
  marketTemplate,
} from "@/features/market-analysis/lib/template";
import {
  approveChartInputSchema,
  approveDesignInputSchema,
  approveStageInputSchema,
  approveStoryInputSchema,
  chartDefaultCommandResultSchema,
  effectfulAnalysisInputSchema,
  generateMarketAnalysisInputSchema,
  marketAnalysisCommandResultSchema,
  retryMarketCaptionsInputSchema,
  retryMarketGenerationInputSchema,
  saveChartDefaultInputSchema,
  updateMarketRequestInputSchema,
} from "@/features/market-analysis/schemas/commands";
import { createMarketAnalysisInputSchema } from "@/features/market-analysis/schemas/create";
import {
  marketComparisonSearchInputSchema,
  marketComparisonSearchResultSchema,
} from "@/features/market-analysis/schemas/reads";
import {
  customerBrandPolicyFingerprints,
  customerEditorial,
  customerTemplateFingerprint,
  enabledImageModels,
} from "@/lib/customer-template.server";

import { rpcDb } from "../db";

const commandErrors = {
  VALIDATION_FAILED: { status: 400 },
  NOT_FOUND: { status: 404 },
  TRANSIENT_CONFLICT: { status: 409 },
  IDEMPOTENCY_KEY_REUSED: { status: 409 },
  MARKET_ANALYSIS_COMPLETED: { status: 409 },
  MARKET_ANALYSIS_NOT_READY: { status: 409 },
} as const;

export const searchComparisons = installationProcedure
  .input(marketComparisonSearchInputSchema)
  .output(marketComparisonSearchResultSchema)
  .handler(({ context, input }) => {
    if (!marketTemplate.enabled) return { entries: [] };
    return searchMarketComparisons(rpcDb(), context.workspaceId, input);
  });

const captionRetryErrors = {
  ...commandErrors,
  CAPTIONS_ALREADY_COMPLETE: { status: 409 },
  OPERATION_IN_PROGRESS: { status: 409 },
} as const;

type Errors = ORPCErrorConstructorMap<typeof commandErrors>;
type Context = {
  requestId: string;
  workspaceId: string;
  session: { user: { id: string } };
};
type CommandResult = Awaited<ReturnType<typeof updateMarketAnalysisStage>>;

function commandOutput(result: CommandResult, errors: Errors) {
  if (result.status === "not_found") throw errors.NOT_FOUND();
  if (result.status === "conflict") throw errors.TRANSIENT_CONFLICT();
  if (result.status === "completed") {
    throw errors.MARKET_ANALYSIS_COMPLETED();
  }
  if (result.status === "not_ready") {
    throw errors.MARKET_ANALYSIS_NOT_READY();
  }
  if (result.status === "idempotency_mismatch") {
    throw errors.IDEMPOTENCY_KEY_REUSED();
  }
  if (!result.analysis) throw errors.VALIDATION_FAILED();
  return {
    analysisId: result.analysis.id,
    version: result.analysis.version,
    ...(result.operationId ? { operationId: result.operationId } : {}),
    replayed: result.status === "replayed",
  };
}

async function ownedState(
  context: Context,
  analysisId: string,
  errors: Errors,
) {
  const state = await readOwnedMarketAnalysisCommandState(
    rpcDb(),
    context.workspaceId,
    context.session.user.id,
    analysisId,
  );
  if (!state) throw errors.NOT_FOUND();
  const chartAttribution = state.analysis.currentSnapshotId
    ? await readMarketSnapshotAttribution(
        rpcDb(),
        context.workspaceId,
        state.analysis.currentSnapshotId,
      )
    : [];
  return { ...state, chartAttribution };
}

function visualOwnerBrand(
  brands: readonly { id: string; key: string }[],
  instrumentKey: string,
) {
  const brandKey = marketBrandKeyForInstrument(instrumentKey);
  if (!brandKey) return null;
  return brands.find((brand) => brand.key === brandKey) ?? null;
}

async function selectionContext(
  context: Context,
  input: { mediaBrandId?: string; marketInstrumentId?: string },
  errors: Errors,
) {
  const selected = await readMarketAnalysisSelectionContext(
    rpcDb(),
    context.workspaceId,
    input,
  );
  if (input.mediaBrandId && !selected.brand) throw errors.VALIDATION_FAILED();
  if (input.marketInstrumentId && !selected.instrument?.enabled) {
    throw errors.VALIDATION_FAILED();
  }
  return selected;
}

function currentChartFingerprint(
  state: Awaited<ReturnType<typeof ownedState>>,
) {
  const row = state.analysis;
  const parsed = marketChartSpecSchema.safeParse(row.currentChartSpec);
  if (!row.currentSnapshotId || !parsed.success) return null;
  return chartFingerprint({
    snapshotId: row.currentSnapshotId,
    chartSpec: parsed.data,
    contentLocale: row.contentLocale,
    attribution: state.chartAttribution,
  });
}

function currentStoryFingerprint(
  state: Awaited<ReturnType<typeof ownedState>>,
) {
  const row = state.analysis;
  const chart = currentChartFingerprint(state);
  if (!chart || !row.storyHeadline || !row.storySupportingText) return null;
  return storyFingerprint({
    chartFingerprint: chart,
    headline: row.storyHeadline,
    supportingText: row.storySupportingText,
    contentLocale: row.contentLocale,
  });
}

function currentDesignFingerprint(
  state: Awaited<ReturnType<typeof ownedState>>,
) {
  const row = state.analysis;
  const story = currentStoryFingerprint(state);
  if (
    !story ||
    !row.designFamilyKey ||
    !row.designVariantKey ||
    !row.outputFormat
  ) {
    return null;
  }
  return designFingerprint({
    storyFingerprint: story,
    familyKey: row.designFamilyKey,
    variantKey: row.designVariantKey,
    outputFormat: row.outputFormat,
    templateFingerprint: row.templateFingerprint,
    instrumentProfileFingerprint: row.instrumentProfileFingerprint,
  });
}

function currentGenerationFingerprint(
  state: Awaited<ReturnType<typeof ownedState>>,
) {
  const row = state.analysis;
  const design = currentDesignFingerprint(state);
  if (!design || !row.imageOptionKey) return null;
  return generationFingerprint({
    designFingerprint: design,
    operatorDirection: row.operatorDirection ?? "",
    imageOptionKey: row.imageOptionKey,
  });
}

function approvedImageOption(key: string) {
  const parsed = imageOptionCapabilityKeySchema.safeParse(key);
  if (!parsed.success) return false;
  return (
    marketTemplate.enabled &&
    IMAGE_OPTION_CAPABILITIES[parsed.data].maxOrderedReferences >= 2 &&
    marketTemplate.approvedImageOptionKeys.includes(key) &&
    enabledImageModels.some((model) => model.key === key)
  );
}

function resolvedCopyModelOptionKey(requested: string | undefined) {
  if (requested) {
    return customerEditorial.models.some((model) => model.key === requested)
      ? requested
      : null;
  }
  return (
    customerEditorial.defaults.models[0] ??
    customerEditorial.models[0]?.key ??
    null
  );
}

function designOutputFormat(
  state: Awaited<ReturnType<typeof ownedState>>,
  input: { familyKey: string; variantKey: string },
) {
  const family = marketCompositionCatalog.families.find(
    (item) => item.enabled && item.key === input.familyKey,
  );
  const variant = family?.variants.find(
    (item) => item.enabled && item.key === input.variantKey,
  );
  const outputFormat = state.analysis.outputFormat;
  const seriesCount = state.analysis.normalizedRequest.series.length;
  if (
    !outputFormat ||
    !variant?.formats.includes(outputFormat) ||
    !variant.chartScaleRule.allowedScales.includes(
      state.analysis.normalizedRequest.scale,
    ) ||
    seriesCount < variant.minSeries ||
    seriesCount > variant.maxSeries
  ) {
    return null;
  }
  return outputFormat;
}

function verificationIdentity(
  context: Context,
  idempotencyKey: string,
  requestHash: string,
) {
  const operationId = randomUUID();
  return {
    operationId,
    actor: context.session.user.id,
    commandType: MARKET_VERIFICATION_COMMAND,
    idempotencyKey,
    requestHash,
    requestId: context.requestId,
    verificationIntentId: operationId,
  };
}

export const create = installationProcedure
  .input(createMarketAnalysisInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    if (!marketTemplate.enabled) throw errors.VALIDATION_FAILED();
    const [normalized, options] = await Promise.all([
      normalizeMarketRequestSelection(rpcDb(), context.workspaceId, input),
      readMarketAnalysisOptions(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
      ),
    ]);
    const brandingInstrument = normalized?.primaryInstruments.find(
      (instrument) => instrument.id === input.brandingInstrumentId,
    );
    const brand = brandingInstrument
      ? visualOwnerBrand(options.brands, brandingInstrument.key)
      : null;
    if (!normalized || !brandingInstrument || !brand) {
      throw errors.VALIDATION_FAILED();
    }
    const saved = await getMarketChartDefault(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      brandingInstrument.id,
    );
    const initial = initialChartSpec(
      brandingInstrument.key,
      normalized.request.series.map((series) => series.descriptorIdentity),
      saved?.normalizedChartSpec,
    );
    if (!initial) throw errors.VALIDATION_FAILED();
    return commandOutput(
      await createOwnedMarketAnalysis(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        {
          operationId: randomUUID(),
          actor: context.session.user.id,
          commandType: MARKET_ANALYSIS_CREATE_COMMAND,
          idempotencyKey: input.idempotencyKey,
          requestHash: hashPayload({ ...input, request: normalized.request }),
          requestId: context.requestId,
          analysisId: randomUUID(),
          mediaBrandId: brand.id,
          visualOwnerInstrumentId: brandingInstrument.id,
          contentLocale: input.contentLocale,
          outputFormat: input.outputFormat,
          normalizedRequest: normalized.request,
          requestFingerprint: marketRequestFingerprint(normalized.request),
          currentChartSpec: initial.chartSpec,
          templateFingerprint: customerTemplateFingerprint,
          catalogFingerprint: normalized.catalogFingerprint,
          instrumentProfileFingerprint: initial.profileFingerprint,
          verification: verificationIdentity(
            context,
            `market-entry:${hashPayload(input.idempotencyKey)}`,
            hashPayload({ createIdempotencyKey: input.idempotencyKey }),
          ),
        },
      ),
      errors,
    );
  });

export const updateMarketRequest = installationProcedure
  .input(updateMarketRequestInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const [normalized, options] = await Promise.all([
      normalizeMarketRequestSelection(rpcDb(), context.workspaceId, input),
      readMarketAnalysisOptions(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
      ),
    ]);
    const visualOwner = normalized?.primaryInstruments.find(
      (instrument) => instrument.id === input.brandingInstrumentId,
    );
    const brand = visualOwner
      ? visualOwnerBrand(options.brands, visualOwner.key)
      : null;
    if (!normalized || !visualOwner || !brand) {
      throw errors.VALIDATION_FAILED();
    }
    const saved = await getMarketChartDefault(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      visualOwner.id,
    );
    const initial = initialChartSpec(
      visualOwner.key,
      normalized.request.series.map((series) => series.descriptorIdentity),
      saved?.normalizedChartSpec,
    );
    if (!initial) throw errors.VALIDATION_FAILED();
    return commandOutput(
      await updateMarketAnalysisStage(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        {
          analysisId: input.analysisId,
          expectedVersion: input.expectedVersion,
          change: {
            normalizedRequest: normalized.request,
            requestFingerprint: marketRequestFingerprint(normalized.request),
            outputFormat: input.outputFormat,
            mediaBrandId: brand.id,
            visualOwnerInstrumentId: visualOwner.id,
            visualOwnerChartSpec: initial.chartSpec,
            instrumentProfileFingerprint: initial.profileFingerprint,
            contentLocale: input.contentLocale,
          },
          verification: verificationIdentity(
            context,
            input.idempotencyKey,
            hashPayload(input),
          ),
        },
      ),
      errors,
    );
  });

async function chartRenderCommand(
  context: Context,
  errors: Errors,
  input: {
    analysisId: string;
    expectedVersion: number;
    idempotencyKey: string;
    chartSpec?: MarketChartSpec;
  },
  retry: boolean,
) {
  const state = await ownedState(context, input.analysisId, errors);
  const chartSpec = retry
    ? marketChartSpecSchema.safeParse(state.analysis.currentChartSpec).data
    : input.chartSpec;
  const normalizedChartSpec = chartSpec
    ? normalizeMarketChartSpec(chartSpec)
    : null;
  const fingerprint =
    state.analysis.currentSnapshotId && normalizedChartSpec
      ? chartFingerprint({
          snapshotId: state.analysis.currentSnapshotId,
          chartSpec: normalizedChartSpec,
          contentLocale: state.analysis.contentLocale,
          attribution: state.chartAttribution,
        })
      : null;
  if (
    !normalizedChartSpec ||
    !fingerprint ||
    (retry && state.analysis.chartApprovalFingerprint !== fingerprint)
  ) {
    throw errors.MARKET_ANALYSIS_NOT_READY();
  }
  const operationId = randomUUID();
  const identity = {
    operationId,
    actor: context.session.user.id,
    commandType: "market-chart-render:analysis",
    idempotencyKey: input.idempotencyKey,
    requestHash: hashPayload(
      retry ? input : { ...input, chartSpec: normalizedChartSpec },
    ),
    requestId: context.requestId,
    analysisId: input.analysisId,
    expectedVersion: input.expectedVersion,
    chartRenderId: randomUUID(),
    chartFingerprint: fingerprint,
    chartSpec: normalizedChartSpec,
    renderContractVersion,
  };
  const result = retry
    ? await retryMarketChartRender(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        identity,
      )
    : await approveMarketChart(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        identity,
      );
  return commandOutput(result, errors);
}

export const approveChart = installationProcedure
  .input(approveChartInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(({ context, errors, input }) =>
    chartRenderCommand(context, errors, input, false),
  );

export const retryChart = installationProcedure
  .input(effectfulAnalysisInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(({ context, errors, input }) =>
    chartRenderCommand(context, errors, input, true),
  );

async function approve(
  context: Context,
  errors: Errors,
  input: { analysisId: string; expectedVersion: number },
) {
  const state = await ownedState(context, input.analysisId, errors);
  let fingerprint: string | null = null;
  let mediaChecksum: string | undefined;
  const design = currentDesignFingerprint(state);
  const generation = currentGenerationFingerprint(state);
  if (
    design &&
    generation &&
    state.analysis.designApprovalFingerprint === design &&
    state.analysis.currentFinalMediaAssetId
  ) {
    const asset = await getMediaAsset(
      rpcDb(),
      context.workspaceId,
      state.analysis.currentFinalMediaAssetId,
    );
    if (asset?.lifecycle === "verified" && asset.checksum) {
      mediaChecksum = asset.checksum;
      fingerprint = finalFingerprint({
        generationFingerprint: generation,
        mediaAssetId: asset.id,
        mediaChecksum,
      });
    }
  }
  if (!fingerprint) throw errors.MARKET_ANALYSIS_NOT_READY();
  return commandOutput(
    await approveMarketStage(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      {
        ...input,
        fingerprint,
        mediaChecksum: mediaChecksum ?? "",
      },
    ),
    errors,
  );
}

export const approveStory = installationProcedure
  .input(approveStoryInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const state = await ownedState(context, input.analysisId, errors);
    const chart = currentChartFingerprint(state);
    if (!chart || state.analysis.chartApprovalFingerprint !== chart) {
      throw errors.MARKET_ANALYSIS_NOT_READY();
    }
    const story = {
      headline: input.headline.normalize("NFC").trim(),
      supportingText: input.supportingText.normalize("NFC").trim(),
    };
    const fingerprint = storyFingerprint({
      chartFingerprint: chart,
      ...story,
      contentLocale: state.analysis.contentLocale,
    });
    return commandOutput(
      await approveMarketStory(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        { ...input, ...story, fingerprint },
      ),
      errors,
    );
  });

export const approveDesign = installationProcedure
  .input(approveDesignInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const state = await ownedState(context, input.analysisId, errors);
    const story = currentStoryFingerprint(state);
    const outputFormat = designOutputFormat(state, input);
    if (
      !story ||
      !outputFormat ||
      state.analysis.templateFingerprint !== customerTemplateFingerprint ||
      state.analysis.storyApprovalFingerprint !== story
    ) {
      throw errors.MARKET_ANALYSIS_NOT_READY();
    }
    const material = {
      familyKey: input.familyKey,
      variantKey: input.variantKey,
    };
    const fingerprint = designFingerprint({
      storyFingerprint: story,
      ...material,
      outputFormat,
      templateFingerprint: state.analysis.templateFingerprint,
      instrumentProfileFingerprint: state.analysis.instrumentProfileFingerprint,
    });
    return commandOutput(
      await approveMarketDesign(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        {
          analysisId: input.analysisId,
          expectedVersion: input.expectedVersion,
          fingerprint,
          storyFingerprint: story,
          material,
        },
      ),
      errors,
    );
  });

export const generate = installationProcedure
  .input(generateMarketAnalysisInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    if (!approvedImageOption(input.imageOptionKey)) {
      throw errors.VALIDATION_FAILED();
    }
    const state = await ownedState(context, input.analysisId, errors);
    const design = currentDesignFingerprint(state);
    const row = state.analysis;
    if (
      !design ||
      row.templateFingerprint !== customerTemplateFingerprint ||
      row.designApprovalFingerprint !== design ||
      !row.currentChartMediaAssetId ||
      !row.designFamilyKey ||
      !row.designVariantKey ||
      !row.outputFormat
    ) {
      throw errors.MARKET_ANALYSIS_NOT_READY();
    }
    const asset = await getMediaAsset(
      rpcDb(),
      context.workspaceId,
      row.currentChartMediaAssetId,
    );
    const variant = marketCompositionCatalog.families
      .find((family) => family.key === row.designFamilyKey)
      ?.variants.find((candidate) => candidate.key === row.designVariantKey);
    const owner = await selectionContext(
      context,
      { marketInstrumentId: row.visualOwnerInstrumentId },
      errors,
    );
    const instrument = owner.instrument
      ? marketInstrumentTemplate(owner.instrument.key)
      : undefined;
    if (
      !asset?.checksum ||
      asset.lifecycle !== "verified" ||
      !variant ||
      !instrument
    ) {
      throw errors.MARKET_ANALYSIS_NOT_READY();
    }
    const operationId = randomUUID();
    return commandOutput(
      await requestMarketGeneration(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        {
          actor: context.session.user.id,
          analysisId: row.id,
          chartMediaAssetId: asset.id,
          chartMediaChecksum: asset.checksum,
          expectedDesignFingerprint: design,
          expectedVersion: input.expectedVersion,
          footerLockupChecksum: instrument.footerLockup.sha256,
          footerLockupKey: instrument.footerLockup.path,
          generationId: randomUUID(),
          idempotencyKey: input.idempotencyKey,
          imageOptionKey: input.imageOptionKey,
          intentId: operationId,
          operationId,
          operatorDirection: input.operatorDirection ?? null,
          outputHeight: MARKET_CHART_OUTPUT_DIMENSIONS[row.outputFormat].height,
          outputWidth: MARKET_CHART_OUTPUT_DIMENSIONS[row.outputFormat].width,
          referenceSampleChecksum: variant.sample.sha256,
          referenceSampleKey: variant.sample.path,
          requestHash: hashPayload(input),
          requestId: context.requestId,
        },
      ),
      errors,
    );
  });

export const retryGenerationFinalization = installationProcedure
  .input(retryMarketGenerationInputSchema)
  .output(
    marketAnalysisCommandResultSchema.pick({ operationId: true }).extend({
      epoch: retryMarketGenerationInputSchema.shape.expectedEpoch,
    }),
  )
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const result = await retryMarketGenerationFinalization(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      input,
    );
    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "conflict") throw errors.TRANSIENT_CONFLICT();
    return { operationId: input.operationId, epoch: result.epoch };
  });

export const approveFinal = installationProcedure
  .input(approveStageInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(({ context, errors, input }) => approve(context, errors, input));

export const finish = installationProcedure
  .input(approveStageInputSchema)
  .output(marketAnalysisCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const state = await ownedState(context, input.analysisId, errors);
    if (!state.analysis.finalApprovalFingerprint) {
      throw errors.MARKET_ANALYSIS_NOT_READY();
    }
    return commandOutput(
      await finishMarketAnalysis(
        rpcDb(),
        context.workspaceId,
        context.session.user.id,
        {
          ...input,
          finalFingerprint: state.analysis.finalApprovalFingerprint,
        },
      ),
      errors,
    );
  });

export const preparePlatform = installationProcedure
  .input(prepareMarketPlatformInputSchema)
  .output(prepareMarketPlatformResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const state = await ownedState(context, input.analysisId, errors);
    const row = state.analysis;
    const selected = await selectionContext(
      context,
      { mediaBrandId: row.mediaBrandId },
      errors,
    );
    const policyFingerprint = selected.brand
      ? customerBrandPolicyFingerprints.get(selected.brand.key)
      : null;
    const platformPolicy = customerEditorial.drafting.copy.platforms.find(
      (candidate) => candidate.platform === input.platform,
    );
    const modelOptionKey = resolvedCopyModelOptionKey(input.modelOptionKey);
    if (!policyFingerprint || !platformPolicy || !modelOptionKey) {
      throw errors.VALIDATION_FAILED();
    }
    const result = await prepareMarketPlatform(rpcDb(), context.workspaceId, {
      actorId: context.session.user.id,
      analysisId: input.analysisId,
      platform: input.platform,
      modelOptionKey,
      idempotencyKey: input.idempotencyKey,
      requestHash: hashPayload(input),
      requestId: context.requestId,
      variantKeys: platformPolicy.variants.map((variant) => variant.key),
      customerTemplateFingerprint,
      brandPolicyFingerprint: policyFingerprint,
      promptVersion: COPY_PROMPT_VERSION,
      configurationVersion: COPY_CONFIGURATION_VERSION,
    }).catch((error: unknown) => {
      if (classifyDbError(error)?.kind === "retry") {
        throw errors.TRANSIENT_CONFLICT();
      }
      throw error;
    });
    if (result.status === "not_found") throw errors.NOT_FOUND();
    if (result.status === "not_ready") {
      throw errors.MARKET_ANALYSIS_NOT_READY();
    }
    if (result.status === "mismatch") {
      throw errors.IDEMPOTENCY_KEY_REUSED();
    }
    if (result.status === "platform_not_allowed") {
      throw errors.VALIDATION_FAILED();
    }
    if (!("draft" in result)) throw errors.TRANSIENT_CONFLICT();
    return {
      status: result.status,
      draftId: result.draft.id,
      platform: result.draft.platform,
      lanePosition: null,
      generationLifecycle: result.generationLifecycle,
    };
  });

export const retryCaptions = installationProcedure
  .input(retryMarketCaptionsInputSchema)
  .output(copyOperationResultSchema)
  .errors(captionRetryErrors)
  .handler(async ({ context, errors, input }) => {
    const state = await ownedState(context, input.analysisId, errors);
    const modelOptionKey = resolvedCopyModelOptionKey(input.modelOptionKey);
    if (
      state.analysis.status !== "in_progress" ||
      !state.analysis.finalApprovalFingerprint ||
      !modelOptionKey
    ) {
      throw errors.VALIDATION_FAILED();
    }
    const recovery = {
      actor: context.session.user.id,
      platformDraftId: input.platformDraftId,
      marketAnalysis: {
        expectedVersion: input.expectedVersion,
        id: input.analysisId,
      },
      idempotencyKey: input.idempotencyKey,
      requestHash: hashPayload(input),
      requestId: context.requestId,
      copyPolicy: {
        fingerprints: Object.fromEntries(customerBrandPolicyFingerprints),
        modelOptionKeys: customerEditorial.models.map((model) => model.key),
        platforms: customerEditorial.drafting.copy.platforms.map(
          (platform) => ({
            platform: platform.platform,
            variantKeys: platform.variants.map((variant) => variant.key),
          }),
        ),
      },
      customerTemplateFingerprint,
      promptVersion: COPY_PROMPT_VERSION,
      configurationVersion: COPY_CONFIGURATION_VERSION,
    } as const;
    const recovered = await startCopyOperation(rpcDb(), context.workspaceId, {
      ...recovery,
      mode: "recover_incomplete",
    });
    const result =
      !("operationId" in recovered) && recovered.status === "already_complete"
        ? await startCopyOperation(rpcDb(), context.workspaceId, {
            ...recovery,
            mode: "regenerate",
            modelOptionKey,
            requestedContentLocale:
              (await readOwnedMarketDraftContentLocale(
                rpcDb(),
                context.workspaceId,
                input.analysisId,
                input.platformDraftId,
              )) ?? state.analysis.contentLocale,
          })
        : recovered;
    if (!("operationId" in result)) {
      if (result.status === "already_complete") {
        throw errors.CAPTIONS_ALREADY_COMPLETE();
      }
      if (result.status === "not_found") throw errors.NOT_FOUND();
      if (result.status === "idempotency_mismatch") {
        throw errors.IDEMPOTENCY_KEY_REUSED();
      }
      if (result.status === "operation_in_progress") {
        throw errors.OPERATION_IN_PROGRESS();
      }
      if (result.status === "version_conflict") {
        throw errors.TRANSIENT_CONFLICT();
      }
      throw errors.VALIDATION_FAILED();
    }
    return result;
  });

export const saveChartDefault = installationProcedure
  .input(saveChartDefaultInputSchema)
  .output(chartDefaultCommandResultSchema)
  .errors(commandErrors)
  .handler(async ({ context, errors, input }) => {
    const selected = await selectionContext(
      context,
      { marketInstrumentId: input.marketInstrumentId },
      errors,
    );
    if (
      !selected.instrument ||
      !marketInstrumentProfile(selected.instrument.key)
    ) {
      throw errors.VALIDATION_FAILED();
    }
    const result = await saveOwnedMarketChartDefault(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      {
        marketInstrumentId: input.marketInstrumentId,
        chartSpec: normalizeMarketChartSpec(input.chartSpec),
        expectedVersion: input.expectedVersion,
      },
    );
    if (result.status === "conflict") throw errors.TRANSIENT_CONFLICT();
    return {
      marketInstrumentId: result.chartDefault.marketInstrumentId,
      version: result.chartDefault.version,
    };
  });
