import "server-only";

import { createContext } from "@rz-chain-reporter/api/context";
import { resolveRequestId } from "@rz-chain-reporter/api/request";
import { headers } from "next/headers";

import { rpcDb } from "./db";
import { resolveInstallationWorkspaceId } from "./workspace";

export function createInstallationContext(requestHeaders: Headers) {
  return createContext(requestHeaders, resolveRequestId(requestHeaders), () =>
    resolveInstallationWorkspaceId(rpcDb()),
  );
}

export async function createRequestContext() {
  return createInstallationContext(await headers());
}
