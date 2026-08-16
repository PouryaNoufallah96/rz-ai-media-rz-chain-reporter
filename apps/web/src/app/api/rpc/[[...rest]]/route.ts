import { RPCHandler } from "@orpc/server/fetch";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import { createContext } from "@rz-chain-reporter/api/context";
import {
  problemResponse,
  resolveRequestId,
  withRequestId,
} from "@rz-chain-reporter/api/request";
import type { NextRequest } from "next/server";
import { appRouter } from "@/server/rpc/routers/index";

const rpcHandler = new RPCHandler(appRouter, {
  plugins: [new SimpleCsrfProtectionHandlerPlugin()],
});

async function handleRequest(req: NextRequest) {
  const requestId = resolveRequestId(req.headers);
  const rpcResult = await rpcHandler.handle(req, {
    prefix: "/api/rpc",
    context: await createContext(req.headers, requestId),
  });
  if (rpcResult.response) return withRequestId(rpcResult.response, requestId);

  return problemResponse(requestId, 404, "route_not_found", "Route not found");
}

export const GET = handleRequest;
export const POST = handleRequest;
