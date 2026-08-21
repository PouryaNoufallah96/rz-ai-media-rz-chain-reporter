"use server";

import { OPERATIONS_REALTIME_STATUS_TOPIC } from "@rz-chain-reporter/contracts";
import { env } from "@rz-chain-reporter/env/server";
import { Inngest } from "inngest";
import { getClientSubscriptionToken } from "inngest/react";

import { getSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { operationsRealtimeChannel } from "../realtime/channel";

const inngest = new Inngest({
  id: "rz-chain-reporter-web",
  isDev: env.INNGEST_DEV !== undefined,
  signingKey: env.INNGEST_SIGNING_KEY,
});

export async function getOperationsRealtimeToken() {
  const session = await getSession();
  if (!session?.user) {
    throw new Error("unauthorized");
  }

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());
  const channel = operationsRealtimeChannel(workspaceId);
  let token: Awaited<ReturnType<typeof getClientSubscriptionToken>>;
  try {
    token = await getClientSubscriptionToken(inngest, {
      channel,
      topics: [OPERATIONS_REALTIME_STATUS_TOPIC],
    });
  } catch {
    return { status: "unavailable" as const };
  }

  return {
    status: "ready" as const,
    token: {
      apiBaseUrl: token.apiBaseUrl,
      channel: channel.name,
      key: token.key,
      topics: [OPERATIONS_REALTIME_STATUS_TOPIC],
    },
  };
}
