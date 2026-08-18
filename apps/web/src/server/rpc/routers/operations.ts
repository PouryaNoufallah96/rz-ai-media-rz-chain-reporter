import "server-only";

import { installationProcedure } from "@rz-chain-reporter/api";
import { z } from "zod";

import { listRecentOperations } from "@/features/operations/db/queries";
import { operationSummarySchema } from "@/features/operations/schemas/operation-summary";

import { rpcDb } from "../db";

export const list = installationProcedure
  .output(z.array(operationSummarySchema))
  .errors({ UNAUTHORIZED: { status: 401 } })
  .handler(({ context }) => listRecentOperations(rpcDb(), context.workspaceId));
