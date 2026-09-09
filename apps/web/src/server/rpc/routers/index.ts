import "server-only";

import type { RouterClient } from "@orpc/server";

import { signIn, signOut } from "./auth";
import {
  cancelRun,
  refreshArticleAndRegenerate,
  regenerateCopy,
  reorderDrafts,
  retryCopyGeneration,
  retryImageGeneration,
  routeDraft,
  startCopyVariantTranslation,
  startImageGeneration,
  startPresentationTranslation,
  startRun,
  updateDraftRevision,
} from "./editorial";
import { overview } from "./installation";
import {
  approveChart as approveMarketChart,
  approveDesign as approveMarketDesign,
  approveFinal as approveMarketFinal,
  approveStory as approveMarketStory,
  create as createMarketAnalysis,
  finish as finishMarketAnalysis,
  generate as generateMarketAnalysis,
  preparePlatform as prepareMarketPlatform,
  retryCaptions as retryMarketCaptions,
  retryChart as retryMarketChart,
  retryGenerationFinalization as retryMarketGenerationFinalization,
  saveChartDefault as saveMarketChartDefault,
  searchComparisons as searchMarketComparisons,
  updateMarketRequest,
} from "./market-analysis";
import { confirm, createIntent } from "./media";
import { list } from "./operations";
import {
  approve,
  attestTelegramPublication,
  cancelScheduledPublication,
  directPublish,
  discardCard,
  pausePublishing,
  reconcilePublication,
  recoverMissedPublication,
  reschedulePublication,
  restoreCard,
  resumePublishing,
  retryPublication,
  saveCard,
  schedulePublication,
} from "./publishing";
import { startImport } from "./sources";
import { detail as usageDetail } from "./usage";

export const appRouter = {
  auth: { signIn, signOut },
  editorial: {
    cancelRun,
    refreshArticleAndRegenerate,
    regenerateCopy,
    reorderDrafts,
    retryCopyGeneration,
    routeDraft,
    startCopyVariantTranslation,
    startRun,
    startImageGeneration,
    startPresentationTranslation,
    retryImageGeneration,
    updateDraftRevision,
  },
  installation: { overview },
  media: { confirm, createIntent },
  marketAnalysis: {
    approveChart: approveMarketChart,
    approveDesign: approveMarketDesign,
    approveFinal: approveMarketFinal,
    approveStory: approveMarketStory,
    create: createMarketAnalysis,
    finish: finishMarketAnalysis,
    generate: generateMarketAnalysis,
    preparePlatform: prepareMarketPlatform,
    retryCaptions: retryMarketCaptions,
    retryChart: retryMarketChart,
    retryGenerationFinalization: retryMarketGenerationFinalization,
    saveChartDefault: saveMarketChartDefault,
    searchComparisons: searchMarketComparisons,
    updateMarketRequest,
  },
  operations: { list },
  publishing: {
    approve,
    attestTelegramPublication,
    cancelScheduledPublication,
    directPublish,
    discardCard,
    pausePublishing,
    reconcilePublication,
    recoverMissedPublication,
    reschedulePublication,
    restoreCard,
    resumePublishing,
    retryPublication,
    saveCard,
    schedulePublication,
  },
  sources: { startImport },
  usage: { detail: usageDetail },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
