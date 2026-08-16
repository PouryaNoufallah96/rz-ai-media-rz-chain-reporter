import type { RouterClient } from "@orpc/server";

import { signIn, signOut, signUp } from "./auth";

export const appRouter = { auth: { signIn, signOut, signUp } };
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
