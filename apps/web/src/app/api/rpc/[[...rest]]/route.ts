import { BodyLimitPlugin, RPCHandler } from "@orpc/server/fetch";
import { SimpleCsrfProtectionHandlerPlugin } from "@orpc/server/plugins";
import { problemResponse, withRequestId } from "@rz-chain-reporter/api/request";
import type { NextRequest } from "next/server";
import { MAX_RPC_MULTIPART_BODY_BYTES } from "@/lib/payload-limits";
import { createInstallationContext } from "@/server/rpc/context";
import {
  hasRpcMutationInvalidation,
  revalidateRpcMutation,
} from "@/server/rpc/mutation-invalidation";
import { appRouter } from "@/server/rpc/routers/index";

const rpcHandler = new RPCHandler(appRouter, {
  clientInterceptors: [
    async ({ path, context, next }) => {
      const result = await next();
      if (hasRpcMutationInvalidation(path)) {
        revalidateRpcMutation(path, await context.getWorkspaceId());
      }
      return result;
    },
  ],
  plugins: [
    new SimpleCsrfProtectionHandlerPlugin(),
    new BodyLimitPlugin({ maxBodySize: MAX_RPC_MULTIPART_BODY_BYTES }),
  ],
});

// The body-limit plugin re-wraps the request, and `new Request(...)` rejects the
// proxied `NextRequest` it receives in dev, so hand the handler a plain request.
function toPlainRequest(req: NextRequest): Request {
  if (!req.body) return req;

  const init: RequestInit & { duplex: "half" } = {
    body: req.body,
    duplex: "half",
    headers: req.headers,
    method: req.method,
  };

  return new Request(req.url, init);
}

async function handleRequest(req: NextRequest) {
  const context = createInstallationContext(req.headers);
  const { requestId } = context;

  if (
    Number(req.headers.get("content-length")) > MAX_RPC_MULTIPART_BODY_BYTES
  ) {
    return problemResponse(
      requestId,
      413,
      "payload_too_large",
      "Payload too large",
    );
  }

  const rpcResult = await rpcHandler.handle(toPlainRequest(req), {
    prefix: "/api/rpc",
    context,
  });
  if (rpcResult.response) return withRequestId(rpcResult.response, requestId);

  return problemResponse(requestId, 404, "route_not_found", "Route not found");
}

export const GET = handleRequest;
export const POST = handleRequest;
