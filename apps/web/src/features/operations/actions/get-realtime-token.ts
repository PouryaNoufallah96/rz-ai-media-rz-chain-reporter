"use server";

import { OPERATIONS_REALTIME_STATUS_TOPIC } from "@rz-chain-reporter/contracts";
import { operationsRealtimeChannel } from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

export async function getOperationsRealtimeToken() {
  const session = await requireActionSession();

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const minted = await mintSubscriptionToken(
    operationsRealtimeChannel(workspaceId),
    [OPERATIONS_REALTIME_STATUS_TOPIC],
  );
  return { ...minted, viewerId: session.user.id };
}
