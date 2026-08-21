import "server-only";

import { installationProcedure } from "@rz-chain-reporter/api";

import { readUsagePage } from "@/features/usage/db/queries";
import {
  usagePageSchema,
  usageQuerySchema,
} from "@/features/usage/schemas/usage";

import { rpcDb } from "../db";

export const detail = installationProcedure
  .input(usageQuerySchema)
  .output(usagePageSchema)
  .errors({ UNAUTHORIZED: { status: 401 } })
  .handler(({ context, input }) =>
    readUsagePage(rpcDb(), context.workspaceId, input),
  );
