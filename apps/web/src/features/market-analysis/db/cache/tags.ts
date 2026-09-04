import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { updateTag } from "next/cache";

export const marketAnalysisTags = {
  reads: (workspaceId: string) =>
    workspaceCacheTag(workspaceId, "market-analysis"),
};

export function updateMarketAnalysisTags(workspaceId: string) {
  updateTag(marketAnalysisTags.reads(workspaceId));
}

export function updateMarketPlatformTags(workspaceId: string) {
  updateMarketAnalysisTags(workspaceId);
  updateTag(workspaceCacheTag(workspaceId, "drafts"));
  updateTag(workspaceCacheTag(workspaceId, "publishing"));
}

export function updateMarketCaptionTags(workspaceId: string) {
  updateMarketAnalysisTags(workspaceId);
  updateTag(workspaceCacheTag(workspaceId, "drafts"));
}
