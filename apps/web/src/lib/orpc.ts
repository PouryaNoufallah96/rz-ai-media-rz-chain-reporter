import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { SimpleCsrfProtectionLinkPlugin } from "@orpc/client/plugins";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

import type { AppRouterClient } from "@/server/rpc/routers/index";

const link = new RPCLink({
  url: () => {
    if (typeof window === "undefined") {
      throw new Error(
        "The browser RPC client reached the server. Server code calls the router directly through lib/orpc.server.ts.",
      );
    }

    return `${window.location.origin}/api/rpc`;
  },
  plugins: [new SimpleCsrfProtectionLinkPlugin()],
});

export const client: AppRouterClient = createORPCClient(link);

export const orpc = createTanstackQueryUtils(client);
