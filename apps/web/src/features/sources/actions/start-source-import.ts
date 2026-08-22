"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import { startImport } from "@/server/rpc/routers/sources";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateSourcesTags } from "../db/cache/tags";

export const startSourceImportAction = withMutationRefresh(
  startImport.actionable({ context: createRequestContext }),
  async () => {
    updateSourcesTags(await resolveInstallationWorkspaceId(rpcDb()));
  },
);
