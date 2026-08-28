import type { ReactNode } from "react";
import { Suspense } from "react";

import { Localized } from "@/i18n/client";
import { ASSISTANT_NAMESPACE } from "../constants";
import { AssistantProvider } from "../lib/assistant-context";
import { assistantCardLimits } from "../schemas/chat-request";
import { AssistantSlot } from "./assistant-slot";

// The provider has to sit above the whole app so an open Card Sheet and the
// selected brands reach the assistant; only the widget waits for the session.
export function AssistantScope({ children }: { children: ReactNode }) {
  return (
    <Localized namespaces={[ASSISTANT_NAMESPACE]}>
      <AssistantProvider limits={assistantCardLimits}>
        {children}
        <Suspense>
          <AssistantSlot />
        </Suspense>
      </AssistantProvider>
    </Localized>
  );
}
