"use client";

import {
  assemblePublishPayload,
  type Platform,
} from "@rz-chain-reporter/contracts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@rz-chain-reporter/ui/components/alert";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Field, FieldLegend } from "@rz-chain-reporter/ui/components/field";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { PlatformIcon } from "@/components/common/platform-icon";
import { StateMark } from "@/components/common/state-mark";
import { LabeledSelect } from "@/components/form/form-field";
import type {
  PlatformDraftCard,
  PlatformDraftExactCard,
} from "@/features/editorial/schemas/drafts";
import {
  focusOperation,
  operationCreated,
} from "@/features/operations/lib/focus-operation";
import { useAction } from "@/hooks/use-action";
import { Link } from "@/i18n/navigation";

import {
  approveAction,
  directPublishAction,
  discardCardAction,
  restoreCardAction,
  saveCardAction,
  schedulePublicationAction,
} from "../actions/commands";
import { PUBLISHING_NAMESPACE } from "../constants";
import { validFutureLocalTime, zonedLocalDate } from "../lib/installation-time";
import { PublishingDateTimePicker } from "./publishing-date-time-picker";
import { PublishingFreshness } from "./publishing-freshness";

type PublishingDraftCard = PlatformDraftCard | PlatformDraftExactCard;

function usePublishingTicket({
  card,
  disabled,
  effectDisabled,
  onPendingChange,
  savedChangeDisabled,
}: {
  card: PublishingDraftCard;
  disabled: boolean;
  effectDisabled: boolean;
  onPendingChange: (pending: boolean) => void;
  savedChangeDisabled: boolean;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const { publishing } = card;
  const onSettled = () => onPendingChange(false);
  const save = useAction(saveCardAction, { onSettled });
  const discard = useAction(discardCardAction, { onSettled });
  const restore = useAction(restoreCardAction, { onSettled });
  const approve = useAction(approveAction, { onSettled });
  const direct = useAction(directPublishAction, { onSettled });
  const schedule = useAction(schedulePublicationAction, { onSettled });
  const [destinationAccountId, setDestinationAccountId] = useState(() =>
    defaultDestinationAccountId(publishing),
  );
  const [mode, setMode] = useState<"direct" | "schedule">("direct");
  const [localTime, setLocalTime] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const [savedIntent, setSavedIntent] = useState<
    "save" | "discard" | "restore" | null
  >(null);
  const [handoff, setHandoff] = useState<string | null>(null);
  const facts = getPublishingTicketFacts({
    card,
    destinationAccountId,
    disabled,
    effectDisabled,
    localTime,
    mode,
  });
  const { active, activeSaved, destination, finalReady, timeZone } = facts;
  const mutationPending = hasPendingDelivery(direct, schedule);
  const error = hasPublishingError({
    approve,
    direct,
    discard,
    restore,
    save,
    schedule,
  });

  const confirmSavedChange = async () => {
    const savedCard = publishing.savedCard;
    if (
      disabled ||
      savedChangeDisabled ||
      !savedIntent ||
      (savedIntent !== "save" && !savedCard)
    ) {
      return { error: t("error.command") };
    }
    onPendingChange(true);
    const result =
      savedIntent === "restore" && savedCard
        ? await restore.execute({
            savedCardId: savedCard.id,
            expectedVersion: savedCard.version,
            idempotencyKey: crypto.randomUUID(),
          })
        : savedIntent === "discard" && savedCard
          ? await discard.execute({
              savedCardId: savedCard.id,
              expectedVersion: savedCard.version,
              idempotencyKey: crypto.randomUUID(),
            })
          : await save.execute({
              platformDraftId: card.id,
              idempotencyKey: crypto.randomUUID(),
            });
    return result.status === "error"
      ? { error: t("error.command") }
      : undefined;
  };

  const requestSavedChange = () => {
    if (disabled || savedChangeDisabled) return;
    if (publishing.savedCard?.discardedAt) {
      setSavedIntent("restore");
      return;
    }
    if (activeSaved) {
      setSavedIntent("discard");
      return;
    }
    setSavedIntent("save");
  };

  const approveActive = async () => {
    if (!active || effectDisabled || disabled) return;
    onPendingChange(true);
    await approve.execute({
      draftRevisionId: active.id,
      selectedFinalMediaAssetId: active.selectedFinalMediaAssetId,
      expectedRevisionVersion: card.revisionVersion,
      idempotencyKey: crypto.randomUUID(),
    });
  };

  const requestConfirmation = () => {
    if (!finalReady) {
      setReviewAttempted(true);
      return;
    }
    setReviewAttempted(false);
    setConfirming(true);
  };

  const confirmEffect = async () => {
    if (!finalReady || !publishing.approval || !destination || !active) {
      return { error: t("error.command") };
    }
    const common = {
      approvalId: publishing.approval.id,
      destinationAccountId: destination.id,
      expectedRevisionVersion: card.revisionVersion,
      idempotencyKey: crypto.randomUUID(),
    };
    const scheduledAt = zonedLocalDate(localTime, timeZone);
    if (mode === "schedule" && !scheduledAt) {
      return { error: t("error.command") };
    }
    onPendingChange(true);
    const settled =
      mode === "direct"
        ? await direct.execute(common)
        : await schedule.execute({
            ...common,
            scheduledAt: scheduledAt?.toISOString() ?? "",
          });
    if (settled.status === "success" && settled.data?.operationId) {
      setHandoff(settled.data.operationId);
      if (settled.data.status === "created") {
        operationCreated(settled.data.operationId);
      }
    }
    return settled.status === "error"
      ? { error: t("error.command") }
      : undefined;
  };

  return {
    approve,
    approveActive,
    confirming,
    confirmEffect,
    confirmSavedChange,
    destinationAccountId,
    discard,
    error,
    handoff,
    localTime,
    mode,
    mutationPending,
    publishing,
    requestConfirmation,
    requestSavedChange,
    reviewAttempted,
    restore,
    save,
    savedIntent,
    setConfirming,
    setDestinationAccountId,
    setLocalTime,
    setMode,
    setSavedIntent,
    ...facts,
  };
}

export function PublishingTicket({
  card,
  disabled,
  effectDisabled,
  onPendingChange,
  savedChangeDisabled,
}: {
  card: PublishingDraftCard;
  disabled: boolean;
  effectDisabled: boolean;
  onPendingChange: (pending: boolean) => void;
  savedChangeDisabled: boolean;
}) {
  const ticket = usePublishingTicket({
    card,
    disabled,
    effectDisabled,
    onPendingChange,
    savedChangeDisabled,
  });
  return (
    <section
      aria-labelledby={`publishing-ticket-${card.id}`}
      className="rounded-xl border border-border bg-card p-4 max-sm:**:data-[slot=button]:min-h-11 max-sm:**:data-[slot=input]:min-h-11 max-sm:**:data-[slot=select-trigger]:min-h-11 max-sm:**:data-[slot=button]:min-w-11"
    >
      <PublishingTicketHeader cardId={card.id} />
      <div className="mt-3 grid gap-4">
        <PublishingTicketActions
          disabled={disabled}
          effectDisabled={effectDisabled}
          savedChangeDisabled={savedChangeDisabled}
          ticket={ticket}
        />
        <DestinationControl card={card} disabled={disabled} ticket={ticket} />
        <DeliveryModeControl disabled={disabled} ticket={ticket} />
        <ScheduledTimeControl
          cardId={card.id}
          disabled={disabled}
          ticket={ticket}
        />
        <PublishingReadiness
          effectDisabled={effectDisabled}
          platform={card.platform}
          ticket={ticket}
        />
        <DeliveryNotice
          deliveryState={ticket.deliveryState}
          scheduledAt={ticket.publishing.latestSchedule?.scheduledAt ?? null}
          timeZone={
            ticket.publishing.latestSchedule?.timezone ?? ticket.timeZone
          }
        />
        <PublishingReviewButton disabled={disabled} ticket={ticket} />
        <PublishingTicketFeedback ticket={ticket} />
        <PublicationFact card={card} />
      </div>
      <SavedCardDialog ticket={ticket} />
      <DeliveryConfirmDialog platform={card.platform} ticket={ticket} />
    </section>
  );
}

type PublishingTicketModel = ReturnType<typeof usePublishingTicket>;

function PublishingTicketHeader({ cardId }: { cardId: string }) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="ticket-label" id={`publishing-ticket-${cardId}`}>
        {t("ticket.title")}
      </h3>
      <PublishingFreshness />
    </div>
  );
}

function PublishingTicketActions({
  disabled,
  effectDisabled,
  savedChangeDisabled,
  ticket,
}: {
  disabled: boolean;
  effectDisabled: boolean;
  savedChangeDisabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <SavedCardButton
            disabled={disabled}
            savedChangeDisabled={savedChangeDisabled}
            ticket={ticket}
          />
          <ApprovalButton
            disabled={disabled}
            effectDisabled={effectDisabled}
            ticket={ticket}
          />
        </div>
        <span className="flex shrink-0 items-center gap-2 text-sm">
          <StateMark state={ticket.approved ? "succeeded" : "queued"} />
          {ticket.approved ? t("approval.approved") : t("approval.unapproved")}
        </span>
      </div>
      <p className="text-muted-foreground text-xs">
        {savedChangeDisabled ? t("ticket.saveBlocked") : t("ticket.saveScope")}
      </p>
    </>
  );
}

function SavedCardButton({
  disabled,
  savedChangeDisabled,
  ticket,
}: {
  disabled: boolean;
  savedChangeDisabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const pending = hasPendingSavedCardChange(ticket);
  return (
    <Button
      className="max-sm:min-h-11"
      disabled={disabled || savedChangeDisabled || pending}
      onClick={ticket.requestSavedChange}
      size="sm"
      type="button"
      variant={
        ticket.activeSaved || ticket.publishing.savedCard
          ? "outline"
          : "secondary"
      }
    >
      {pending ? (
        <Spinner data-icon="inline-start" label={t("ticket.pending")} />
      ) : null}
      {ticket.activeSaved
        ? t("saved.discard")
        : ticket.publishing.savedCard
          ? t("saved.restore")
          : t("ticket.saveForLater")}
    </Button>
  );
}

function ApprovalButton({
  disabled,
  effectDisabled,
  ticket,
}: {
  disabled: boolean;
  effectDisabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const enabled = isApprovalEnabled({ disabled, effectDisabled, ticket });
  return (
    <Button
      className={enabled ? "ready-ring" : undefined}
      disabled={!enabled}
      onClick={ticket.approveActive}
      size="sm"
      type="button"
      variant="default"
    >
      {ticket.approve.isPending ? (
        <Spinner data-icon="inline-start" label={t("ticket.pending")} />
      ) : null}
      {ticket.active
        ? t("approval.action", { n: ticket.active.revisionNumber })
        : t("approval.needsRevision")}
    </Button>
  );
}

function DestinationControl({
  card,
  disabled,
  ticket,
}: {
  card: PublishingDraftCard;
  disabled: boolean;
  ticket: PublishingTicketModel;
}) {
  if (ticket.publishing.destinations.length > 1) {
    return (
      <DestinationSelect card={card} disabled={disabled} ticket={ticket} />
    );
  }
  return <ReadonlyDestination card={card} ticket={ticket} />;
}

function DestinationSelect({
  card,
  disabled,
  ticket,
}: {
  card: PublishingDraftCard;
  disabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <LabeledSelect
      disabled={disabled || ticket.publishing.control.paused}
      id={`publishing-destination-${card.id}`}
      label={t("destination.label")}
      onValueChange={(value) => ticket.setDestinationAccountId(value ?? "")}
      options={ticket.publishing.destinations.map((entry) => ({
        disabled:
          !entry.enabled || !entry.bound || ticket.publishing.control.paused,
        label: (
          <span className="flex items-center gap-2">
            <PlatformIcon
              className="size-4 shrink-0"
              platform={card.platform}
            />
            {destinationLabel(entry, t)}
          </span>
        ),
        value: entry.id,
      }))}
      triggerClassName="w-full"
      value={ticket.destinationAccountId}
    />
  );
}

function ReadonlyDestination({
  card,
  ticket,
}: {
  card: PublishingDraftCard;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const destination = ticket.publishing.destinations[0];
  return (
    <dl className="flex min-w-0 items-baseline justify-between gap-4 py-1">
      <dt className="ticket-label shrink-0">{t("destination.label")}</dt>
      <dd className="wrap-anywhere inline-flex min-w-0 items-center gap-1.5 text-end font-medium text-sm">
        <PlatformIcon className="size-3.5 shrink-0" platform={card.platform} />
        <Bdi>
          {destination
            ? destinationLabel(destination, t)
            : t("destination.none")}
        </Bdi>
      </dd>
    </dl>
  );
}

function DeliveryModeControl({
  disabled,
  ticket,
}: {
  disabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <Field className="gap-1.5" disabled={disabled}>
      <FieldLegend className="ticket-label" variant="label">
        {t("mode.label")}
      </FieldLegend>
      <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted/50 p-1">
        <Button
          aria-pressed={ticket.mode === "direct"}
          className="w-full"
          onClick={() => ticket.setMode("direct")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("mode.direct")}
        </Button>
        <Button
          aria-pressed={ticket.mode === "schedule"}
          className="w-full"
          onClick={() => ticket.setMode("schedule")}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("mode.schedule")}
        </Button>
      </div>
    </Field>
  );
}

function ScheduledTimeControl({
  cardId,
  disabled,
  ticket,
}: {
  cardId: string;
  disabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  if (ticket.mode !== "schedule") return null;
  return (
    <div className="grid gap-1">
      <PublishingDateTimePicker
        disabled={disabled}
        id={`publishing-time-${cardId}`}
        label={t("schedule.time")}
        onValueChange={ticket.setLocalTime}
        timeZone={ticket.timeZone}
        value={ticket.localTime}
      />
      {ticket.scheduledAt ? (
        <p className="text-muted-foreground text-xs">
          {format.dateTime(ticket.scheduledAt, {
            dateStyle: "full",
            timeStyle: "long",
            timeZone: ticket.timeZone,
          })}
        </p>
      ) : null}
    </div>
  );
}

function PublishingReadiness({
  effectDisabled,
  platform,
  ticket,
}: {
  effectDisabled: boolean;
  platform: Platform;
  ticket: PublishingTicketModel;
}) {
  if (!ticket.reviewAttempted) return null;
  return (
    <PublishingBlockers
      approved={ticket.approved}
      control={ticket.publishing.control}
      destinationReady={ticket.destinationReady}
      effectDisabled={effectDisabled}
      hasActiveRevision={ticket.active !== null}
      hasSelectedMedia={Boolean(ticket.active?.selectedFinalMediaAssetId)}
      payload={ticket.payload}
      platform={platform}
      scheduleReady={ticket.scheduleReady}
    />
  );
}

function PublishingReviewButton({
  disabled,
  ticket,
}: {
  disabled: boolean;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <Button
      disabled={
        disabled ||
        ticket.mutationPending ||
        !ticket.approved ||
        !ticket.deliveryAvailable
      }
      onClick={ticket.requestConfirmation}
      type="button"
    >
      {ticket.mutationPending ? (
        <Spinner data-icon="inline-start" label={t("ticket.pending")} />
      ) : null}
      {t("confirm.review")}
    </Button>
  );
}

function PublishingTicketFeedback({
  ticket,
}: {
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <>
      {ticket.handoff ? (
        <PublishingHandoff operationId={ticket.handoff} />
      ) : null}
      {ticket.error ? (
        <Alert variant="destructive">
          <StateMark state="failed" />
          <AlertDescription>{t("error.command")}</AlertDescription>
        </Alert>
      ) : null}
    </>
  );
}

function SavedCardDialog({ ticket }: { ticket: PublishingTicketModel }) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <ConfirmDialog
      cancelLabel={t("confirm.cancel")}
      confirmLabel={
        ticket.savedIntent === "discard"
          ? t("saved.discard")
          : ticket.savedIntent === "restore"
            ? t("saved.restore")
            : t("ticket.saveForLater")
      }
      description={t("saved.confirmDescription")}
      fallbackError={t("error.command")}
      onConfirm={ticket.confirmSavedChange}
      onOpenChange={(open) => !open && ticket.setSavedIntent(null)}
      open={ticket.savedIntent !== null}
      pendingLabel={t("ticket.pending")}
      title={t("saved.confirmTitle")}
    />
  );
}

function DeliveryConfirmDialog({
  platform,
  ticket,
}: {
  platform: Platform;
  ticket: PublishingTicketModel;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  const scheduleFact =
    ticket.mode === "schedule" && ticket.scheduledAt
      ? format.dateTime(ticket.scheduledAt, {
          dateStyle: "full",
          timeStyle: "long",
          timeZone: ticket.timeZone,
        })
      : t("confirm.immediate");
  return (
    <ConfirmDialog
      cancelLabel={t("confirm.cancel")}
      confirmLabel={
        ticket.mode === "direct" ? t("confirm.publish") : t("confirm.schedule")
      }
      description={t("confirm.description", {
        account: ticket.destination?.label ?? t("destination.none"),
        delivery: scheduleFact,
        shape: ticket.active?.selectedFinalMediaAssetId
          ? t("confirm.mediaShape")
          : t("confirm.textShape"),
        n: ticket.active?.revisionNumber ?? 0,
        platform,
      })}
      fallbackError={t("error.command")}
      onConfirm={ticket.confirmEffect}
      onOpenChange={ticket.setConfirming}
      open={ticket.confirming}
      pendingLabel={t("ticket.pending")}
      title={t("confirm.title")}
    />
  );
}

function PublishingHandoff({ operationId }: { operationId: string }) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="status">
      <StateMark state="queued" />
      {t("handoff.queued")} ·{" "}
      <Button
        onClick={() => focusOperation(operationId)}
        size="xs"
        type="button"
        variant="outline"
      >
        {t("handoff.openOperation")}
      </Button>
    </div>
  );
}

function PublishingBlockers({
  approved,
  control,
  destinationReady,
  effectDisabled,
  hasActiveRevision,
  hasSelectedMedia,
  payload,
  platform,
  scheduleReady,
}: {
  approved: boolean;
  control: PlatformDraftCard["publishing"]["control"];
  destinationReady: boolean;
  effectDisabled: boolean;
  hasActiveRevision: boolean;
  hasSelectedMedia: boolean;
  payload: PayloadProof;
  platform: Platform;
  scheduleReady: boolean;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const { operationalBlockers, validationBlockers } = getPublishingBlockers(
    {
      approved,
      control,
      destinationReady,
      effectDisabled,
      hasActiveRevision,
      hasSelectedMedia,
      payload,
      platform,
      scheduleReady,
    },
    t,
  );
  const blockers = [...validationBlockers, ...operationalBlockers];

  if (blockers.length === 0) return null;

  const destructive = validationBlockers.length > 0;
  return (
    <Alert
      role={destructive ? "alert" : "status"}
      variant={destructive ? "destructive" : "working"}
    >
      <StateMark state={destructive ? "failed" : "unknown"} />
      <AlertTitle>{t("readiness.blockedTitle")}</AlertTitle>
      <AlertDescription>
        <PublishingBlockerList blockers={blockers} />
      </AlertDescription>
    </Alert>
  );
}

function PublishingBlockerList({ blockers }: { blockers: string[] }) {
  if (blockers.length === 1) return blockers[0];
  return (
    <ul className="grid list-disc gap-1 ps-4">
      {blockers.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}

function DeliveryNotice({
  deliveryState,
  scheduledAt,
  timeZone,
}: {
  deliveryState: DeliveryState;
  scheduledAt: Date | null;
  timeZone: string;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  const notice = getDeliveryNotice(
    { deliveryState, scheduledAt, timeZone },
    t,
    format,
  );
  if (!notice) return null;
  return (
    <Alert role="status" variant="working">
      <StateMark state={notice.mark} />
      <AlertTitle>{notice.title}</AlertTitle>
      <AlertDescription>
        {notice.description}{" "}
        <Link
          href={{ pathname: "/schedule", query: { view: notice.deskView } }}
        >
          {t("readiness.openDesk")}
        </Link>
      </AlertDescription>
    </Alert>
  );
}

function PublicationFact({ card }: { card: PublishingDraftCard }) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const publication = card.publishing.latestPublication;
  if (publication?.lifecycle !== "delivery_unknown") return null;
  const revision = card.revisions.find(
    (entry) => entry.id === card.activeRevisionId,
  );
  const destinationAccountId =
    publication.destinationAccountId ??
    card.publishing.latestSchedule?.destinationAccountId ??
    null;
  const destination = card.publishing.destinations.find(
    (entry) => entry.id === destinationAccountId,
  );
  return (
    <div
      className="grid gap-2 rounded-lg border border-working/40 bg-working/10 p-3 text-sm"
      role="status"
    >
      <span className="flex items-start gap-2 font-medium text-working">
        <StateMark state="unknown" />
        {t("reconciliation.ticket")}
      </span>
      <p>
        {t("reconciliation.facts", {
          account: destination?.label ?? t("destination.none"),
          n: revision?.revisionNumber ?? 0,
          platform: card.platform,
        })}
      </p>
      <p className="text-working">
        {t(`lifecycle.${publication.lifecycle}`)} ·{" "}
        {t(`activity.${publication.activityStatus}`)}
      </p>
      <Button
        className="justify-self-start max-sm:min-h-11"
        nativeButton={false}
        render={
          <Link
            href={{ pathname: "/schedule", query: { view: "reconciliation" } }}
          />
        }
        variant="outline"
      >
        {t("reconciliation.openDesk")}
      </Button>
    </div>
  );
}

type DeliveryState =
  | "available"
  | "confirmed"
  | "scheduled"
  | "missed"
  | "inProgress"
  | "recovery";

type PayloadProof = {
  status: "ready" | "overflow" | "missing";
  length: number;
  maximum: number;
};

type Translate = ReturnType<
  typeof useTranslations<typeof PUBLISHING_NAMESPACE>
>;
type PublishingState = PublishingDraftCard["publishing"];
type PublishingRevision = PublishingDraftCard["revisions"][number];
type PublishingDestination = PublishingState["destinations"][number];

function defaultDestinationAccountId(publishing: PublishingState) {
  return (
    publishing.destinations.find(
      (destination) => destination.enabled && destination.bound,
    )?.id ?? ""
  );
}

function getPublishingTicketFacts({
  card,
  destinationAccountId,
  disabled,
  effectDisabled,
  localTime,
  mode,
}: {
  card: PublishingDraftCard;
  destinationAccountId: string;
  disabled: boolean;
  effectDisabled: boolean;
  localTime: string;
  mode: "direct" | "schedule";
}) {
  const { publishing } = card;
  const active =
    card.revisions.find((revision) => revision.id === card.activeRevisionId) ??
    null;
  const activeSaved = publishing.savedCard?.discardedAt === null;
  const approved =
    active !== null &&
    publishing.approval?.draftRevisionId === active.id &&
    publishing.approval.selectedFinalMediaAssetId ===
      active.selectedFinalMediaAssetId;
  const destination = publishing.destinations.find(
    (entry) => entry.id === destinationAccountId,
  );
  const destinationReady = Boolean(destination?.enabled && destination.bound);
  const payload = assembledPayload(card.platform, active);
  const timeZone = publishing.timeZone;
  const scheduledAt =
    mode === "schedule" ? zonedLocalDate(localTime, timeZone) : null;
  const publicationAvailable =
    publishing.latestPublication === null ||
    publishing.latestPublication.lifecycle === "available";
  const scheduleAvailable =
    publishing.latestSchedule === null ||
    ["cancelled", "rescheduled", "completed", "failed"].includes(
      publishing.latestSchedule.lifecycle,
    );
  const deliveryAvailable = publicationAvailable && scheduleAvailable;
  const deliveryState = getDeliveryState(publishing, deliveryAvailable);
  const scheduleReady =
    mode === "direct" || validFutureLocalTime(localTime, timeZone);
  const finalReady =
    active !== null &&
    !disabled &&
    !effectDisabled &&
    approved &&
    destinationReady &&
    !publishing.control.paused &&
    deliveryAvailable &&
    payload.status === "ready" &&
    (card.platform !== "instagram" ||
      active.selectedFinalMediaAssetId !== null) &&
    scheduleReady;

  return {
    active,
    activeSaved,
    approved,
    deliveryAvailable,
    deliveryState,
    destination,
    destinationReady,
    finalReady,
    payload,
    scheduledAt,
    scheduleReady,
    timeZone,
  };
}

function getDeliveryState(
  publishing: PublishingState,
  deliveryAvailable: boolean,
): DeliveryState {
  if (publishing.latestPublication?.lifecycle === "confirmed") {
    return "confirmed";
  }
  if (
    publishing.latestPublication?.lifecycle === "delivery_unknown" ||
    publishing.latestSchedule?.lifecycle === "delivery_unknown"
  ) {
    return "recovery";
  }
  if (publishing.latestSchedule?.lifecycle === "scheduled") return "scheduled";
  if (publishing.latestSchedule?.lifecycle === "missed_requires_confirmation") {
    return "missed";
  }
  return deliveryAvailable ? "available" : "inProgress";
}

function hasPendingDelivery(
  direct: { isPending: boolean },
  schedule: { isPending: boolean },
) {
  return direct.isPending || schedule.isPending;
}

function hasPublishingError(actions: Record<string, { status: string }>) {
  return Object.values(actions).some((action) => action.status === "error");
}

function hasPendingSavedCardChange(ticket: PublishingTicketModel) {
  return (
    ticket.save.isPending ||
    ticket.discard.isPending ||
    ticket.restore.isPending
  );
}

function isApprovalEnabled({
  disabled,
  effectDisabled,
  ticket,
}: {
  disabled: boolean;
  effectDisabled: boolean;
  ticket: PublishingTicketModel;
}) {
  return (
    Boolean(ticket.active) &&
    !disabled &&
    !effectDisabled &&
    !ticket.approved &&
    !ticket.approve.isPending
  );
}

function destinationLabel(entry: PublishingDestination, t: Translate) {
  const status = !entry.enabled
    ? ` · ${t("destination.disabled")}`
    : !entry.bound
      ? ` · ${t("destination.unbound")}`
      : "";
  return `${entry.label}${status}`;
}

function getPublishingBlockers(
  {
    approved,
    control,
    destinationReady,
    effectDisabled,
    hasActiveRevision,
    hasSelectedMedia,
    payload,
    platform,
    scheduleReady,
  }: {
    approved: boolean;
    control: PublishingState["control"];
    destinationReady: boolean;
    effectDisabled: boolean;
    hasActiveRevision: boolean;
    hasSelectedMedia: boolean;
    payload: PayloadProof;
    platform: Platform;
    scheduleReady: boolean;
  },
  t: Translate,
) {
  const validationBlockers = [
    !hasActiveRevision
      ? t("approval.needsRevision")
      : !approved
        ? t("readiness.approvalRequired")
        : null,
    hasActiveRevision && payload.status === "missing"
      ? t("readiness.payloadMissing")
      : null,
    payload.status === "overflow"
      ? platform === "telegram" && hasSelectedMedia
        ? t("readiness.telegramPhotoOverflow")
        : t("readiness.payloadOverflow", {
            maximum: payload.maximum,
            n: payload.length,
          })
      : null,
    platform === "instagram" && !hasSelectedMedia
      ? t("readiness.mediaRequiredAction")
      : null,
    !destinationReady ? t("readiness.destinationUnavailable") : null,
    !scheduleReady ? t("dateTime.invalid") : null,
  ].filter((message): message is string => message !== null);
  const operationalBlockers = [
    effectDisabled ? t("approval.savedRevisionRequired") : null,
    control.paused
      ? control.environmentForced
        ? t("readiness.environmentPaused")
        : t("pause.paused")
      : null,
  ].filter((message): message is string => message !== null);
  return { operationalBlockers, validationBlockers };
}

type DeliveryNoticeContent = {
  description: string;
  deskView: "published" | "scheduled";
  mark: "succeeded" | "waiting" | "unknown" | "running";
  title: string;
};

function getDeliveryNotice(
  {
    deliveryState,
    scheduledAt,
    timeZone,
  }: {
    deliveryState: DeliveryState;
    scheduledAt: Date | null;
    timeZone: string;
  },
  t: Translate,
  format: ReturnType<typeof useFormatter>,
): DeliveryNoticeContent | null {
  switch (deliveryState) {
    case "available":
    case "recovery":
      return null;
    case "confirmed":
      return {
        description: t("readiness.republishRequiresRevision"),
        deskView: "published",
        mark: "succeeded",
        title: t("lifecycle.confirmed"),
      };
    case "scheduled":
      return {
        description: scheduledAt
          ? t("readiness.alreadyScheduled", {
              when: format.dateTime(scheduledAt, {
                dateStyle: "full",
                timeStyle: "long",
                timeZone,
              }),
            })
          : t("readiness.delivery.inProgress"),
        deskView: "scheduled",
        mark: "waiting",
        title: t("lifecycle.scheduled"),
      };
    case "missed":
      return {
        description: t("readiness.missed"),
        deskView: "scheduled",
        mark: "unknown",
        title: t("lifecycle.missed_requires_confirmation"),
      };
    case "inProgress":
      return {
        description: t("readiness.delivery.inProgress"),
        deskView: "scheduled",
        mark: "running",
        title: t("readiness.blockedTitle"),
      };
  }
}

function assembledPayload(
  platform: Platform,
  revision: PublishingRevision | null,
): PayloadProof {
  const payload = assemblePublishPayload({
    contentLocale: revision?.contentLocale ?? "en",
    draft: revision
      ? {
          body: revision.body,
          hashtags: revision.hashtags,
          headline: revision.headline,
        }
      : null,
    hasMedia: Boolean(revision?.selectedFinalMediaAssetId),
    platform,
    source:
      revision?.sourceAttribution && revision.sourceCanonicalUrl
        ? {
            attribution: revision.sourceAttribution,
            canonicalUrl: revision.sourceCanonicalUrl,
          }
        : null,
  });
  return {
    status:
      payload.status === "missing"
        ? "missing"
        : payload.status === "overflow"
          ? "overflow"
          : "ready",
    length: payload.length,
    maximum: payload.maximum,
  };
}
