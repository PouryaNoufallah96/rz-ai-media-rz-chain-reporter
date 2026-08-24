"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import { cancelRun } from "@/server/rpc/routers/editorial";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateEditorialTags } from "../db/cache/tags";

export const cancelAnalysisRunAction = withMutationRefresh(
  cancelRun.actionable({ context: createRequestContext }),
  async () => {
    updateEditorialTags(await resolveInstallationWorkspaceId(rpcDb()));
  },
);
