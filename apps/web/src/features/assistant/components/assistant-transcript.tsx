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
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@rz-chain-reporter/ui/components/card";
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
import { ExternalLinkIcon, XIcon } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import type { ReactNode } from "react";

import { Link } from "@/i18n/navigation";

import { ASSISTANT_NAMESPACE } from "../constants";
import type {
  AssistantMarketResult,
  AssistantPendingMarket,
  AssistantPendingRun,
  AssistantRunResult,
  SignedApprovalEnvelope,
  SignedMarketApprovalEnvelope,
} from "../schemas/approval";
import type { AssistantReadResult } from "../schemas/assistant-message";
import type { AssistantActiveCard } from "../schemas/chat-request";
import type { AssistantUIMessage } from "../schemas/ui-message";
import { type AssistantAnswer, AssistantAskUser } from "./assistant-ask-user";
import { MarketToolRenderer } from "./market-tool-renderer";
import { RunToolRenderer } from "./run-tool-renderer";

const STARTERS = ["run", "brands", "publish"] as const;

type ReadFact = AssistantReadResult["facts"][number];
type ReadValueContext = ReadFact["key"] | "itemStatus";

const READ_VALUE_MESSAGES = {
  backend: {
    local: "read.value.backend.local",
    remote: "read.value.backend.remote",
  },
  contentLocale: {
    en: "read.value.contentLocale.en",
    fa: "read.value.contentLocale.fa",
  },
  costAuthority: {
    billed_openrouter: "read.value.costAuthority.billedOpenrouter",
    estimated_openrouter: "read.value.costAuthority.estimatedOpenrouter",
    local: "read.value.costAuthority.local",
    unknown: "read.value.costAuthority.unknown",
  },
  invocation: {
    fallback: "read.value.invocation.fallback",
    primary: "read.value.invocation.primary",
    "retry-1": "read.value.invocation.retry",
  },
  kind: {
    candidate: "read.value.kind.candidate",
    chart: "read.value.kind.chart",
    final: "read.value.kind.final",
    market: "read.value.kind.market",
    news: "read.value.kind.news",
    promo: "read.value.kind.promo",
    revision: "read.value.kind.revision",
    rss: "read.value.kind.rss",
    selection: "read.value.kind.selection",
    telegram: "read.value.kind.telegram",
  },
  outputFormat: {
    landscape: "read.value.outputFormat.landscape",
    none: "read.value.summary.none",
    portrait: "read.value.outputFormat.portrait",
    square: "read.value.outputFormat.square",
    story: "read.value.outputFormat.story",
  },
  period: {
    "1y": "read.value.period.1y",
    "24h": "read.value.period.24h",
    "30d": "read.value.period.30d",
    "7d": "read.value.period.7d",
    "90d": "read.value.period.90d",
    all: "read.value.period.all",
  },
  scale: {
    absolute: "read.value.scale.absolute",
    relative: "read.value.scale.relative",
  },
  stage: {
    chart: "read.value.stage.chart",
    design: "read.value.stage.design",
    final: "read.value.stage.final",
    generate: "read.value.stage.generate",
    market: "read.value.stage.market",
    publish: "read.value.stage.publish",
    story: "read.value.stage.story",
  },
  status: {
    active: "read.value.status.active",
    all: "read.value.status.all",
    approved: "read.value.status.approved",
    available: "read.value.status.available",
    bound: "read.value.status.bound",
    briefing: "read.value.status.briefing",
    bytes_removed: "read.value.status.bytesRemoved",
    cancelled: "read.value.status.cancelled",
    cap_exceeded: "read.value.status.capExceeded",
    completed: "read.value.status.completed",
    confirmed: "read.value.status.confirmed",
    delivery_unknown: "read.value.status.deliveryUnknown",
    disabled: "read.value.status.disabled",
    disabledByTemplate: "read.value.status.disabledByTemplate",
    discarded: "read.value.status.discarded",
    effect_claimed: "read.value.status.effectClaimed",
    enabled: "read.value.status.enabled",
    failed: "read.value.status.failed",
    finalizing: "read.value.status.finalizing",
    generating: "read.value.status.generating",
    in_progress: "read.value.status.inProgress",
    integrity_mismatch: "read.value.status.integrityMismatch",
    local: "read.value.backend.local",
    low_score: "read.value.status.lowScore",
    missed_requires_confirmation:
      "read.value.status.missedRequiresConfirmation",
    no_media_fit: "read.value.status.noMediaFit",
    none: "read.value.summary.none",
    pending: "read.value.status.pending",
    promo: "read.value.kind.promo",
    published: "read.value.status.published",
    queued: "read.value.status.queued",
    ready: "read.value.status.ready",
    reconciliation: "read.value.status.reconciliation",
    reconciliation_required: "read.value.status.reconciliationRequired",
    remote: "read.value.backend.remote",
    reserved: "read.value.status.reserved",
    rescheduled: "read.value.status.rescheduled",
    retired: "read.value.status.retired",
    running: "read.value.status.running",
    scheduled: "read.value.status.scheduled",
    settling: "read.value.status.settling",
    shortlisted: "read.value.status.shortlisted",
    succeeded: "read.value.status.succeeded",
    superseded: "read.value.status.superseded",
    telegram_lane: "read.value.status.telegramLane",
    temporarily_unavailable: "read.value.status.temporarilyUnavailable",
    unbound: "read.value.status.unbound",
    unchecked: "read.value.status.unchecked",
    unknown: "read.value.status.unknown",
    "approval.granted": "read.value.status.approvalGranted",
    "publication.confirmed": "read.value.status.publicationConfirmed",
    "publication.delivery_unknown":
      "read.value.status.publicationDeliveryUnknown",
    "publication.failed": "read.value.status.publicationFailed",
    "publication.reconciled_delivered":
      "read.value.status.publicationReconciledDelivered",
    "publication.reconciled_not_delivered":
      "read.value.status.publicationReconciledNotDelivered",
    "publication.requested": "read.value.status.publicationRequested",
    "publication.telegram_attested_delivered":
      "read.value.status.publicationTelegramAttestedDelivered",
    "publication.telegram_attested_not_delivered":
      "read.value.status.publicationTelegramAttestedNotDelivered",
    "publishing.paused": "read.value.status.publishingPaused",
    "publishing.resumed": "read.value.status.publishingResumed",
    "saved_card.discarded": "read.value.status.savedCardDiscarded",
    "saved_card.restored": "read.value.status.savedCardRestored",
    "saved_card.saved": "read.value.status.savedCardSaved",
    "schedule.cancelled": "read.value.status.scheduleCancelled",
    "schedule.created": "read.value.status.scheduleCreated",
    "schedule.missed": "read.value.status.scheduleMissed",
    "schedule.rescheduled": "read.value.status.scheduleRescheduled",
  },
} as const;

type ReadValueGroup = keyof typeof READ_VALUE_MESSAGES;
type ValueOf<T> = T[keyof T];
type ReadValueMessage = ValueOf<{
  [Group in ReadValueGroup]: ValueOf<(typeof READ_VALUE_MESSAGES)[Group]>;
}>;

const READ_VALUE_GROUP: Partial<Record<ReadValueContext, ReadValueGroup>> = {
  backend: "backend",
  contentLocale: "contentLocale",
  costAuthority: "costAuthority",
  image: "status",
  invocationKey: "invocation",
  itemStatus: "status",
  kind: "kind",
  lifecycle: "status",
  outputFormat: "outputFormat",
  period: "period",
  periods: "period",
  publication: "status",
  scale: "scale",
  scales: "scale",
  schedule: "status",
  stage: "stage",
  status: "status",
};

export function AssistantTranscript({
  card,
  cardTruncated,
  messages,
  pendingRun,
  pendingMarket,
  onAnswer,
  onAsk,
  onCancelRunTool,
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
  status,
}: {
  card: AssistantActiveCard | null;
  cardTruncated: boolean;
  messages: readonly AssistantUIMessage[];
  pendingRun: AssistantPendingRun | null;
  pendingMarket: AssistantPendingMarket | null;
  onAnswer: (answer: AssistantAnswer) => void;
  onAsk: (text: string) => void;
  onCancelRunTool: (messageId: string, toolCallId: string) => void;
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
  status: "error" | "ready" | "streaming" | "submitted";
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

      <MessageScrollerProvider autoScroll>
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label={t("transcript.label")}>
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
                <MessageScrollerItem
                  key={message.id}
                  scrollAnchor={message.role === "user"}
                >
                  <AssistantTurn
                    failed={status === "error" && index === messages.length - 1}
                    live={index === messages.length - 1 && status === "ready"}
                    message={message}
                    pendingRun={pendingRun}
                    pendingMarket={pendingMarket}
                    onAnswer={onAnswer}
                    onCancelRunTool={onCancelRunTool}
                    onEditMarket={onEditMarket}
                    onEditRun={onEditRun}
                    onMarketPrepared={onMarketPrepared}
                    onMarketIntent={onMarketIntent}
                    onMarketResult={onMarketResult}
                    onMarketSuperseded={onMarketSuperseded}
                    onRunIntent={onRunIntent}
                    onRunPrepared={onRunPrepared}
                    onRunResult={onRunResult}
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
  failed,
  live,
  message,
  pendingRun,
  pendingMarket,
  onAnswer,
  onCancelRunTool,
  onEditMarket,
  onEditRun,
  onMarketPrepared,
  onMarketIntent,
  onMarketResult,
  onMarketSuperseded,
  onRunIntent,
  onRunPrepared,
  onRunResult,
  pending,
}: {
  failed: boolean;
  live: boolean;
  message: AssistantUIMessage;
  pendingRun: AssistantPendingRun | null;
  pendingMarket: AssistantPendingMarket | null;
  onAnswer: (answer: AssistantAnswer) => void;
  onCancelRunTool: (messageId: string, toolCallId: string) => void;
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
  pending: boolean;
}) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const fromOperator = message.role === "user";
  const align = fromOperator ? "end" : "start";
  const responseFailed =
    failed ||
    message.parts.some(
      (part) => part.type === "data-response-error" && part.data,
    );
  const answered = message.parts.some(
    (part) => part.type === "text" || part.type.startsWith("tool-"),
  );
  const citations = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-citation"
        ? ([[part.data.sourceId, part.data]] as const)
        : [],
    ),
  );
  const proposals = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-run-proposal"
        ? ([[part.data.toolCallId, part.data.envelope]] as const)
        : [],
    ),
  );
  const runIntents = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-run-intent"
        ? ([[part.data.toolCallId, part.data]] as const)
        : [],
    ),
  );
  const marketProposals = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-market-proposal"
        ? ([[part.data.toolCallId, part.data.envelope]] as const)
        : [],
    ),
  );
  const marketIntents = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-market-intent"
        ? ([[part.data.toolCallId, part.data]] as const)
        : [],
    ),
  );
  const marketResults = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-market-result"
        ? ([[part.data.toolCallId, part.data]] as const)
        : [],
    ),
  );
  const marketSuperseded = new Set(
    message.parts.flatMap((part) =>
      part.type === "data-market-superseded" ? [part.data.toolCallId] : [],
    ),
  );
  const runResults = new Map(
    message.parts.flatMap((part) =>
      part.type === "data-run-result"
        ? ([[part.data.toolCallId, part.data]] as const)
        : [],
    ),
  );
  const superseded = new Set(
    message.parts.flatMap((part) =>
      part.type === "data-run-superseded" ? [part.data.toolCallId] : [],
    ),
  );
  const effectToolCount = message.parts.filter(
    (part) =>
      part.type === "tool-start_run" || part.type === "tool-market_action",
  ).length;
  const multipleEffectTools = effectToolCount > 1;

  return (
    <Message align={align}>
      <MessageContent className="gap-1.5">
        {responseFailed ? (
          <Bubble align={align} variant="muted">
            <BubbleContent>
              <Bdi>{t("status.error")}</Bdi>
            </BubbleContent>
          </Bubble>
        ) : answered || fromOperator || pending ? null : (
          <Bubble align={align} variant="muted">
            <BubbleContent>
              <Bdi>{t("fallback")}</Bdi>
            </BubbleContent>
          </Bubble>
        )}

        {multipleEffectTools ? (
          <Bubble align={align} variant="ghost">
            <BubbleContent>
              <Bdi>{t("deferral.singleAction")}</Bdi>
            </BubbleContent>
          </Bubble>
        ) : null}

        {message.parts.map((part, partIndex) =>
          part.type === "text" && (fromOperator || !responseFailed) ? (
            <Bubble
              align={align}
              key={`${message.id}-text-${partIndex}`}
              variant={fromOperator ? "default" : "ghost"}
            >
              <BubbleContent className="whitespace-pre-wrap">
                <Bdi>
                  {fromOperator ? part.text : linkedAssistantText(part.text)}
                </Bdi>
              </BubbleContent>
            </Bubble>
          ) : part.type === "tool-ask_user" &&
            part.state === "output-available" &&
            live ? (
            <AssistantAskUser
              input={part.output}
              key={part.toolCallId}
              onAnswer={onAnswer}
            />
          ) : part.type === "tool-start_run" && !multipleEffectTools ? (
            <RunToolRenderer
              envelope={proposals.get(part.toolCallId) ?? null}
              invocation={part}
              key={part.toolCallId}
              active={live && !superseded.has(part.toolCallId)}
              onCancel={() => onCancelRunTool(message.id, part.toolCallId)}
              onEdit={() => onEditRun(message.id, part.toolCallId)}
              onIntent={(nextPendingRun) =>
                onRunIntent(message.id, part.toolCallId, nextPendingRun)
              }
              onPrepared={(envelope, nextPendingRun) =>
                onRunPrepared(
                  message.id,
                  part.toolCallId,
                  envelope,
                  nextPendingRun,
                )
              }
              onResult={(result) =>
                onRunResult(message.id, part.toolCallId, result)
              }
              result={runResults.get(part.toolCallId) ?? null}
              pendingRun={pendingRun}
              retainedRun={runIntents.get(part.toolCallId) ?? null}
            />
          ) : part.type === "tool-market_action" && !multipleEffectTools ? (
            <MarketToolRenderer
              active={live && !marketSuperseded.has(part.toolCallId)}
              envelope={marketProposals.get(part.toolCallId) ?? null}
              invocation={part}
              key={part.toolCallId}
              onCancel={() => onMarketSuperseded(message.id, part.toolCallId)}
              onEdit={() => onEditMarket(message.id, part.toolCallId)}
              onPrepared={(envelope) =>
                onMarketPrepared(message.id, part.toolCallId, envelope)
              }
              onIntent={(nextPendingMarket) =>
                onMarketIntent(message.id, part.toolCallId, nextPendingMarket)
              }
              onResult={(result) =>
                onMarketResult(message.id, part.toolCallId, result)
              }
              result={marketResults.get(part.toolCallId) ?? null}
              pendingMarket={pendingMarket}
              retainedMarket={marketIntents.get(part.toolCallId) ?? null}
            />
          ) : part.type === "tool-read_workspace" &&
            part.state === "output-available" ? (
            <AssistantReadCard key={part.toolCallId} result={part.output} />
          ) : null,
        )}

        {citations.size > 0 ? (
          <ul className="grid gap-0.5">
            {[...citations].map(([key, citation]) => (
              <li className="text-2xs text-muted-foreground" key={key}>
                <Bdi lang={citation.locale ?? undefined}>{citation.title}</Bdi>
                {citation.locale ? (
                  <span className="ms-1 uppercase">· {citation.locale}</span>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function AssistantReadCard({ result }: { result: AssistantReadResult }) {
  const t = useTranslations(ASSISTANT_NAMESPACE);
  const format = useFormatter();
  const observedAt = new Date(result.observedAt);

  return (
    <Card data-assistant-read-result size="sm">
      <CardHeader>
        <CardTitle>{t(`read.title.${result.kind}`)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {result.notice === "none" ? null : (
          <p className="text-muted-foreground text-xs">
            {t(`read.notice.${result.notice}`)}
          </p>
        )}

        {result.facts.length > 0 ? (
          <dl className="grid compact:grid-cols-2 gap-x-3 gap-y-1 text-xs">
            {result.facts.map((fact) => (
              <div
                className="grid min-w-0 grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-2"
                key={`${fact.key}:${fact.value}`}
              >
                <dt className="text-muted-foreground">
                  {t(`read.fact.${fact.key}`)}
                </dt>
                <dd className="min-w-0 truncate text-end font-medium tabular-nums">
                  <Bdi>{readFactValue(fact.key, fact.value, t, format)}</Bdi>
                </dd>
              </div>
            ))}
          </dl>
        ) : null}

        {result.items.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border px-3">
            {result.items.map((item, itemIndex) => (
              <li
                className="grid gap-1 py-2 text-xs"
                key={`${item.id}:${itemIndex}`}
              >
                {item.href?.startsWith("/api/media/") ? (
                  <div className="relative h-48 overflow-hidden rounded-md border bg-muted">
                    <Image
                      alt={item.title}
                      className="object-contain"
                      fill
                      loading="lazy"
                      sizes="(max-width: 639px) 100vw, 24rem"
                      src={item.href}
                      unoptimized
                    />
                  </div>
                ) : null}
                <div className="flex min-w-0 items-center gap-2">
                  {item.href ? (
                    item.href.startsWith("/api/media/") ? (
                      <a
                        className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                        href={item.href}
                      >
                        <Bdi>{item.title}</Bdi>
                      </a>
                    ) : (
                      <Link
                        className="min-w-0 truncate font-medium underline-offset-4 hover:underline"
                        href={item.href}
                      >
                        <Bdi>{item.title}</Bdi>
                      </Link>
                    )
                  ) : (
                    <span className="min-w-0 truncate font-medium">
                      <Bdi>{item.title}</Bdi>
                    </span>
                  )}
                  {item.status ? (
                    <span className="ms-auto shrink-0 text-muted-foreground">
                      <Bdi>
                        {readFactValue("itemStatus", item.status, t, format)}
                      </Bdi>
                    </span>
                  ) : null}
                </div>
                {item.occurredAt ? (
                  <time
                    className="text-muted-foreground tabular-nums"
                    dateTime={item.occurredAt}
                  >
                    {format.dateTime(new Date(item.occurredAt), {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                ) : null}
                {item.facts.length > 0 ? (
                  <p className="truncate text-muted-foreground">
                    {item.facts.map((fact, index) => (
                      <span key={`${fact.key}:${fact.value}`}>
                        {index > 0 ? " · " : ""}
                        {t(`read.fact.${fact.key}`)}:{" "}
                        <Bdi>
                          {readFactValue(fact.key, fact.value, t, format)}
                        </Bdi>
                      </span>
                    ))}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
      <CardFooter className="flex flex-wrap justify-between gap-2 border-t pt-3 text-2xs text-muted-foreground">
        <time dateTime={result.observedAt}>
          {t("read.observedAt", {
            date: format.dateTime(observedAt, {
              dateStyle: "medium",
              timeStyle: "short",
            }),
          })}
        </time>
        <Button
          nativeButton={false}
          render={<Link href={result.href} />}
          size="xs"
          variant="ghost"
        >
          {t("read.open")}
          <ExternalLinkIcon />
        </Button>
      </CardFooter>
    </Card>
  );
}

function readFactValue(
  context: ReadValueContext,
  value: string,
  t: ReturnType<typeof useTranslations<typeof ASSISTANT_NAMESPACE>>,
  format: ReturnType<typeof useFormatter>,
) {
  if (context === "marketAnalysis" && value === "true") {
    return t("read.boolean.true");
  }
  if (context === "marketAnalysis" && value === "false") {
    return t("read.boolean.false");
  }
  if (
    (context === "createdAt" ||
      context === "startedAt" ||
      context === "updatedAt") &&
    !Number.isNaN(Date.parse(value))
  ) {
    return format.dateTime(new Date(value), {
      dateStyle: "medium",
      timeStyle: "short",
    });
  }
  if (context === "image" && value.startsWith("selected:")) {
    return `${t("read.value.summary.selected")} · ${value.slice("selected:".length)}`;
  }
  if (context === "approval" && value.startsWith("approved:")) {
    return `${t("read.value.summary.approved")} · ${value.slice("approved:".length)}`;
  }
  if (context === "approval") {
    if (value === "notApproved") return t("read.value.summary.notApproved");
    if (value === "none") return t("read.value.summary.none");
    const stages = value.split(",");
    const presented = stages.map(
      (stage) => translatedReadValue("stage", stage, t) ?? stage,
    );
    return presented.join(", ");
  }
  if (context === "activeRevision" && value === "none") {
    return t("read.value.summary.none");
  }
  if (context === "schedule") {
    if (value === "none") return t("read.value.summary.none");
    const schedule = value.match(/^([^:]+):(.*Z):(.+)$/u);
    if (schedule) {
      const [, status, scheduledAt, timeZone] = schedule;
      if (status && scheduledAt && timeZone) {
        return `${translatedReadValue("status", status, t) ?? status} · ${format.dateTime(
          new Date(scheduledAt),
          {
            dateStyle: "medium",
            timeStyle: "short",
          },
        )} · ${timeZone}`;
      }
    }
  }
  if (context === "periods" || context === "scales") {
    const group = context === "periods" ? "period" : "scale";
    return value
      .split(", ")
      .map((entry) => translatedReadValue(group, entry, t) ?? entry)
      .join(", ");
  }
  const group = READ_VALUE_GROUP[context];
  return group ? (translatedReadValue(group, value, t) ?? value) : value;
}

function translatedReadValue(
  group: ReadValueGroup,
  value: string,
  t: ReturnType<typeof useTranslations<typeof ASSISTANT_NAMESPACE>>,
) {
  const message = (
    READ_VALUE_MESSAGES[group] as Partial<Record<string, ReadValueMessage>>
  )[value];
  return message ? t(message) : null;
}

const OWNER_ROUTE =
  /(\/(?:dashboard|account|saved|schedule|sources|usage|market-analysis|installation)(?:[/?][^\s،؛,.!?)]*)?)/gu;
function linkedAssistantText(text: string) {
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of text.matchAll(OWNER_ROUTE)) {
    const href = match[0];
    parts.push(text.slice(cursor, match.index));
    parts.push(
      <Link
        className="font-medium underline underline-offset-4"
        href={href}
        key={`${href}:${match.index}`}
      >
        {href}
      </Link>,
    );
    cursor = match.index + href.length;
  }
  parts.push(text.slice(cursor));
  return parts;
}
