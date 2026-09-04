"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import {
  preparePlatform,
  retryCaptions,
} from "@/server/rpc/routers/market-analysis";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import {
  updateMarketCaptionTags,
  updateMarketPlatformTags,
} from "../db/cache/tags";

const actionable = { context: createRequestContext } as const;
const refreshMarketPlatform = async () =>
  updateMarketPlatformTags(await resolveInstallationWorkspaceId(rpcDb()));
const refreshMarketCaptions = async () =>
  updateMarketCaptionTags(await resolveInstallationWorkspaceId(rpcDb()));

export const prepareMarketPlatformAction = withMutationRefresh(
  preparePlatform.actionable(actionable),
  refreshMarketPlatform,
);

export const retryMarketCaptionsAction = withMutationRefresh(
  retryCaptions.actionable(actionable),
  refreshMarketCaptions,
  { refreshOnError: true },
);
