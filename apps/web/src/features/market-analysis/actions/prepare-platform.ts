"use server";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { updateTag } from "next/cache";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import {
  preparePlatform,
  retryCaptions,
} from "@/server/rpc/routers/market-analysis";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateMarketAnalysisTags } from "../db/cache/tags";

const actionable = { context: createRequestContext } as const;

async function updatePreparePlatformTags() {
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  updateMarketAnalysisTags(workspaceId);
  updateTag(workspaceCacheTag(workspaceId, "drafts"));
  updateTag(workspaceCacheTag(workspaceId, "publishing"));
}

async function updateCaptionRetryTags() {
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  updateMarketAnalysisTags(workspaceId);
  updateTag(workspaceCacheTag(workspaceId, "drafts"));
}

export const prepareMarketPlatformAction = withMutationRefresh(
  preparePlatform.actionable(actionable),
  updatePreparePlatformTags,
);

export const retryMarketCaptionsAction = withMutationRefresh(
  retryCaptions.actionable(actionable),
  updateCaptionRetryTags,
  { refreshOnError: true },
);
