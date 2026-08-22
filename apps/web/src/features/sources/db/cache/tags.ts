import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { updateTag } from "next/cache";

export const sourcesTags = {
  reads: (workspaceId: string) => workspaceCacheTag(workspaceId, "sources"),
};

export function updateSourcesTags(workspaceId: string) {
  updateTag(sourcesTags.reads(workspaceId));
}
