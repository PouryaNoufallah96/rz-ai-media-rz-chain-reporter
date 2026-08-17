import "server-only";

import type { RouterClient } from "@orpc/server";

import { signIn, signOut } from "./auth";
import { list } from "./operations";

export const appRouter = {
  auth: { signIn, signOut },
  operations: { list },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
