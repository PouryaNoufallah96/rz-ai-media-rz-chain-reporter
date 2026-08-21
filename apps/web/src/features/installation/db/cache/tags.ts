import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { revalidateTag, updateTag } from "next/cache";

export const installationTags = {
  overview: (workspaceId: string) =>
    workspaceCacheTag(workspaceId, "installation"),
};

export function updateInstallationTags(workspaceId: string) {
  updateTag(installationTags.overview(workspaceId));
}

export function revalidateInstallationTags(workspaceId: string) {
  revalidateTag(installationTags.overview(workspaceId), "max");
}
