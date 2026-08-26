"use server";

import { withMutationRefresh } from "@/features/shared/with-mutation-refresh";
import { createRequestContext } from "@/server/rpc/context";
import { rpcDb } from "@/server/rpc/db";
import { routeDraft } from "@/server/rpc/routers/editorial";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

import { updateDraftsTags } from "../db/cache/tags";

export const routePlatformDraftAction = withMutationRefresh(
  routeDraft.actionable({ context: createRequestContext }),
  async () => {
    updateDraftsTags(await resolveInstallationWorkspaceId(rpcDb()));
  },
);
