import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { updateTag } from "next/cache";

export const publishingTags = {
  reads: (workspaceId: string) => workspaceCacheTag(workspaceId, "publishing"),
  savedRevisionReads: (workspaceId: string) =>
    workspaceCacheTag(workspaceId, "drafts"),
};

export function updatePublishingTags(workspaceId: string) {
  updateTag(publishingTags.reads(workspaceId));
}
