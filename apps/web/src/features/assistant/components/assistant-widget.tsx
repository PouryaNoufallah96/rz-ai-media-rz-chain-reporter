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
import { useEffect, useId, useRef, useState } from "react";

import { usePathname } from "@/i18n/navigation";

import { ASSISTANT_NAMESPACE } from "../constants";
import {
  type AssistantIdentity,
  useRequiredAssistant,
} from "../lib/assistant-context";
import {
  clearHistory,
  expiresAt,
  historyKey,
  readHistory,
  saveHistory,
} from "../lib/local-history";
import type { AssistantUIMessage } from "../schemas/assistant-message";
import type { AssistantAnswer } from "./assistant-ask-user";
import { AssistantComposer } from "./assistant-composer";
import { AssistantTranscript } from "./assistant-transcript";

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
  } = useRequiredAssistant();
  const panelId = useId();
  const storageKey = historyKey(identity.workspaceId, identity.operatorId);
  const [aborted, setAborted] = useState(false);
  // A chooser answer scopes the brands the next turn is sent with. It replaces
  // the previous scope and is read at send time, so a freshly typed question
  // clears it in the same tick it is sent.
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

  const chat = useChat<AssistantUIMessage>({ transport });
  const { messages, setMessages, status, stop } = chat;

  // `useChat` only reads its initial messages once, so restoring runs here.
  useEffect(() => {
    setMessages(readHistory(storageKey));
  }, [setMessages, storageKey]);

  // An aborted, failed or partial turn stays visible but is never saved and
  // never extends expiry.
  useEffect(() => {
    if (status === "ready" && messages.length > 0 && !aborted) {
      saveHistory(storageKey, messages);
    }

    const dropExpired = () => {
      const deadline = expiresAt(storageKey);

      if (deadline !== null && deadline <= Date.now()) {
        clearHistory(storageKey);
        setMessages([]);
      }
    };

    const deadline = expiresAt(storageKey);
    const timer =
      deadline === null
        ? undefined
        : globalThis.setTimeout(
            dropExpired,
            Math.max(deadline - Date.now(), 0),
          );

    globalThis.addEventListener("focus", dropExpired);
    globalThis.document.addEventListener("visibilitychange", dropExpired);

    return () => {
      globalThis.clearTimeout(timer);
      globalThis.removeEventListener("focus", dropExpired);
      globalThis.document.removeEventListener("visibilitychange", dropExpired);
    };
  }, [aborted, messages, setMessages, status, storageKey]);

  const pathname = usePathname();

  // Stale Card context must never follow the operator to another route. The
  // read lives here because this widget is already inside a Suspense boundary.
  useEffect(() => {
    if (pathname.length === 0) return;
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
    setAborted(false);
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

  // The question the operator typed is never rewritten; only the scope changes.
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
      {/* Base UI stamps `data-base-ui-inert` on every body child outside an open
          popup, so a sheet opened before this streamed slot hydrates leaves the
          button carrying an attribute React never rendered. */}
      <Button
        aria-controls={panelId}
        aria-expanded={open}
        className="fixed inset-e-4 bottom-4 z-60 shadow-lg"
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
            className="fixed inset-e-4 bottom-20 z-70 flex h-[min(32rem,70svh)] w-[min(24rem,calc(100vw-2rem))] flex-col gap-3 max-[600px]:inset-e-0 max-[600px]:inset-s-0 max-[600px]:bottom-0 max-[600px]:h-[70svh] max-[600px]:w-auto max-[600px]:rounded-b-none"
            closeLabel={t("panel.close")}
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
                setAborted(false);
              }}
              onSend={ask}
              onStop={() => {
                setAborted(true);
                void stop();
              }}
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
