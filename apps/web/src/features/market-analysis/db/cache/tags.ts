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
