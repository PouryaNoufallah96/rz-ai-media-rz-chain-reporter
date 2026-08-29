"use server";

import { PUBLISHING_REALTIME_CHANGED_TOPIC } from "@rz-chain-reporter/contracts";
import { publishingRealtimeChannel } from "@rz-chain-reporter/contracts/realtime-channels";

import { requireActionSession } from "@/features/auth/api/server/session";
import { mintSubscriptionToken } from "@/features/shared/realtime/subscription-token";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

export async function getPublishingRealtimeToken() {
  const session = await requireActionSession();
  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  return mintSubscriptionToken(
    publishingRealtimeChannel(workspaceId, session.user.id),
    [PUBLISHING_REALTIME_CHANGED_TOPIC],
  );
}
