import { readAssistantIdentity } from "../api/server/assistant-identity";
import { AssistantWidget } from "./assistant-widget";

export async function AssistantSlot() {
  const identity = await readAssistantIdentity();

  if (!identity) {
    return null;
  }

  return <AssistantWidget identity={identity} />;
}
