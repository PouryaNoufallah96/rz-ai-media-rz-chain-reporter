import { getSession } from "@/features/auth/api/server/session";
import { rpcDb } from "@/server/rpc/db";
import { resolveInstallationWorkspaceId } from "@/server/rpc/workspace";
import { AssistantWidget } from "./assistant-widget";

// Anonymous shells render nothing: this slot never gates the app tree.
export async function AssistantSlot() {
  const session = await getSession();

  if (!session?.user) {
    return null;
  }

  const workspaceId = await resolveInstallationWorkspaceId(rpcDb());

  return (
    <AssistantWidget identity={{ operatorId: session.user.id, workspaceId }} />
  );
}
