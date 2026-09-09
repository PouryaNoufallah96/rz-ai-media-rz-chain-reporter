import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { UrlDataBoundary } from "@/components/fetcher/suspended";
import { ShortcutsHelp } from "@/components/hotkeys/shortcuts-help";
import { PageTransition } from "@/components/layout/page-transition";
import { AssistantSlot } from "@/features/assistant/components/assistant-slot";
import { ASSISTANT_NAMESPACE } from "@/features/assistant/constants";
import { AssistantProvider } from "@/features/assistant/lib/assistant-context";
import { assistantCardLimits } from "@/features/assistant/schemas/chat-request";
import { EDITORIAL_NAMESPACE } from "@/features/editorial/constants";
import { SHARED_NAMESPACE } from "@/features/shared/constants";
import { Localized } from "@/i18n/client";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <Localized
      namespaces={[SHARED_NAMESPACE, ASSISTANT_NAMESPACE, EDITORIAL_NAMESPACE]}
    >
      <AssistantProvider limits={assistantCardLimits}>
        <PageTransition>{children}</PageTransition>
        <ShortcutsHelp />
        <UrlDataBoundary
          fallback={
            <Skeleton
              className="fixed inset-e-4 bottom-4 z-60 size-11 rounded-full"
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
