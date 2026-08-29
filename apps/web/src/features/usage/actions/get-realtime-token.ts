"use server";

import { USAGE_REALTIME_LEDGER_TOPIC } from "@rz-chain-reporter/contracts";
import { usageRealtimeChannel } from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

export async function getUsageRealtimeToken() {
  const session = await requireActionSession();

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return mintSubscriptionToken(
    usageRealtimeChannel(workspaceId, session.user.id),
    [USAGE_REALTIME_LEDGER_TOPIC],
  );
}
