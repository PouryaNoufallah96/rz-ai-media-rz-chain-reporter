"use server";

import { EDITORIAL_REALTIME_CHANGED_TOPIC } from "@rz-chain-reporter/contracts";
import { editorialRealtimeChannel } from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { readRunLifecycle } from "../db/queries";

export async function getEditorialRealtimeToken(analysisRunId: string) {
  await requireActionSession();

  const database = rpcDb();
  const workspaceId = await resolveInstallationWorkspaceId(database);

  if (!(await readRunLifecycle(database, workspaceId, analysisRunId))) {
    return { status: "unavailable" as const };
  }

  return mintSubscriptionToken(
    editorialRealtimeChannel(workspaceId, analysisRunId),
    [EDITORIAL_REALTIME_CHANGED_TOPIC],
  );
}
