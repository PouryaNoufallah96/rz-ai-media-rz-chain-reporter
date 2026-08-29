"use client";

import {
  assemblePublishPayload,
  type Platform,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import { Spinner } from "@rz-chain-reporter/ui/components/spinner";
import { ChevronDownIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StateMark } from "@/components/common/state-mark";
import { LabeledSelect } from "@/components/form/form-field";
import type { PlatformDraftCard } from "@/features/editorial/schemas/drafts";
import { focusOperation } from "@/features/operations/lib/focus-operation";
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

function usePublishingTicket({
  card,
  disabled,
  effectDisabled,
  onPendingChange,
  savedChangeDisabled,
}: {
  card: PlatformDraftCard;
  disabled: boolean;
  effectDisabled: boolean;
  onPendingChange: (pending: boolean) => void;
  savedChangeDisabled: boolean;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  const active =
    card.revisions.find((revision) => revision.id === card.activeRevisionId) ??
    null;
  const { publishing } = card;
  const timeZone = publishing.timeZone;
  const onSettled = () => onPendingChange(false);
  const save = useAction(saveCardAction, { onSettled });
  const discard = useAction(discardCardAction, { onSettled });
  const restore = useAction(restoreCardAction, { onSettled });
  const approve = useAction(approveAction, { onSettled });
  const direct = useAction(directPublishAction, { onSettled });
  const schedule = useAction(schedulePublicationAction, { onSettled });
  const [destinationAccountId, setDestinationAccountId] = useState(
    () =>
      publishing.destinations.find(
        (destination) => destination.enabled && destination.bound,
      )?.id ?? "",
  );
  const [mode, setMode] = useState<"direct" | "schedule">("direct");
  const [localTime, setLocalTime] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [savedIntent, setSavedIntent] = useState<
    "save" | "discard" | "restore" | null
  >(null);
  const [handoff, setHandoff] = useState<string | null>(null);
  const activeSaved = publishing.savedCard?.discardedAt === null;
  const approved =
    active !== null &&
    publishing.approval?.draftRevisionId === active.id &&
    publishing.approval.selectedFinalMediaAssetId ===
      active.selectedFinalMediaAssetId;
  const destination = publishing.destinations.find(
    (entry) => entry.id === destinationAccountId,
  );
  const destinationReady = Boolean(
    destination?.enabled && destination.bound && !publishing.control.paused,
  );
  const payload = assembledPayload(card.platform, active);
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
  const deliveryState: "available" | "confirmed" | "inProgress" | "recovery" =
    publishing.latestPublication?.lifecycle === "confirmed"
      ? "confirmed"
      : publishing.latestPublication?.lifecycle === "delivery_unknown"
        ? "recovery"
        : deliveryAvailable
          ? "available"
          : "inProgress";
  const scheduleFact =
    mode === "schedule" && scheduledAt
      ? format.dateTime(scheduledAt, {
          dateStyle: "full",
          timeStyle: "long",
          timeZone,
        })
      : t("confirm.immediate");
  const finalReady =
    active !== null &&
    !disabled &&
    !effectDisabled &&
    approved &&
    destinationReady &&
    deliveryAvailable &&
    payload.status === "ready" &&
    (card.platform !== "instagram" ||
      active.selectedFinalMediaAssetId !== null) &&
    (mode === "direct" || validFutureLocalTime(localTime, timeZone));
  const mutationPending = direct.isPending || schedule.isPending;
  const error =
    save.status === "error" ||
    discard.status === "error" ||
    restore.status === "error" ||
    approve.status === "error" ||
    direct.status === "error" ||
    schedule.status === "error";

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
    }
    return settled.status === "error"
      ? { error: t("error.command") }
      : undefined;
  };

  return {
    activeSaved,
    approve,
    approveActive,
    approved,
    confirming,
    confirmEffect,
    confirmSavedChange,
    deliveryState,
    destination,
    destinationAccountId,
    destinationReady,
    discard,
    error,
    finalReady,
    format,
    handoff,
    active,
    localTime,
    mode,
    mutationPending,
    payload,
    publishing,
    requestSavedChange,
    restore,
    save,
    savedIntent,
    scheduledAt,
    scheduleFact,
    setConfirming,
    setDestinationAccountId,
    setLocalTime,
    setMode,
    setSavedIntent,
    t,
    timeZone,
  };
}

export function PublishingTicket({
  card,
  disabled,
  effectDisabled,
  onPendingChange,
  savedChangeDisabled,
}: {
  card: PlatformDraftCard;
  disabled: boolean;
  effectDisabled: boolean;
  onPendingChange: (pending: boolean) => void;
  savedChangeDisabled: boolean;
}) {
  const {
    activeSaved,
    approve,
    approveActive,
    approved,
    confirming,
    confirmEffect,
    confirmSavedChange,
    deliveryState,
    destination,
    destinationAccountId,
    destinationReady,
    discard,
    error,
    finalReady,
    format,
    handoff,
    active,
    localTime,
    mode,
    mutationPending,
    payload,
    publishing,
    requestSavedChange,
    restore,
    save,
    savedIntent,
    scheduledAt,
    scheduleFact,
    setConfirming,
    setDestinationAccountId,
    setLocalTime,
    setMode,
    setSavedIntent,
    t,
    timeZone,
  } = usePublishingTicket({
    card,
    disabled,
    effectDisabled,
    onPendingChange,
    savedChangeDisabled,
  });
  return (
    <section
      aria-labelledby={`publishing-ticket-${card.id}`}
      className="rounded-xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="ticket-label" id={`publishing-ticket-${card.id}`}>
          {t("ticket.title")}
        </h3>
        <PublishingFreshness />
      </div>
      <div className="mt-3 grid gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            className="max-sm:min-h-11"
            disabled={
              disabled ||
              savedChangeDisabled ||
              save.isPending ||
              discard.isPending ||
              restore.isPending
            }
            onClick={requestSavedChange}
            size="sm"
            type="button"
            variant={
              activeSaved || publishing.savedCard ? "outline" : "secondary"
            }
          >
            {save.isPending || discard.isPending || restore.isPending ? (
              <Spinner data-icon="inline-start" label={t("ticket.pending")} />
            ) : null}
            {activeSaved
              ? t("saved.discard")
              : publishing.savedCard
                ? t("saved.restore")
                : t("ticket.saveForLater")}
          </Button>
          <span className="flex items-start gap-2 text-sm">
            <StateMark state={approved ? "succeeded" : "queued"} />
            {approved ? t("approval.approved") : t("approval.unapproved")}
          </span>
          <Button
            disabled={
              disabled ||
              !active ||
              effectDisabled ||
              approved ||
              approve.isPending
            }
            onClick={approveActive}
            size="sm"
            type="button"
          >
            {approve.isPending ? (
              <Spinner data-icon="inline-start" label={t("ticket.pending")} />
            ) : null}
            {active
              ? t("approval.action", { n: active.revisionNumber })
              : t("approval.needsRevision")}
          </Button>
        </div>
        <p className="text-muted-foreground text-xs">
          {savedChangeDisabled
            ? t("ticket.saveBlocked")
            : t("ticket.saveScope")}
        </p>
        {effectDisabled ? (
          <p className="text-sm text-working">
            {t("approval.savedRevisionRequired")}
          </p>
        ) : null}
        <PublishingReadiness
          control={publishing.control}
          deliveryState={deliveryState}
          destinationReady={destinationReady}
          hasSelectedMedia={Boolean(active?.selectedFinalMediaAssetId)}
          payload={payload}
          platform={card.platform}
        />
        <LabeledSelect
          disabled={disabled || publishing.control.paused}
          id={`publishing-destination-${card.id}`}
          label={t("destination.label")}
          onValueChange={(value) => setDestinationAccountId(value ?? "")}
          options={publishing.destinations.map((entry) => ({
            disabled:
              !entry.enabled || !entry.bound || publishing.control.paused,
            label: `${entry.label}${!entry.enabled ? ` · ${t("destination.disabled")}` : !entry.bound ? ` · ${t("destination.unbound")}` : ""}`,
            value: entry.id,
          }))}
          triggerClassName="w-full"
          value={destinationAccountId}
        />
        {destination ? null : (
          <p className="text-destructive text-sm">{t("destination.none")}</p>
        )}
        <LabeledSelect
          disabled={disabled}
          id={`publishing-mode-${card.id}`}
          label={t("mode.label")}
          onValueChange={(value) =>
            setMode(value === "schedule" ? "schedule" : "direct")
          }
          options={[
            { label: t("mode.direct"), value: "direct" },
            { label: t("mode.schedule"), value: "schedule" },
          ]}
          value={mode}
        />
        {mode === "schedule" ? (
          <div className="grid gap-1">
            <PublishingDateTimePicker
              disabled={disabled}
              id={`publishing-time-${card.id}`}
              label={t("schedule.time")}
              onValueChange={setLocalTime}
              timeZone={timeZone}
              value={localTime}
            />
            {scheduledAt ? (
              <p className="text-muted-foreground text-xs">
                {format.dateTime(scheduledAt, {
                  dateStyle: "full",
                  timeStyle: "long",
                  timeZone,
                })}
              </p>
            ) : null}
          </div>
        ) : null}
        <Button
          disabled={!finalReady || mutationPending}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {mutationPending ? (
            <Spinner data-icon="inline-start" label={t("ticket.pending")} />
          ) : null}
          {t("confirm.review")}
        </Button>
        {handoff ? <PublishingHandoff operationId={handoff} /> : null}
        {error ? (
          <p className="text-destructive text-sm" role="alert">
            {t("error.command")}
          </p>
        ) : null}
        <PublicationFact card={card} />
        <PublishingMore card={card} destination={destination ?? null} />
      </div>
      <ConfirmDialog
        cancelLabel={t("confirm.cancel")}
        confirmLabel={
          savedIntent === "discard"
            ? t("saved.discard")
            : savedIntent === "restore"
              ? t("saved.restore")
              : t("ticket.saveForLater")
        }
        description={t("saved.confirmDescription")}
        fallbackError={t("error.command")}
        onConfirm={confirmSavedChange}
        onOpenChange={(open) => !open && setSavedIntent(null)}
        open={savedIntent !== null}
        pendingLabel={t("ticket.pending")}
        title={t("saved.confirmTitle")}
      />
      <ConfirmDialog
        cancelLabel={t("confirm.cancel")}
        confirmLabel={
          mode === "direct" ? t("confirm.publish") : t("confirm.schedule")
        }
        description={t("confirm.description", {
          account: destination?.label ?? t("destination.none"),
          delivery: scheduleFact,
          shape: active?.selectedFinalMediaAssetId
            ? t("confirm.mediaShape")
            : t("confirm.textShape"),
          n: active?.revisionNumber ?? 0,
          platform: card.platform,
        })}
        fallbackError={t("error.command")}
        onConfirm={confirmEffect}
        onOpenChange={setConfirming}
        open={confirming}
        pendingLabel={t("ticket.pending")}
        title={t("confirm.title")}
      />
    </section>
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

function PublishingReadiness({
  control,
  deliveryState,
  destinationReady,
  hasSelectedMedia,
  payload,
  platform,
}: {
  control: PlatformDraftCard["publishing"]["control"];
  deliveryState: "available" | "confirmed" | "inProgress" | "recovery";
  destinationReady: boolean;
  hasSelectedMedia: boolean;
  payload: PayloadProof;
  platform: Platform;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3 text-xs/relaxed sm:grid-cols-2">
      <Readiness
        ok={payload.status === "ready"}
        text={t("readiness.payload", {
          method: payload.method,
          n: payload.length,
          maximum: payload.maximum,
        })}
      />
      <Readiness
        ok={platform !== "instagram" || hasSelectedMedia}
        text={
          platform === "instagram"
            ? t("readiness.mediaRequired")
            : t("readiness.mediaOptional")
        }
      />
      <Readiness
        ok={!control.paused}
        text={
          control.environmentForced
            ? t("readiness.environmentPaused")
            : control.paused
              ? t("pause.paused")
              : t("readiness.publishing")
        }
      />
      <Readiness ok={destinationReady} text={t("readiness.destination")} />
      <Readiness
        state={
          deliveryState === "recovery"
            ? "unknown"
            : deliveryState === "inProgress"
              ? "running"
              : "succeeded"
        }
        text={t(`readiness.delivery.${deliveryState}`)}
      />
      {platform === "telegram" &&
      hasSelectedMedia &&
      payload.status === "overflow" ? (
        <p className="text-destructive sm:col-span-2" role="alert">
          {t("readiness.telegramPhotoOverflow")}
        </p>
      ) : null}
    </div>
  );
}

function Readiness({
  ok,
  state,
  text,
}: {
  ok?: boolean;
  state?: "running" | "succeeded" | "unknown";
  text: string;
}) {
  return (
    <span className="flex items-start gap-2">
      <StateMark state={state ?? (ok ? "succeeded" : "failed")} />
      {text}
    </span>
  );
}

function PublicationFact({ card }: { card: PlatformDraftCard }) {
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

function PublishingMore({
  card,
  destination,
}: {
  card: PlatformDraftCard;
  destination: PlatformDraftCard["publishing"]["destinations"][number] | null;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const publication = card.publishing.latestPublication;
  const hasDetails =
    destination !== null ||
    Boolean(
      publication?.confirmedProviderResultId ||
        publication?.checkpointId ||
        publication?.activeOperationId,
    );

  if (!hasDetails) return null;

  return (
    <Collapsible className="rounded-lg border border-border">
      <CollapsibleTrigger
        render={
          <Button className="group w-full justify-between" variant="ghost" />
        }
      >
        {t("ticket.more")}
        <ChevronDownIcon
          className="transition-transform group-data-panel-open:rotate-180"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="p-3 pt-1 data-closed:hidden" keepMounted>
        <dl className="grid gap-3 text-xs">
          {destination ? (
            <div className="grid gap-1">
              <dt className="text-muted-foreground">{t("destination.key")}</dt>
              <dd>
                <Bdi className="font-mono">{destination.key}</Bdi>
              </dd>
            </div>
          ) : null}
          {publication?.confirmedProviderResultId ? (
            <div className="grid gap-1">
              <dt className="text-muted-foreground">
                {t("reconciliation.providerResult")}
              </dt>
              <dd>
                <Bdi className="font-mono">
                  {publication.confirmedProviderResultId}
                </Bdi>
              </dd>
            </div>
          ) : null}
          {publication?.checkpointId && publication.checkpointKind ? (
            <div className="grid gap-1">
              <dt className="text-muted-foreground">
                {t("reconciliation.checkpoint")}
              </dt>
              <dd>
                <Bdi className="font-mono">
                  {publication.checkpointKind} ·{" "}
                  {publication.checkpointReferenceId ??
                    publication.checkpointId}
                </Bdi>
              </dd>
            </div>
          ) : null}
        </dl>
        {publication?.activeOperationId ? (
          <Button
            className="mt-3"
            onClick={() => focusOperation(publication.activeOperationId ?? "")}
            size="xs"
            type="button"
            variant="outline"
          >
            {t("handoff.openOperation")} ·{" "}
            <Bdi className="font-mono">
              {publication.activeOperationId.slice(0, 8)}
            </Bdi>
          </Button>
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

type PayloadProof = {
  status: "ready" | "overflow" | "missing";
  method: string;
  length: number;
  maximum: number;
};

function assembledPayload(
  platform: Platform,
  revision: PlatformDraftCard["revisions"][number] | null,
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
    method: payload.method,
    length: payload.length,
    maximum: payload.maximum,
  };
}
