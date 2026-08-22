import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";

export const installationTags = {
  overview: (workspaceId: string) =>
    workspaceCacheTag(workspaceId, "installation"),
};
