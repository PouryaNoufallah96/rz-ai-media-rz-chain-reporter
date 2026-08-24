import "server-only";

import type { RouterClient } from "@orpc/server";

import { signIn, signOut } from "./auth";
import { cancelRun, startRun } from "./editorial";
import { overview } from "./installation";
import { confirm, createIntent } from "./media";
import { list } from "./operations";
import { startImport } from "./sources";
import { detail as usageDetail } from "./usage";

export const appRouter = {
  auth: { signIn, signOut },
  editorial: { cancelRun, startRun },
  installation: { overview },
  media: { confirm, createIntent },
  operations: { list },
  sources: { startImport },
  usage: { detail: usageDetail },
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
