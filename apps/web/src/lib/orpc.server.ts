import "server-only";

import { createRouterClient } from "@orpc/server";
import { createPublicContext } from "@rz-chain-reporter/api/context";

import { createRequestContext } from "@/server/rpc/context";
import { appRouter } from "@/server/rpc/routers/index";

// Headers-free: no request store is read, so a `"use cache"` scope may call it.
export const publicClient = createRouterClient(appRouter, {
  context: () => createPublicContext(crypto.randomUUID()),
});

export async function createRequestClient() {
  return createRouterClient(appRouter, {
    context: await createRequestContext(),
  });
}
