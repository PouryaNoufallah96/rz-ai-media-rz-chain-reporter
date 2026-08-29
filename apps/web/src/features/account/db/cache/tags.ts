import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

export const accountTags = {
  summaryReads: (workspaceId: string) => [
    workspaceCacheTag(workspaceId, "drafts"),
    workspaceCacheTag(workspaceId, "publishing"),
  ],
  ledgerReads: (workspaceId: string) =>
    workspaceCacheTag(workspaceId, "publishing"),
};
