"use client";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentTitle,
} from "@rz-chain-reporter/ui/components/attachment";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Bubble, BubbleContent } from "@rz-chain-reporter/ui/components/bubble";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Empty } from "@rz-chain-reporter/ui/components/empty";
import {
  Message,
  MessageContent,
} from "@rz-chain-reporter/ui/components/message";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@rz-chain-reporter/ui/components/message-scroller";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { ASSISTANT_NAMESPACE } from "../constants";
import type { AssistantUIMessage } from "../schemas/assistant-message";
import type { AssistantActiveCard } from "../schemas/chat-request";
import { type AssistantAnswer, AssistantAskUser } from "./assistant-ask-user";

const STARTERS = ["run", "brands", "publish"] as const;

export function AssistantTranscript({
  card,
  cardTruncated,
  messages,
  onAnswer,
  onAsk,
  onDismissCard,
  status,
}: {
  card: AssistantActiveCard | null;
  cardTruncated: boolean;
  messages: readonly AssistantUIMessage[];
  onAnswer: (answer: AssistantAnswer) => void;
  onAsk: (text: string) => void;
  status: "error" | "ready" | "streaming" | "submitted";
  onDismissCard: () => void;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const inFlight = status === "submitted" || status === "streaming";

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {card ? (
        <Attachment>
          <AttachmentContent>
            <AttachmentTitle>
              <Bdi>{card.headline || t("card.untitled")}</Bdi>
            </AttachmentTitle>
            {cardTruncated ? (
              <AttachmentDescription>
                {t("card.truncated")}
              </AttachmentDescription>
            ) : null}
          </AttachmentContent>
          <AttachmentActions>
            <AttachmentAction
              render={
                <Button
                  onClick={onDismissCard}
                  size="icon-xs"
                  variant="ghost"
                />
              }
            >
              <XIcon />
              <span className="sr-only">{t("card.dismiss")}</span>
            </AttachmentAction>
          </AttachmentActions>
        </Attachment>
      ) : null}

      <MessageScrollerProvider>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport>
            {/* The bottom padding keeps the last turn clear of the viewport
                fade and of the scroll-to-latest button. */}
            <MessageScrollerContent className="gap-3 pb-12">
              {messages.length === 0 ? (
                <Empty className="gap-2 p-0">
                  {STARTERS.map((starter) => (
                    <Button
                      key={starter}
                      onClick={() => onAsk(t(`starters.${starter}`))}
                      size="sm"
                      variant="outline"
                    >
                      <Bdi>{t(`starters.${starter}`)}</Bdi>
                    </Button>
                  ))}
                </Empty>
              ) : null}

              {messages.map((message, index) => (
                <MessageScrollerItem key={message.id}>
                  <AssistantTurn
                    message={message}
                    onAnswer={onAnswer}
                    pending={inFlight && index === messages.length - 1}
                  />
                </MessageScrollerItem>
              ))}

              {inFlight ? (
                <MessageScrollerItem>
                  <Spinner className="size-3 text-muted-foreground" />
                </MessageScrollerItem>
              ) : null}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          <MessageScrollerButton label={t("scroller.toLatest")} />
        </MessageScroller>
      </MessageScrollerProvider>

      <p aria-live="polite" className="sr-only">
        {t(`status.${status}`)}
      </p>
    </div>
  );
}

function AssistantTurn({
  message,
  onAnswer,
  pending,
}: {
  message: AssistantUIMessage;
  onAnswer: (answer: AssistantAnswer) => void;
  pending: boolean;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const fromOperator = message.role === "user";
  const align = fromOperator ? "end" : "start";
  const answered = message.parts.some((part) => part.type === "text");
  // A source note names its document, so several excerpts of one document
  // collapse to a single note.
  const citations = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-citation"
        ? ([[part.data.sourceId, part.data]] as const)
        : [],
    ),
  );

  return (
    <Message align={align}>
      <MessageContent className="gap-1.5">
        {answered || fromOperator || pending ? null : (
          <Bubble align={align} variant="muted">
            <BubbleContent>
              <Bdi>{t("fallback")}</Bdi>
            </BubbleContent>
          </Bubble>
        )}

        {message.parts.map((part) =>
          part.type === "text" ? (
            <Bubble
              align={align}
              key={`${message.id}-text`}
              variant={fromOperator ? "default" : "muted"}
            >
              <BubbleContent className="whitespace-pre-wrap">
                <Bdi>{part.text}</Bdi>
              </BubbleContent>
            </Bubble>
          ) : part.type === "tool-ask_user" &&
            part.state === "input-available" ? (
            <AssistantAskUser
              input={part.input}
              key={part.toolCallId}
              onAnswer={onAnswer}
            />
          ) : null,
        )}

        {citations.size > 0 ? (
          <ul className="grid gap-0.5">
            {[...citations].map(([key, citation]) => (
              <li
                className="font-mono text-2xs text-muted-foreground"
                key={key}
              >
                <Bdi lang={citation.locale ?? undefined}>{citation.title}</Bdi>
              </li>
            ))}
          </ul>
        ) : null}
      </MessageContent>
    </Message>
  );
}
