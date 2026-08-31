import "server-only";

import { env } from "@rz-chain-reporter/env/server";
import { Inngest } from "inngest";
import { getClientSubscriptionToken } from "inngest/react";
import type { Realtime } from "inngest/realtime";

const inngest = new Inngest({
  id: "rz-chain-reporter-web",
  isDev: env.INNGEST_DEV !== undefined,
  signingKey: env.INNGEST_SIGNING_KEY,
});

const realtimeConfigured =
  env.INNGEST_DEV !== undefined || env.INNGEST_SIGNING_KEY !== undefined;

export async function mintSubscriptionToken<
  const TTopics extends readonly [string, ...string[]],
>(channel: Realtime.ChannelInput & { name: string }, topics: TTopics) {
  if (!realtimeConfigured) {
    return { status: "unavailable" as const };
  }

  let token: Awaited<ReturnType<typeof getClientSubscriptionToken>>;
  try {
    token = await getClientSubscriptionToken(inngest, {
      channel,
      topics: [...topics],
    });
  } catch {
    throw new Error("Realtime subscription token is temporarily unavailable");
  }

  return {
    status: "ready" as const,
    token: {
      apiBaseUrl: token.apiBaseUrl,
      channel: channel.name,
      key: token.key,
      topics,
    },
  };
}
