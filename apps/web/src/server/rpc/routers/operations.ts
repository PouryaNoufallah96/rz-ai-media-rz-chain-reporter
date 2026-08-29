import "server-only";

import { installationProcedure } from "@rz-chain-reporter/api";
import { z } from "zod";

import { listRecentOperations } from "@/features/operations/db/queries";
import { operationSummarySchema } from "@/features/operations/schemas/operation-summary";

import { rpcDb } from "../db";

export const list = installationProcedure
  .input(z.strictObject({ focusedOperationId: z.uuid().optional() }))
  .output(z.array(operationSummarySchema))
  .handler(({ context, input }) =>
    listRecentOperations(
      rpcDb(),
      context.workspaceId,
      context.session.user.id,
      input.focusedOperationId,
    ),
  );
