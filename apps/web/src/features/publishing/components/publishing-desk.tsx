"use client";

import {
  Alert,
  AlertDescription,
} from "@rz-chain-reporter/ui/components/alert";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import type { TableOptions } from "@tanstack/react-table";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StateMark } from "@/components/common/state-mark";
import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import {
  type keysetDataTableFeatures,
  useKeysetDataTable,
} from "@/components/data-table/use-keyset-data-table";
import { LabeledSelect } from "@/components/form/form-field";
import {
  focusOperation,
  operationCreated,
} from "@/features/operations/lib/focus-operation";
import type { KeysetPage } from "@/features/shared/lib/keyset-cursor";
import { useAction } from "@/hooks/use-action";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import {
  attestTelegramPublicationAction,
  pausePublishingAction,
  reconcilePublicationAction,
  recoverMissedPublicationAction,
  reschedulePublicationAction,
  resumePublishingAction,
  retryPublicationAction,
} from "../actions/commands";
import { PUBLISHING_NAMESPACE, PUBLISHING_VIEWS } from "../constants";
import {
  minimumLocalTime,
  validFutureLocalTime,
  zonedLocalDate,
} from "../lib/installation-time";
import { publicationMark } from "../lib/publication-mark";
import {
  type PublishingHistoryRow,
  type PublishingQuery,
  publishingSearchParsers,
} from "../schemas/history";
import { PublishingDateTimePicker } from "./publishing-date-time-picker";
import { PublishingFreshness } from "./publishing-freshness";
import { ScheduledPublicationActions } from "./scheduled-publication-actions";

type DeskIntent =
  | { kind: "pause" }
  | { kind: "resume" }
  | {
      kind: "recover" | "reconcile" | "attestDelivered" | "attestNotDelivered";
      row: PublishingHistoryRow;
    }
  | {
      kind: "retry";
      row: PublishingHistoryRow;
      destinationAccountId: string;
      destinationLabel: string;
    }
  | { kind: "reschedule"; row: PublishingHistoryRow; localTime: string };

export function PublishingDesk({
  control,
  environmentForcedPause,
  installationTimeZone,
  page,
  query,
}: {
  control: { paused: boolean; version: number; pausedAt: Date | null };
  environmentForcedPause: boolean;
  installationTimeZone: string;
  page: KeysetPage<PublishingHistoryRow>;
  query: PublishingQuery;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const format = useFormatter();
  const { isPending, setValues } = useTransitionUrlState(
    publishingSearchParsers,
  );
  const pause = useAction(pausePublishingAction);
  const resume = useAction(resumePublishingAction);
  const recover = useAction(recoverMissedPublicationAction);
  const reschedule = useAction(reschedulePublicationAction);
  const retry = useAction(retryPublicationAction);
  const reconcile = useAction(reconcilePublicationAction);
  const attest = useAction(attestTelegramPublicationAction);
  const [intent, setIntent] = useState<DeskIntent | null>(null);
  const reconciliationOperationId =
    reconcile.status === "success" ? reconcile.data?.operationId : undefined;
  const paused = environmentForcedPause || control.paused;
  const columns: TableOptions<
    typeof keysetDataTableFeatures,
    PublishingHistoryRow
  >["columns"] = [
    {
      accessorKey: "occurredAt",
      header:
        query.view === "scheduled"
          ? t("desk.columns.scheduledTime", {
              timeZone: installationTimeZone,
            })
          : t("desk.columns.recordedTime", {
              timeZone: installationTimeZone,
            }),
      cell: ({ row }) => {
        const occurredAt = new Date(row.original.occurredAt.valueOf());
        return (
          <time
            className="whitespace-nowrap text-xs tabular-nums"
            dateTime={occurredAt.toISOString()}
          >
            {format.dateTime(occurredAt, {
              dateStyle: "short",
              timeStyle: "short",
              timeZone: installationTimeZone,
            })}
          </time>
        );
      },
    },
    {
      id: "destination",
      header: t("desk.columns.destination"),
      cell: ({ row }) => (
        <span className="grid">
          <strong>
            <Bdi>{row.original.destinationLabel}</Bdi>
          </strong>
          <span className="wrap-anywhere font-mono text-muted-foreground text-xs">
            <Bdi>{row.original.destinationKey}</Bdi>
          </span>
        </span>
      ),
    },
    { accessorKey: "platform", header: t("desk.columns.platform") },
    {
      accessorKey: "revisionNumber",
      header: t("desk.columns.revision"),
      cell: ({ row }) =>
        t("saved.revision", { n: row.original.revisionNumber }),
    },
    {
      id: "state",
      header: t("desk.columns.state"),
      cell: ({ row }) => <HistoryState row={row.original} />,
    },
    {
      id: "action",
      header: () => <span className="sr-only">{t("desk.columns.action")}</span>,
      cell: ({ row }) => (
        <RowActions
          installationTimeZone={installationTimeZone}
          onIntent={setIntent}
          row={row.original}
        />
      ),
    },
  ];
  const table = useKeysetDataTable({
    columns,
    data: page.rows,
    getRowId: (row) => row.id,
  });
  const executeIntent = async () => {
    const confirmCommand = async (command: Promise<{ status: string }>) => {
      const result = await command;
      if (result.status !== "success") return { error: t("error.command") };
      return undefined;
    };
    const confirmOperationCommand = async (command: OperationCommand) =>
      (await signalCreatedOperation(command))
        ? undefined
        : { error: t("error.command") };
    if (!intent) return { error: t("error.command") };
    if (intent.kind === "pause" || intent.kind === "resume") {
      const input = {
        expectedVersion: control.version,
        reasonCode: intent.kind === "pause" ? "operator_pause" : null,
        idempotencyKey: crypto.randomUUID(),
      };
      return confirmCommand(
        intent.kind === "pause" ? pause.execute(input) : resume.execute(input),
      );
    }
    const row = intent.row;
    if (intent.kind === "recover" && row.scheduleId) {
      return confirmOperationCommand(
        recover.execute({
          scheduleId: row.scheduleId,
          expectedVersion: row.version,
          destinationAccountId: row.destinationAccountId,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
    if (intent.kind === "reschedule" && row.scheduleId) {
      const scheduledAt = zonedLocalDate(
        intent.localTime,
        installationTimeZone,
      );
      if (!scheduledAt) return { error: t("error.command") };
      return confirmOperationCommand(
        reschedule.execute({
          scheduleId: row.scheduleId,
          expectedVersion: row.version,
          scheduledAt: scheduledAt.toISOString(),
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
    if (intent.kind === "retry") {
      return confirmOperationCommand(
        retry.execute({
          publicationId: row.publicationId,
          expectedVersion: row.publicationVersion,
          destinationAccountId: intent.destinationAccountId,
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
    if (intent.kind === "reconcile" && row.unresolvedAttemptId) {
      const result = await reconcile.execute({
        publicationId: row.publicationId,
        expectedVersion: row.publicationVersion,
        ambiguousAttemptId: row.unresolvedAttemptId,
        idempotencyKey: crypto.randomUUID(),
      });
      if (result.status !== "success" || !result.data) {
        return { error: t("error.command") };
      }
      setIntent(null);
      focusOperation(result.data.operationId);
      return undefined;
    }
    if (
      (intent.kind === "attestDelivered" ||
        intent.kind === "attestNotDelivered") &&
      row.unresolvedAttemptId
    ) {
      return confirmCommand(
        attest.execute({
          publicationId: row.publicationId,
          expectedVersion: row.publicationVersion,
          ambiguousAttemptId: row.unresolvedAttemptId,
          decision:
            intent.kind === "attestDelivered" ? "delivered" : "not_delivered",
          idempotencyKey: crypto.randomUUID(),
        }),
      );
    }
    return { error: t("error.command") };
  };
  const confirmationDescription = (() => {
    if (!intent || intent.kind === "pause" || intent.kind === "resume") {
      return t("desk.confirmDescription");
    }
    const facts = {
      account:
        intent.kind === "retry"
          ? intent.destinationLabel
          : intent.row.destinationLabel,
      n: intent.row.revisionNumber,
      platform: intent.row.platform,
    };
    if (intent.kind !== "reschedule") {
      return t("desk.confirmRecordDescription", facts);
    }
    const scheduledAt = zonedLocalDate(intent.localTime, installationTimeZone);
    return scheduledAt
      ? t("desk.confirmRescheduleDescription", {
          ...facts,
          instant: format.dateTime(scheduledAt, {
            dateStyle: "full",
            timeStyle: "long",
            timeZone: installationTimeZone,
          }),
          timeZone: installationTimeZone,
        })
      : t("desk.confirmRecordDescription", facts);
  })();
  return (
    <section
      className="mt-6 max-sm:**:data-[slot=button]:min-h-11 max-sm:**:data-[slot=input]:min-h-11 max-sm:**:data-[slot=select-trigger]:min-h-11 max-sm:**:data-[slot=button]:min-w-11"
      aria-labelledby="dispatch-ledger-title"
    >
      <PublishingDeskToolbar
        environmentForcedPause={environmentForcedPause}
        onPauseToggle={() => setIntent({ kind: paused ? "resume" : "pause" })}
        onViewChange={(view) =>
          setValues({ view, cursor: null }, { history: "push" })
        }
        paused={paused}
        view={query.view}
      />
      <h2 className="sr-only" id="dispatch-ledger-title">
        {t("desk.ledger")}
      </h2>
      {reconciliationOperationId ? (
        <Alert className="mt-3 flex flex-wrap items-center gap-2" role="none">
          <AlertDescription role="status">
            {t("reconciliation.accepted")}
          </AlertDescription>
          <Button
            onClick={() => focusOperation(reconciliationOperationId)}
            size="xs"
            variant="ghost"
          >
            {t("handoff.openOperation")}
          </Button>
        </Alert>
      ) : null}
      <CoreDataTable
        columnClassNames={{
          occurredAt: "align-top",
          destination: "align-top",
          platform: "align-top",
          revisionNumber: "align-top",
          state: "align-top",
          action: "align-top",
        }}
        isPending={isPending}
        labels={{
          caption: t("desk.caption"),
          empty: t("desk.empty"),
          updating: t("table.updating"),
        }}
        table={table}
      />
      <KeysetPagination
        ariaLabel={t("desk.caption")}
        backToLatestLabel={t("pager.latest")}
        newerLabel={t("pager.newer")}
        olderLabel={t("pager.older")}
        offLatest={page.offLatest}
        newerCursor={page.newerCursor}
        olderCursor={page.olderCursor}
        onCursor={(cursor) => setValues({ cursor })}
      />
      <ConfirmDialog
        cancelLabel={t("confirm.cancel")}
        confirmLabel={intentLabel(intent, t)}
        description={confirmationDescription}
        fallbackError={t("error.command")}
        onConfirm={executeIntent}
        onOpenChange={(open) => !open && setIntent(null)}
        open={intent !== null}
        pendingLabel={t("ticket.pending")}
        title={t("confirm.title")}
      />
    </section>
  );
}

type OperationCommand = Promise<{
  data?: {
    operationId: string;
    status: "created" | "replayed";
  };
  status: string;
}>;

async function signalCreatedOperation(command: OperationCommand) {
  const result = await command;
  if (result.status !== "success" || !result.data) return false;
  if (result.data.status === "created") {
    operationCreated(result.data.operationId);
  }
  return true;
}

function PublishingDeskToolbar({
  environmentForcedPause,
  onPauseToggle,
  onViewChange,
  paused,
  view,
}: {
  environmentForcedPause: boolean;
  onPauseToggle: () => void;
  onViewChange: (view: PublishingQuery["view"]) => void;
  paused: boolean;
  view: PublishingQuery["view"];
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 sm:p-4">
        <Badge className="h-auto gap-2 py-1" variant="outline">
          <StateMark state={paused ? "failed" : "succeeded"} />
          {paused ? t("pause.paused") : t("pause.active")}
        </Badge>
        {environmentForcedPause ? (
          <span className="text-destructive text-xs">
            {t("pause.environment")}
          </span>
        ) : null}
        <Button
          className="ms-auto"
          disabled={environmentForcedPause && paused}
          onClick={onPauseToggle}
          size="sm"
          type="button"
          variant="outline"
        >
          {paused ? t("pause.resume") : t("pause.pause")}
        </Button>
        <PublishingFreshness />
      </div>
      <nav
        aria-label={t("desk.views")}
        className="my-4 flex w-fit max-w-full flex-wrap gap-1 rounded-lg border bg-muted/30 p-1"
      >
        {PUBLISHING_VIEWS.map((candidate) => (
          <Button
            aria-current={view === candidate ? "page" : undefined}
            className="aria-[current=page]:bg-card aria-[current=page]:shadow-xs"
            key={candidate}
            onClick={() => onViewChange(candidate)}
            size="sm"
            type="button"
            variant={view === candidate ? "secondary" : "ghost"}
          >
            {t(`view.${candidate}`)}
          </Button>
        ))}
      </nav>
    </>
  );
}

function RowActions({
  installationTimeZone,
  onIntent,
  row,
}: {
  installationTimeZone: string;
  onIntent: (intent: DeskIntent) => void;
  row: PublishingHistoryRow;
}) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const [localTime, setLocalTime] = useState(() =>
    minimumLocalTime(installationTimeZone),
  );
  const [selectedRetryDestinationId, setSelectedRetryDestinationId] = useState(
    () => row.destinationAccountId,
  );
  const retryDestination =
    row.eligibleDestinations.find(
      (destination) => destination.id === selectedRetryDestinationId,
    ) ??
    row.eligibleDestinations.find(
      (destination) => destination.id === row.destinationAccountId,
    ) ??
    row.eligibleDestinations[0];
  if (row.lifecycle === "scheduled")
    return (
      <ScheduledPublicationActions
        installationTimeZone={installationTimeZone}
        row={row}
      />
    );
  if (row.lifecycle === "missed_requires_confirmation")
    return (
      <div className="grid min-w-52 gap-2 rounded-lg border bg-muted/20 p-3">
        <PublishingDateTimePicker
          label={t("schedule.rescheduleTime")}
          onValueChange={setLocalTime}
          timeZone={installationTimeZone}
          value={localTime}
        />
        <div className="flex flex-wrap gap-1">
          <Button
            onClick={() => onIntent({ kind: "recover", row })}
            size="xs"
            type="button"
          >
            {t("action.publishNow")}
          </Button>
          <Button
            disabled={!validFutureLocalTime(localTime, installationTimeZone)}
            onClick={() => onIntent({ kind: "reschedule", row, localTime })}
            size="xs"
            type="button"
            variant="outline"
          >
            {t("action.reschedule")}
          </Button>
        </div>
      </div>
    );
  if (row.lifecycle === "failed")
    return (
      <div className="grid min-w-52 gap-2 rounded-lg border bg-muted/20 p-3">
        <LabeledSelect
          disabled={row.eligibleDestinations.length === 0}
          label={t("destination.retryLabel")}
          onValueChange={(value) => {
            if (value) setSelectedRetryDestinationId(value);
          }}
          options={row.eligibleDestinations.map((destination) => ({
            label: `${destination.label} · ${destination.key}`,
            value: destination.id,
          }))}
          value={retryDestination?.id ?? null}
        />
        <Button
          disabled={!retryDestination}
          onClick={() => {
            if (!retryDestination) return;
            onIntent({
              kind: "retry",
              row,
              destinationAccountId: retryDestination.id,
              destinationLabel: retryDestination.label,
            });
          }}
          size="xs"
          type="button"
        >
          {t("action.retry")}
        </Button>
      </div>
    );
  if (row.lifecycle === "delivery_unknown") {
    return row.platform === "telegram" ? (
      <div className="flex flex-wrap gap-1">
        <Button
          onClick={() => onIntent({ kind: "attestDelivered", row })}
          size="xs"
          type="button"
        >
          {t("action.attestDelivered")}
        </Button>
        <Button
          onClick={() => onIntent({ kind: "attestNotDelivered", row })}
          size="xs"
          type="button"
          variant="outline"
        >
          {t("action.attestNotDelivered")}
        </Button>
      </div>
    ) : (
      <Button
        disabled={row.platform !== "x" && !row.evidenceCheckpointId}
        onClick={() => onIntent({ kind: "reconcile", row })}
        size="xs"
        type="button"
      >
        {t("action.reconcile")}
      </Button>
    );
  }
  return null;
}

function HistoryState({ row }: { row: PublishingHistoryRow }) {
  const t = useTranslations(PUBLISHING_NAMESPACE);
  const resolved = row.reconciliationDecision
    ? row.platform === "telegram" && row.reconciliationAuthority === "operator"
      ? t(`reconciliation.attested_${row.reconciliationDecision}`)
      : t(`reconciliation.reconciled_${row.reconciliationDecision}`)
    : null;
  return (
    <span className="grid min-w-44 gap-2">
      <span className="flex items-center gap-1">
        <StateMark state={publicationMark(row.lifecycle)} />
        {t(`lifecycle.${row.lifecycle}`)}
      </span>
      {resolved ? (
        <span className="text-proof-text text-xs">{resolved}</span>
      ) : null}
      {row.lifecycle === "delivery_unknown" ? (
        <span className="rounded-md border border-working/25 bg-working/10 p-2 text-working text-xs/relaxed">
          {t("reconciliation.explanation")}
        </span>
      ) : null}
      {row.activityStatus !== "not_due" ? (
        <span
          className={
            row.activityStatus === "failed"
              ? "text-destructive text-xs"
              : "text-muted-foreground text-xs"
          }
        >
          {t(`activity.${row.activityStatus}`)}
        </span>
      ) : null}
      {row.operationId ? (
        <Button
          className="justify-self-start"
          onClick={() => focusOperation(row.operationId ?? "")}
          size="xs"
          type="button"
          variant="ghost"
        >
          {t("handoff.openOperation")} ·{" "}
          <Bdi className="font-mono">{row.operationId.slice(0, 8)}</Bdi>
        </Button>
      ) : null}
      {row.providerResultId ? (
        <span className="wrap-anywhere text-muted-foreground text-xs">
          {t("reconciliation.providerResult")} ·{" "}
          <Bdi className="font-mono">{row.providerResultId}</Bdi>
        </span>
      ) : null}
      {row.evidenceCheckpointId && row.evidenceCheckpointKind ? (
        <span className="wrap-anywhere text-muted-foreground text-xs">
          {t("reconciliation.checkpoint")} ·{" "}
          <Bdi className="font-mono">
            {row.evidenceCheckpointKind} ·{" "}
            {row.evidenceCheckpointId.slice(0, 8)}
          </Bdi>
        </span>
      ) : null}
    </span>
  );
}

function intentLabel(
  intent: DeskIntent | null,
  t: ReturnType<typeof useTranslations>,
) {
  if (!intent) return t("confirm.continue");
  return t(`action.${intent.kind}`);
}
