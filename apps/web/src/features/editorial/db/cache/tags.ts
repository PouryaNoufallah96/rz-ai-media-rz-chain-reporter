import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { updateTag } from "next/cache";

export const editorialTags = {
  reads: (workspaceId: string) => workspaceCacheTag(workspaceId, "editorial"),
};

export const draftsTags = {
  reads: (workspaceId: string) => workspaceCacheTag(workspaceId, "drafts"),
  platformDraftReads: (workspaceId: string) => [
    workspaceCacheTag(workspaceId, "drafts"),
    workspaceCacheTag(workspaceId, "publishing"),
  ],
};

export function updateEditorialTags(workspaceId: string) {
  updateTag(editorialTags.reads(workspaceId));
  updateDraftsTags(workspaceId);
}

export function updateDraftsTags(workspaceId: string) {
  updateTag(draftsTags.reads(workspaceId));
}
