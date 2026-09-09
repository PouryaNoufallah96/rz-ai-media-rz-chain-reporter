import "server-only";

import { getSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";

export async function readAssistantIdentity() {
  const session = await getSession();

  if (!session?.user) {
    return null;
  }

  return {
    operatorId: session.user.id,
    workspaceId: await resolveInstallationWorkspaceId(rpcDb()),
  };
}
