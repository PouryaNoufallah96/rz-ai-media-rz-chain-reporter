"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import {
  approveChart,
  approveDesign,
  approveFinal,
  approveStory,
  create,
  finish,
  generate,
  retryChart,
  retryGenerationFinalization,
  saveChartDefault,
  updateMarketRequest,
} from "@/server/rpc/routers/market-analysis";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateMarketAnalysisTags } from "../db/cache/tags";

const actionable = { context: createRequestContext } as const;
const refreshMarketAnalysis = async () =>
  updateMarketAnalysisTags(await resolveInstallationWorkspaceId(rpcDb()));

export const createMarketAnalysisAction = withMutationRefresh(
  create.actionable(actionable),
  refreshMarketAnalysis,
);

export const updateMarketRequestAction = withMutationRefresh(
  updateMarketRequest.actionable(actionable),
  refreshMarketAnalysis,
);
export const approveMarketChartAction = withMutationRefresh(
  approveChart.actionable(actionable),
  refreshMarketAnalysis,
);
export const retryMarketChartAction = withMutationRefresh(
  retryChart.actionable(actionable),
  refreshMarketAnalysis,
);
export const approveMarketStoryAction = withMutationRefresh(
  approveStory.actionable(actionable),
  refreshMarketAnalysis,
);
export const approveMarketDesignAction = withMutationRefresh(
  approveDesign.actionable(actionable),
  refreshMarketAnalysis,
);
export const approveMarketFinalAction = withMutationRefresh(
  approveFinal.actionable(actionable),
  refreshMarketAnalysis,
);
export const finishMarketAnalysisAction = withMutationRefresh(
  finish.actionable(actionable),
  refreshMarketAnalysis,
);
export const generateMarketAnalysisAction = withMutationRefresh(
  generate.actionable(actionable),
  refreshMarketAnalysis,
);
export const retryMarketGenerationFinalizationAction = withMutationRefresh(
  retryGenerationFinalization.actionable(actionable),
  refreshMarketAnalysis,
);
export const saveMarketChartDefaultAction = withMutationRefresh(
  saveChartDefault.actionable(actionable),
  refreshMarketAnalysis,
);
