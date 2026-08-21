import { Inngest } from "inngest";
import { extendedTracesMiddleware } from "inngest/experimental";

import { inngestLogger } from "../logging/logger";

export function createInngestClient(appVersion: string) {
  return new Inngest({
    id: "rz-chain-reporter-worker",
    appVersion,
    logger: inngestLogger,
    middleware: [extendedTracesMiddleware({ behaviour: "off" })],
  });
}

export type WorkerInngestClient = ReturnType<typeof createInngestClient>;
