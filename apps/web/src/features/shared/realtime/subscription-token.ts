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

export async function mintSubscriptionToken<
  const TTopics extends readonly [string, ...string[]],
>(channel: Realtime.ChannelInput & { name: string }, topics: TTopics) {
  let token: Awaited<ReturnType<typeof getClientSubscriptionToken>>;
  try {
    token = await getClientSubscriptionToken(inngest, {
      channel,
      topics: [...topics],
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
      topics,
    },
  };
}
