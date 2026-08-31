"use server";

import { OPERATIONS_REALTIME_TOPICS } from "@rz-chain-reporter/contracts";
import { operationsRealtimeChannel } from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

export async function getOperationsRealtimeToken() {
  await requireActionSession();

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return mintSubscriptionToken(
    operationsRealtimeChannel(workspaceId),
    OPERATIONS_REALTIME_TOPICS,
  );
}
