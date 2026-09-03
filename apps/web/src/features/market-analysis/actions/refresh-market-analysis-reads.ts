"use server";

import { refresh } from "next/cache";

import { requireActionSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateMarketAnalysisTags } from "../db/cache/tags";

export async function refreshMarketAnalysisReadsAction() {
  await requireActionSession();
  updateMarketAnalysisTags(await resolveInstallationWorkspaceId(rpcDb()));
  refresh();
}
