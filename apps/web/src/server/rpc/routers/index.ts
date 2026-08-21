import "server-only";

import type { RouterClient } from "@orpc/server";

import { signIn, signOut } from "./auth";
import { overview } from "./installation";
import { confirm, createIntent } from "./media";
import { list } from "./operations";
import { detail as usageDetail } from "./usage";

export const appRouter = {
  auth: { signIn, signOut },
  installation: { overview },
  media: { confirm, createIntent },
  operations: { list },
  usage: { detail: usageDetail },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
