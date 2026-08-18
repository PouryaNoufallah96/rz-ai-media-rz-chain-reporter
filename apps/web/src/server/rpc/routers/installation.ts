import "server-only";

import { installationProcedure } from "@rz-chain-reporter/api";

import { readInstallationOverview } from "@/features/installation/db/queries";
import { installationOverviewSchema } from "@/features/installation/schemas/installation-overview";

import { rpcDb } from "../db";

export const overview = installationProcedure
  .output(installationOverviewSchema)
  .errors({ UNAUTHORIZED: { status: 401 } })
  .handler(({ context }) =>
    readInstallationOverview(rpcDb(), context.workspaceId),
  );
