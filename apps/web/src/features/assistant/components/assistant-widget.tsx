"use client";

import { useChat } from "@ai-sdk/react";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogPortal,
  DialogTitle,
} from "@rz-chain-reporter/ui/components/dialog";
import { DefaultChatTransport } from "ai";
import { MessageCircleIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useSyncExternalStore,
} from "react";

import { signalUsageRefresh } from "@/features/usage/lib/usage-refresh-signal";
import { usePathname } from "@/i18n/navigation";

import { ASSISTANT_NAMESPACE } from "../constants";
import { type AssistantIdentity, useAssistant } from "../lib/assistant-context";
import {
  clearHistory,
  expiresAt,
  historyKey,
  readHistory,
  saveHistory,
  subscribeToStoredHistory,
} from "../lib/local-history";
import type { AssistantUIMessage } from "../schemas/assistant-message";
import type { AssistantAnswer } from "./assistant-ask-user";
import { AssistantComposer } from "./assistant-composer";
import { AssistantTranscript } from "./assistant-transcript";

const PENDING_RESTORE_ID = "assistant:pending-restore";

export function AssistantWidget({ identity }: { identity: AssistantIdentity }) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const locale = useLocale();
  const {
    brandKeys,
    card,
    cardTruncated,
    clearCard,
    focusToken,
    open,
    setOpen,
    sheetCardRef,
  } = useAssistant();
  const panelId = useId();
  const storageKey = historyKey(identity.workspaceId, identity.operatorId);
  const restoreKey = useSyncExternalStore(
    subscribeToStoredHistory,
    () => storageKey,
    () => null,
  );
  const restored = restoreKey === null ? [] : readHistory(restoreKey);
  const brandScope = useRef<string | null>(null);

  const transport = new DefaultChatTransport<AssistantUIMessage>({
    api: "/api/chat",
    // History is never retransmitted: only the newest validated turn goes out.
    prepareSendMessagesRequest: ({ body, messages }) => ({
      body: {
        ...body,
        message: latestUserTurn(messages),
        runId: pinnedRunId(),
      },
    }),
  });

  const chat = useChat<AssistantUIMessage>({
    id: restoreKey ?? PENDING_RESTORE_ID,
    messages: restored,
    onData: (part) => {
      if (part.type === "data-usage-settled") {
        signalUsageRefresh();
      }
    },
    onFinish: ({ isAbort, isDisconnect, isError, messages: settled }) => {
      if (isAbort || isDisconnect || isError) {
        return;
      }

      saveHistory(storageKey, settled);
    },
    transport,
  });
  const { messages, setMessages, status, stop } = chat;

  const sweep = useEffectEvent(() => {
    const deadline = expiresAt(storageKey);

    if (deadline !== null && deadline <= Date.now()) {
      clearHistory(storageKey);
      setMessages([]);
    }
  });

  useEffect(() => {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;

    const arm = () => {
      globalThis.clearTimeout(timer);
      const deadline = expiresAt(storageKey);

      if (deadline === null) {
        return;
      }

      timer = globalThis.setTimeout(
        () => {
          sweep();
          arm();
        },
        Math.max(deadline - Date.now(), 0),
      );
    };

    const onWake = () => {
      sweep();
      arm();
    };

    arm();
    globalThis.addEventListener("focus", onWake);
    globalThis.document.addEventListener("visibilitychange", onWake);

    return () => {
      globalThis.clearTimeout(timer);
      globalThis.removeEventListener("focus", onWake);
      globalThis.document.removeEventListener("visibilitychange", onWake);
    };
  }, [storageKey]);

  const pathname = usePathname();
  const lastPathname = useRef(pathname);

  // Stale Card context must never follow the operator to another route. The
  // read lives here because this widget is already inside a Suspense boundary.
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    clearCard();
  }, [pathname, clearCard]);

  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (focusToken > 0) {
      composer.current?.focus();
    }
  }, [focusToken]);

  const busy = status === "submitted" || status === "streaming";

  const send = (text: string) => {
    void chat.sendMessage(
      { text },
      {
        body: {
          brandKeys: brandScope.current ? [brandScope.current] : brandKeys,
          card: sheetCardRef.current ?? card,
          locale,
        },
      },
    );
  };

  const ask = (text: string) => {
    brandScope.current = null;
    send(text);
  };

  const answer = (chosen: AssistantAnswer) => {
    const asked =
      chosen.detail.trim() || latestUserTurn(messages).parts[0]?.text;

    if (asked) {
      brandScope.current = chosen.choiceId;
      send(asked);
    }
  };

  return (
    <>
      {/* Base UI may stamp `data-base-ui-inert` before this streamed slot hydrates,
          leaving an attribute React never rendered. */}
      <Button
        aria-controls={panelId}
        aria-expanded={open}
        className="fixed inset-e-4 bottom-4 z-60 size-11 shadow-lg"
        data-assistant-fab
        data-assistant-surface
        onClick={() => setOpen(!open)}
        size="icon-lg"
        suppressHydrationWarning
      >
        <MessageCircleIcon />
        <span className="sr-only">{t("fab.label")}</span>
      </Button>

      <Dialog
        disablePointerDismissal
        modal={false}
        onOpenChange={setOpen}
        open={open}
      >
        <DialogPortal>
          <DialogPopup
            className="fixed inset-e-4 bottom-20 z-70 flex h-[min(32rem,70svh)] w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 max-sm:**:data-[slot=button]:min-h-11 max-sm:**:data-[slot=button]:min-w-11 max-compact:inset-e-0 max-compact:inset-s-0 max-compact:bottom-0 max-compact:h-[70svh] max-compact:w-auto max-compact:rounded-b-none max-compact:pb-[calc(--spacing(5)+env(safe-area-inset-bottom))]"
            closeLabel={t("panel.close")}
            data-assistant-surface
            id={panelId}
          >
            <div className="grid gap-1">
              <DialogTitle className="text-sm">{t("panel.title")}</DialogTitle>
              <DialogDescription>{t("panel.description")}</DialogDescription>
            </div>

            <AssistantTranscript
              card={card}
              cardTruncated={cardTruncated}
              messages={messages}
              onAnswer={answer}
              onAsk={ask}
              onDismissCard={clearCard}
              status={status}
            />

            <AssistantComposer
              busy={busy}
              onClear={() => {
                clearHistory(storageKey);
                setMessages([]);
              }}
              onSend={ask}
              onStop={() => void stop()}
              ref={composer}
            />
          </DialogPopup>
        </DialogPortal>
      </Dialog>
    </>
  );
}

// Read at send time: a `useSearchParams` subscription would need a Suspense
// boundary and would cost the prerendered shell.
function pinnedRunId() {
  return new URLSearchParams(globalThis.location.search).get("run");
}

function latestUserTurn(messages: readonly AssistantUIMessage[]) {
  const latest = messages.findLast((message) => message.role === "user");

  return {
    id: latest?.id ?? "",
    role: "user" as const,
    parts:
      latest?.parts.flatMap((part) =>
        part.type === "text"
          ? [{ type: "text" as const, text: part.text }]
          : [],
      ) ?? [],
  };
}
