import "server-only";

import { revalidateTag, updateTag } from "next/cache";

import { workspaceTag } from "@/lib/cache-tags";

export const installationTags = {
  overview: (workspaceId: string) => workspaceTag(workspaceId, "installation"),
};

export function updateInstallationTags(workspaceId: string) {
  updateTag(installationTags.overview(workspaceId));
}

export function revalidateInstallationTags(workspaceId: string) {
  revalidateTag(installationTags.overview(workspaceId), "max");
}
