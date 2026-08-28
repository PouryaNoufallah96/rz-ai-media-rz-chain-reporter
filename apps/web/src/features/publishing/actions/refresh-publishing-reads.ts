"use server";

import { refresh } from "next/cache";

import { requireActionSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updatePublishingTags } from "../db/cache/tags";

export async function refreshPublishingReadsAction() {
  await requireActionSession();
  updatePublishingTags(await resolveInstallationWorkspaceId(rpcDb()));
  refresh();
}
