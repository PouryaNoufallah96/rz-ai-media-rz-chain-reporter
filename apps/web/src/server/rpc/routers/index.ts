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
  startImageGeneration,
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
  preparePlatform as prepareMarketPlatform,
  retryChart as retryMarketChart,
  saveChartDefault as saveMarketChartDefault,
  searchComparisons as searchMarketComparisons,
  updateMarketRequest,
  verify as verifyMarketAnalysis,
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
    startRun,
    startImageGeneration,
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
    preparePlatform: prepareMarketPlatform,
    retryChart: retryMarketChart,
    saveChartDefault: saveMarketChartDefault,
    searchComparisons: searchMarketComparisons,
    updateMarketRequest,
    verify: verifyMarketAnalysis,
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
