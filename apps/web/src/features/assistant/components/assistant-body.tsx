"use client";

import type { RefObject } from "react";
import type {
  AssistantMarketResult,
  AssistantPendingMarket,
  AssistantPendingRun,
  AssistantRunResult,
  SignedApprovalEnvelope,
  SignedMarketApprovalEnvelope,
} from "../schemas/approval";
import type { AssistantActiveCard } from "../schemas/chat-request";
import type { AssistantUIMessage } from "../schemas/ui-message";
import type { AssistantAnswer } from "./assistant-ask-user";
import { AssistantComposer } from "./assistant-composer";
import { AssistantTranscript } from "./assistant-transcript";

export function AssistantBody({
  busy,
  card,
  cardTruncated,
  composerRef,
  messages,
  pendingRun,
  pendingMarket,
  onAnswer,
  onAsk,
  onCancelRunTool,
  onClear,
  onDismissCard,
  onEditMarket,
  onEditRun,
  onMarketPrepared,
  onMarketIntent,
  onMarketResult,
  onMarketSuperseded,
  onRunIntent,
  onRunPrepared,
  onRunResult,
  onStop,
  status,
}: {
  busy: boolean;
  card: AssistantActiveCard | null;
  cardTruncated: boolean;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  messages: readonly AssistantUIMessage[];
  pendingRun: AssistantPendingRun | null;
  pendingMarket: AssistantPendingMarket | null;
  onAnswer: (answer: AssistantAnswer) => void;
  onAsk: (text: string) => void;
  onCancelRunTool: (messageId: string, toolCallId: string) => void;
  onClear: () => void;
  onDismissCard: () => void;
  onEditMarket: (messageId: string, toolCallId: string) => void;
  onEditRun: (messageId: string, toolCallId: string) => void;
  onMarketPrepared: (
    messageId: string,
    toolCallId: string,
    envelope: SignedMarketApprovalEnvelope,
  ) => void;
  onMarketIntent: (
    messageId: string,
    toolCallId: string,
    pendingMarket: AssistantPendingMarket,
  ) => void;
  onMarketResult: (
    messageId: string,
    toolCallId: string,
    result: AssistantMarketResult,
  ) => void;
  onMarketSuperseded: (messageId: string, toolCallId: string) => void;
  onRunIntent: (
    messageId: string,
    toolCallId: string,
    pendingRun: AssistantPendingRun,
  ) => void;
  onRunPrepared: (
    messageId: string,
    toolCallId: string,
    envelope: SignedApprovalEnvelope,
    pendingRun: AssistantPendingRun,
  ) => void;
  onRunResult: (
    messageId: string,
    toolCallId: string,
    result: AssistantRunResult,
  ) => void;
  onStop: () => void;
  status: "error" | "ready" | "streaming" | "submitted";
}) {
  return (
    <>
      <AssistantTranscript
        card={card}
        cardTruncated={cardTruncated}
        messages={messages}
        pendingRun={pendingRun}
        pendingMarket={pendingMarket}
        onAnswer={onAnswer}
        onAsk={onAsk}
        onCancelRunTool={onCancelRunTool}
        onDismissCard={onDismissCard}
        onEditMarket={onEditMarket}
        onEditRun={onEditRun}
        onMarketPrepared={onMarketPrepared}
        onMarketIntent={onMarketIntent}
        onMarketResult={onMarketResult}
        onMarketSuperseded={onMarketSuperseded}
        onRunIntent={onRunIntent}
        onRunPrepared={onRunPrepared}
        onRunResult={onRunResult}
        status={status}
      />
      <AssistantComposer
        busy={busy}
        onClear={onClear}
        onSend={onAsk}
        onStop={onStop}
        ref={composerRef}
      />
    </>
  );
}
