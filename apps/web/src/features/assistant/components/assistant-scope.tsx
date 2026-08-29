import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import type { ReactNode } from "react";

import { UrlDataBoundary } from "@/components/fetcher/suspended";
import { Localized } from "@/i18n/client";
import { ASSISTANT_NAMESPACE } from "../constants";
import { AssistantProvider } from "../lib/assistant-context";
import { assistantCardLimits } from "../schemas/chat-request";
import { AssistantSlot } from "./assistant-slot";

// The provider sits above the `(app)` group so an open Card Sheet and the
// selected brands reach the assistant; only the widget waits for the session.
export function AssistantScope({ children }: { children: ReactNode }) {
  return (
    <Localized namespaces={[ASSISTANT_NAMESPACE]}>
      <AssistantProvider limits={assistantCardLimits}>
        {children}
        <UrlDataBoundary
          fallback={
            <Skeleton
              className="fixed inset-e-4 bottom-4 z-60 size-10 rounded-full"
              data-assistant-fab
            />
          }
        >
          <AssistantSlot />
        </UrlDataBoundary>
      </AssistantProvider>
    </Localized>
  );
}
