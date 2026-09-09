"use client";

import type { AssistantIdentity } from "../lib/assistant-context";
import { AssistantController } from "./assistant-controller";

export function AssistantWidget({ identity }: { identity: AssistantIdentity }) {
  return <AssistantController identity={identity} />;
}
