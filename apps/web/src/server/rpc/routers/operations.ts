import "server-only";

import { protectedProcedure } from "@rz-chain-reporter/api";
import { z } from "zod";

import { listRecentOperations } from "@/features/operations/db/queries";
import { operationSummarySchema } from "@/features/operations/schemas/operation-summary";

import { rpcDb } from "../db";
import { resolveInstallationWorkspaceId } from "../workspace";

export const list = protectedProcedure
  .output(z.array(operationSummarySchema))
  .errors({ UNAUTHORIZED: { status: 401 } })
  .handler(async () => {
    const executor = rpcDb();
    const workspaceId = await resolveInstallationWorkspaceId(executor);

    return listRecentOperations(executor, workspaceId);
  });
