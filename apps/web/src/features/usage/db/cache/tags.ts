import "server-only";

import { workspaceCacheTag } from "@rz-chain-reporter/contracts";
import { revalidateTag, updateTag } from "next/cache";

export const usageTags = {
  ledger: (workspaceId: string) => workspaceCacheTag(workspaceId, "usage"),
};

export function updateUsageTags(workspaceId: string) {
  updateTag(usageTags.ledger(workspaceId));
}

export function revalidateUsageTags(workspaceId: string) {
  revalidateTag(usageTags.ledger(workspaceId), "max");
}
