import "server-only";

import { createRouterClient } from "@orpc/server";
import {
  createContext,
  createPublicContext,
} from "@rz-chain-reporter/api/context";
import { resolveRequestId } from "@rz-chain-reporter/api/request";
import { headers } from "next/headers";

import { appRouter } from "@/server/rpc/routers/index";

// Headers-free: no request store is read, so a `"use cache"` scope may call it.
export const publicClient = createRouterClient(appRouter, {
  context: () => createPublicContext(crypto.randomUUID()),
});

export async function createRequestClient() {
  const requestHeaders = await headers();

  return createRouterClient(appRouter, {
    context: createContext(requestHeaders, resolveRequestId(requestHeaders)),
  });
}
