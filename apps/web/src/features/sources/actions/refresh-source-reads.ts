"use server";

import { refresh } from "next/cache";

import { requireActionSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateSourcesTags } from "../db/cache/tags";

export async function refreshSourceReadsAction() {
  await requireActionSession();
  updateSourcesTags(await resolveInstallationWorkspaceId(rpcDb()));
  refresh();
}
