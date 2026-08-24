import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { updateTag } from "next/cache";

export const editorialTags = {
  reads: (workspaceId: string) => workspaceCacheTag(workspaceId, "editorial"),
};

export function updateEditorialTags(workspaceId: string) {
  updateTag(editorialTags.reads(workspaceId));
}
