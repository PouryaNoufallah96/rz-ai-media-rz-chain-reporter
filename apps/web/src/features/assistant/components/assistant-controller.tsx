"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useLocale } from "next-intl";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { signalUsageRefresh } from "@/features/usage/lib/usage-refresh-signal";
import { useCommandHotkey } from "@/hooks/use-command-hotkey";
import { usePathname } from "@/i18n/navigation";

import { type AssistantIdentity, useAssistant } from "../lib/assistant-context";
import {
  clearHistory,
  expiresAt,
  historyKey,
  latestPendingMarket,
  latestPendingRun,
  projectAssistantContext,
  readHistory,
  saveHistory,
  subscribeToStoredHistory,
} from "../lib/local-history";
import type {
  AssistantMarketResult,
  AssistantPendingMarket,
  AssistantPendingRun,
  AssistantRunResult,
  SignedApprovalEnvelope,
  SignedMarketApprovalEnvelope,
} from "../schemas/approval";
import type { AssistantChatRequest } from "../schemas/chat-request";
import type {
  AssistantSuperseded,
  AssistantUIMessage,
} from "../schemas/ui-message";
import type { AssistantAnswer } from "./assistant-ask-user";
import { AssistantBody } from "./assistant-body";
import { AssistantFab } from "./assistant-fab";
import {
  AssistantFloatingPanel,
  type PanelSize,
} from "./assistant-floating-panel";
import {
  useAssistantBodyRoot,
  useAssistantPageHost,
} from "./assistant-page-host";

const PENDING_RESTORE_ID = "assistant:pending-restore";

export function AssistantController({
  identity,
}: {
  identity: AssistantIdentity;
}) {
  const locale = useLocale();
  const {
    brandKeys,
    card,
    cardTruncated,
    clearCard,
    focusToken,
    sheetCardRef,
  } = useAssistant();
  const storageKey = historyKey(identity.workspaceId, identity.operatorId);
  const restoreKey = useSyncExternalStore(
    subscribeToStoredHistory,
    () => storageKey,
    () => null,
  );
  const restored = restoreKey === null ? [] : readHistory(restoreKey);
  const restoredPendingRun = latestPendingRun(restored);
  const restoredPendingMarket = latestPendingMarket(restored);
  const brandScope = useRef<string | null>(null);
  const pendingRunChanged = useRef(false);
  const pendingRunRef = useRef<AssistantPendingRun | null>(restoredPendingRun);
  const [pendingRun, setPendingRunState] = useState<AssistantPendingRun | null>(
    restoredPendingRun,
  );
  const setPendingRun = (next: AssistantPendingRun | null) => {
    pendingRunChanged.current = true;
    pendingRunRef.current = next;
    setPendingRunState(next);
  };
  const pendingMarketChanged = useRef(false);
  const pendingMarketRef = useRef<AssistantPendingMarket | null>(
    restoredPendingMarket,
  );
  const [pendingMarket, setPendingMarketState] =
    useState<AssistantPendingMarket | null>(restoredPendingMarket);
  const setPendingMarket = (next: AssistantPendingMarket | null) => {
    pendingMarketChanged.current = true;
    pendingMarketRef.current = next;
    setPendingMarketState(next);
  };
  const hydratedStorageKey = useRef<string | null>(null);
  useEffect(() => {
    if (restoreKey === null || hydratedStorageKey.current !== null) return;
    hydratedStorageKey.current = restoreKey;
    if (!pendingRunChanged.current) {
      pendingRunRef.current = restoredPendingRun;
      setPendingRunState(restoredPendingRun);
    }
    if (!pendingMarketChanged.current) {
      pendingMarketRef.current = restoredPendingMarket;
      setPendingMarketState(restoredPendingMarket);
    }
  }, [restoreKey, restoredPendingMarket, restoredPendingRun]);
  const bodyRoot = useAssistantBodyRoot();

  const [transport] = useState(
    () =>
      new DefaultChatTransport<AssistantUIMessage>({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...body,
            context: projectAssistantContext(messages),
            marketAnalysisId:
              pinnedMarketAnalysisId() ?? latestMarketAnalysisId(messages),
            message: latestUserTurn(messages),
            runId: pinnedRunId(),
          },
        }),
      }),
  );
  const chat = useChat<AssistantUIMessage>({
    id: restoreKey ?? PENDING_RESTORE_ID,
    messages: restored,
    onData: (part) => {
      if (part.type === "data-usage-settled") signalUsageRefresh();
    },
    onFinish: ({ isAbort, isDisconnect, isError, messages: settled }) => {
      if (!isAbort && !isDisconnect && !isError) {
        saveHistory(storageKey, settled);
      }
    },
    transport,
  });
  const { messages, setMessages, status, stop } = chat;

  const sweep = useEffectEvent(() => {
    const deadline = expiresAt(storageKey);
    if (deadline !== null && deadline <= Date.now()) {
      clearHistory(storageKey);
      setPendingMarket(null);
      setPendingRun(null);
      setMessages([]);
    }
  });

  useEffect(() => {
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const arm = () => {
      globalThis.clearTimeout(timer);
      const deadline = expiresAt(storageKey);
      if (deadline === null) return;
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
  useEffect(() => {
    if (lastPathname.current === pathname) return;
    lastPathname.current = pathname;
    clearCard();
  }, [pathname, clearCard]);

  const composer = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusToken > 0) composer.current?.focus();
  }, [focusToken]);

  const updateMessages = (
    update: (current: readonly AssistantUIMessage[]) => AssistantUIMessage[],
  ) => {
    setMessages((current) => {
      const next = update(current);
      saveHistory(storageKey, next);
      return next;
    });
  };
  const send = (text: string) => {
    void chat.sendMessage(
      { text, metadata: { createdAt: Date.now() } },
      {
        body: {
          brandKeys: brandScope.current ? [brandScope.current] : brandKeys,
          card: sheetCardRef.current ?? card,
          locale,
          pendingRun: pendingRunRef.current,
          pendingMarket: pendingMarketRef.current,
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
  const busy = status === "submitted" || status === "streaming";
  const bodyPortal = bodyRoot
    ? createPortal(
        <AssistantBody
          busy={busy}
          card={card}
          cardTruncated={cardTruncated}
          composerRef={composer}
          messages={messages}
          pendingRun={pendingRun}
          pendingMarket={pendingMarket}
          onAnswer={answer}
          onAsk={ask}
          onCancelRunTool={(messageId, toolCallId) => {
            setPendingRun(null);
            updateMessages((current) =>
              supersedeRunTool(current, messageId, toolCallId, "cancel"),
            );
          }}
          onClear={() => {
            clearHistory(storageKey);
            setPendingMarket(null);
            setPendingRun(null);
            setMessages([]);
          }}
          onDismissCard={clearCard}
          onEditMarket={(messageId, toolCallId) => {
            updateMessages((current) =>
              supersedeMarketTool(current, messageId, toolCallId, "edit"),
            );
            composer.current?.focus();
          }}
          onEditRun={(messageId, toolCallId) => {
            updateMessages((current) =>
              supersedeRunTool(current, messageId, toolCallId, "edit"),
            );
            composer.current?.focus();
          }}
          onMarketPrepared={(messageId, toolCallId, envelope) => {
            updateMessages((current) =>
              addMarketProposal(current, messageId, toolCallId, envelope),
            );
          }}
          onMarketIntent={(messageId, toolCallId, nextPendingMarket) => {
            setPendingMarket(nextPendingMarket);
            updateMessages((current) =>
              addMarketIntent(
                current,
                messageId,
                toolCallId,
                nextPendingMarket,
              ),
            );
          }}
          onMarketResult={(messageId, toolCallId, result) => {
            setPendingMarket(null);
            updateMessages((current) =>
              addMarketResult(current, messageId, toolCallId, result),
            );
          }}
          onMarketSuperseded={(messageId, toolCallId) => {
            setPendingMarket(null);
            updateMessages((current) =>
              supersedeMarketTool(current, messageId, toolCallId, "cancel"),
            );
            composer.current?.focus();
          }}
          onRunIntent={(messageId, toolCallId, nextPendingRun) => {
            setPendingRun(nextPendingRun);
            updateMessages((current) =>
              addRunIntent(current, messageId, toolCallId, nextPendingRun),
            );
          }}
          onRunPrepared={(messageId, toolCallId, envelope, nextPendingRun) => {
            setPendingRun(nextPendingRun);
            updateMessages((current) =>
              addRunProposal(
                addRunIntent(current, messageId, toolCallId, nextPendingRun),
                messageId,
                toolCallId,
                envelope,
              ),
            );
          }}
          onRunResult={(messageId, toolCallId, result) => {
            setPendingRun(null);
            updateMessages((current) =>
              addRunResult(current, messageId, toolCallId, result),
            );
          }}
          onStop={() => void stop()}
          status={status}
        />,
        bodyRoot,
      )
    : null;

  return (
    <AssistantSurface bodyRoot={bodyRoot} busy={busy} composer={composer}>
      {bodyPortal}
    </AssistantSurface>
  );
}

function AssistantSurface({
  bodyRoot,
  busy,
  children,
  composer,
}: {
  bodyRoot: HTMLDivElement | null;
  busy: boolean;
  children: ReactNode;
  composer: RefObject<HTMLTextAreaElement | null>;
}) {
  const { open, setOpen } = useAssistant();
  const panelId = useId();
  const [size, setSize] = useState<PanelSize | null>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const [floatingHost, setFloatingHost] = useState<HTMLDivElement | null>(null);
  const lastBodyFocus = useRef<HTMLElement | null>(null);
  const pageHost = useAssistantPageHost();

  const pathname = usePathname();
  const activePageHost = pathname === "/assistant" ? pageHost : null;
  const floatingAvailable = !activePageHost;

  useCommandHotkey("assistant.toggle", () => setOpen(!open), {
    enabled: floatingAvailable,
  });
  useCommandHotkey("assistant.close", () => setOpen(false), {
    enabled: floatingAvailable && open,
    requireReset: true,
    conflictBehavior: "allow",
  });

  useEffect(() => {
    if (!bodyRoot) return;

    const rememberFocus = (event: FocusEvent) => {
      if (event.target instanceof HTMLElement) {
        lastBodyFocus.current = event.target;
      }
    };

    bodyRoot.addEventListener("focusin", rememberFocus);
    return () => bodyRoot.removeEventListener("focusin", rememberFocus);
  }, [bodyRoot]);

  useEffect(() => {
    const destination = activePageHost ?? (open ? floatingHost : null);
    if (!bodyRoot || !destination) return;

    if (bodyRoot.parentElement !== destination) destination.append(bodyRoot);
    const focusTimer = globalThis.setTimeout(() => {
      lastBodyFocus.current?.focus({ preventScroll: true });
    });
    return () => globalThis.clearTimeout(focusTimer);
  }, [activePageHost, bodyRoot, floatingHost, open]);

  useEffect(
    () => () => {
      bodyRoot?.remove();
    },
    [bodyRoot],
  );

  const floatingChrome =
    floatingAvailable && bodyRoot
      ? createPortal(
          <>
            <AssistantFab
              aria-controls={panelId}
              aria-expanded={open}
              busy={busy}
              onClick={() => setOpen(!open)}
              ref={launcher}
            />
            <AssistantFloatingPanel
              composer={composer}
              launcher={launcher}
              onFloatingHost={setFloatingHost}
              onOpenChange={setOpen}
              onResize={setSize}
              open={open}
              panelId={panelId}
              size={size}
            />
          </>,
          bodyRoot.ownerDocument.body,
        )
      : null;

  return (
    <div className="contents" data-assistant-controller>
      {children}
      {floatingChrome}
    </div>
  );
}

function supersedeRunTool(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  reason: AssistantSuperseded["reason"],
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-run-superseded" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-run-superseded" as const,
              data: { toolCallId, reason },
            },
          ],
        },
  );
}

function addRunIntent(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  pendingRun: AssistantPendingRun,
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-run-intent" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-run-intent" as const,
              data: { ...pendingRun, toolCallId },
            },
          ],
        },
  );
}

function addRunProposal(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  envelope: SignedApprovalEnvelope,
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-run-proposal" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-run-proposal" as const,
              data: { envelope, toolCallId },
            },
          ],
        },
  );
}

function addRunResult(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  result: AssistantRunResult,
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-run-proposal" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-run-result" as const,
              data: { ...result, toolCallId },
            },
          ],
        },
  );
}

function supersedeMarketTool(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  reason: AssistantSuperseded["reason"],
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-market-superseded" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-market-superseded" as const,
              data: { toolCallId, reason },
            },
          ],
        },
  );
}

function addMarketProposal(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  envelope: SignedMarketApprovalEnvelope,
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-market-proposal" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-market-proposal" as const,
              data: { envelope, toolCallId },
            },
          ],
        },
  );
}

function addMarketIntent(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  pendingMarket: AssistantPendingMarket,
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-market-intent" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-market-intent" as const,
              data: { ...pendingMarket, toolCallId },
            },
          ],
        },
  );
}

function addMarketResult(
  messages: readonly AssistantUIMessage[],
  messageId: string,
  toolCallId: string,
  result: AssistantMarketResult,
) {
  return messages.map((message) =>
    message.id !== messageId
      ? message
      : {
          ...message,
          parts: [
            ...message.parts.filter(
              (part) =>
                part.type !== "data-market-proposal" ||
                part.data.toolCallId !== toolCallId,
            ),
            {
              type: "data-market-result" as const,
              data: { ...result, toolCallId },
            },
          ],
        },
  );
}

function pinnedRunId() {
  return new URLSearchParams(globalThis.location.search).get("run");
}

function pinnedMarketAnalysisId() {
  return (
    globalThis.location.pathname.match(
      /\/market-analysis\/([0-9a-f]{8}-[0-9a-f-]{27})(?:\/|$)/iu,
    )?.[1] ?? null
  );
}

function latestMarketAnalysisId(messages: readonly AssistantUIMessage[]) {
  let analysisId: string | null = null;
  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type === "data-market-result") {
        analysisId = part.data.analysisId;
      }
    }
  }
  return analysisId;
}

function latestUserTurn(
  messages: readonly AssistantUIMessage[],
): AssistantChatRequest["message"] {
  const latest = messages.findLast((message) => message.role === "user");
  return {
    id: latest?.id ?? "",
    metadata: latest?.metadata ?? { createdAt: Date.now() },
    role: "user" as const,
    parts:
      latest?.parts.flatMap((part) =>
        part.type === "text"
          ? [{ type: "text" as const, text: part.text }]
          : [],
      ) ?? [],
  };
}
