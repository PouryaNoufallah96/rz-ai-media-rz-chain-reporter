import "server-only";

import { cacheLife, cacheTag } from "next/cache";

import { requireSession } from "@/features/auth/api/server/session";
import { customerAcquisition } from "@/lib/customer-template.server";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { IMPORT_WINDOW_HOURS, MAX_TOP_N } from "../../constants";
import { sourcesTags } from "../../db/cache/tags";
import { readRecentSourceImports } from "../../db/queries";
import type {
  SourceImportDefaults,
  SourceImportsView,
} from "../../schemas/imports";

const FALLBACK_WINDOW_HOURS = 24;

// Template window and top-N are free integers; the form's closed set is applied here.
const defaults: SourceImportDefaults = {
  windowHours:
    IMPORT_WINDOW_HOURS.find(
      (hours) => hours === customerAcquisition.defaultWindowHours,
    ) ?? FALLBACK_WINDOW_HOURS,
  orderingMode: customerAcquisition.orderingMode,
  topN: Math.min(customerAcquisition.topN, MAX_TOP_N),
  enrichmentEnabled: customerAcquisition.enrichmentEnabled,
};

export async function getSourceImports(): Promise<SourceImportsView> {
  await requireSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());

  return {
    ...(await readCachedSourceImports(workspaceId)),
    defaults,
    readAt: new Date(),
  };
}

async function readCachedSourceImports(workspaceId: string) {
  "use cache";
  cacheTag(sourcesTags.reads(workspaceId));
  cacheLife("minutes");

  return readRecentSourceImports(rpcDb(), workspaceId);
}
