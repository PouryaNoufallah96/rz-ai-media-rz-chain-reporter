"use client";

import type { OperationLifecycle } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { OPERATION_ERROR_KEYS } from "@/features/operations/lib/panel-state";
import { useAction } from "@/hooks/use-action";

import { cancelAnalysisRunAction } from "../actions/cancel-analysis-run";
import { EDITORIAL_NAMESPACE } from "../constants";
import { useEditorialErrorMessage } from "../hooks/use-editorial-error-message";
import type { RunHead as RunHeadView, RunOption } from "../schemas/workspace";
import { EditorialFreshness } from "./editorial-freshness";
import { RunSelector } from "./run-selector";

const LIFECYCLE_MARK: Record<OperationLifecycle, StateMarkState> = {
  queued: "queued",
  running: "running",
  settling: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  unknown: "unknown",
};

const TERMINAL_LIFECYCLES: readonly OperationLifecycle[] = [
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
];

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;

export function RunHead({
  head,
  readAt,
  runs,
  selectedRunId,
}: {
  head: RunHeadView | null;
  readAt: Date;
  runs: readonly RunOption[];
  selectedRunId: string | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="border border-border p-4">
      <h2 className="ticket-label border-b border-dashed pb-2" id={titleId}>
        {t("run.head.title")}
      </h2>
      {head ? (
        <EditorialFreshness
          analysisRunId={head.id}
          key={head.id}
          lifecycle={head.lifecycle}
          readAt={readAt}
        />
      ) : null}
      <div className="mt-3 grid gap-3">
        <details className="border border-border border-dashed p-2">
          <summary className="min-h-8 cursor-pointer content-center text-muted-foreground text-xs max-sm:min-h-11">
            {t("run.selector.recent")}
          </summary>
          <div className="pt-2">
            <RunSelector
              runs={runs}
              selected={
                selectedRunId === null || head === null
                  ? null
                  : (runs.find((run) => run.id === head.id) ?? {
                      actorName: head.actorName,
                      id: head.id,
                      kind: head.kind,
                      lifecycle: head.lifecycle,
                      mine: head.mine,
                      startedAt: head.startedAt,
                      templateFingerprint: head.templateFingerprint,
                    })
              }
            />
          </div>
        </details>
        {head ? (
          <RunState
            head={head}
            key={head.id}
            readAt={readAt}
            selectedRunId={selectedRunId}
          />
        ) : (
          <Empty className="p-0">
            <EmptyHeader>
              <EmptyTitle>
                {t(
                  selectedRunId === null
                    ? "run.fresh.title"
                    : "run.unavailable.title",
                )}
              </EmptyTitle>
              <EmptyDescription>
                {t(
                  selectedRunId === null
                    ? "run.fresh.hint"
                    : "run.unavailable.hint",
                )}
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </div>
    </section>
  );
}

function RunState({
  head,
  readAt,
  selectedRunId,
}: {
  head: RunHeadView;
  readAt: Date;
  selectedRunId: string | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const format = useFormatter();
  const mark = LIFECYCLE_MARK[head.lifecycle];
  const terminal = TERMINAL_LIFECYCLES.includes(head.lifecycle);
  const tickingNow = useNow({ updateInterval: terminal ? undefined : 1_000 });
  const now = tickingNow.getTime() === 0 ? readAt : tickingNow;
  const elapsed = elapsedClock(
    head.execution.elapsedFrom,
    head.execution.elapsedTo ?? now,
    format.number,
  );

  return (
    <>
      <div className="flex items-start gap-2">
        <StateMark state={mark} />
        <div className="min-w-0 flex-1">
          <p className={stateTone(mark)}>{stateLabel(head, t)}</p>
          {head.progress.partial ? (
            <p className="font-mono text-muted-foreground text-xs tabular-nums">
              {t("state.partial", {
                n: head.progress.units.failed + head.progress.units.cancelled,
              })}
            </p>
          ) : null}
          {head.lifecycle === "failed" && head.failureCode ? (
            <FailureText code={head.failureCode} />
          ) : null}
          {head.progress.lateCancellation ? (
            <p className="text-muted-foreground text-xs">
              {t("run.cancelLate")}
            </p>
          ) : null}
          {head.execution.dispatch === "exhausted" ? (
            <p className="text-destructive text-xs">
              {t("state.dispatchExhausted")}
            </p>
          ) : null}
        </div>
      </div>
      <p className="font-mono text-muted-foreground text-xs tabular-nums">
        {t("run.progress.elapsed", { duration: elapsed })}
        {" · "}
        {t("run.progress.last", {
          when: format.relativeTime(head.execution.lastProgressAt, { now }),
        })}
      </p>
      <RunProgress head={head} />
      {head.templateChanged ? (
        <p className="text-working text-xs">
          {t("run.templateChanged.notice")}
        </p>
      ) : null}
      {head.provenance.semanticStatus === "degraded" ? (
        <p className="text-muted-foreground text-xs">
          {t("semantic.degraded.unavailable")}
        </p>
      ) : null}
      {head.configuration.kind === "news" &&
      head.configuration.telegramOnly &&
      terminal ? (
        <p className="text-muted-foreground text-xs">
          {t("state.telegramOnlyComplete")}
        </p>
      ) : null}
      <p aria-atomic="true" className="text-sm" role="status">
        {announcement(head, selectedRunId, t)}
      </p>
      {terminal ? null : head.cancelRequestedAt ? (
        <p className="font-mono text-muted-foreground text-xs">
          {t("state.cancelRequested")}
        </p>
      ) : (
        <CancelRun analysisRunId={head.id} />
      )}
    </>
  );
}

function CancelRun({ analysisRunId }: { analysisRunId: string }) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const resolveError = useEditorialErrorMessage();
  const action = useAction(cancelAnalysisRunAction);
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        className="justify-self-start max-sm:min-h-11"
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="link"
      >
        {t("run.cancel")}
      </Button>
      <ConfirmDialog
        cancelLabel={t("run.cancelConfirm.dismiss")}
        confirmLabel={t("run.cancelConfirm.confirm")}
        description={t("run.cancelConfirm.body")}
        fallbackError={resolveError(undefined)}
        onConfirm={async () => {
          const result = await action.execute({ analysisRunId });
          return result.status === "error"
            ? { error: resolveError(result.code) }
            : undefined;
        }}
        onOpenChange={setOpen}
        open={open}
        pendingLabel={t("run.cancelConfirm.pending")}
        title={t("run.cancelConfirm.title")}
        variant="destructive"
      />
    </>
  );
}

function FailureText({ code }: { code: keyof typeof OPERATION_ERROR_KEYS }) {
  const t = useTranslations(OPERATIONS_NAMESPACE);

  return (
    <p className="text-destructive text-xs">{t(OPERATION_ERROR_KEYS[code])}</p>
  );
}

function stateLabel(head: RunHeadView, t: Translate) {
  const { progress } = head;

  if (head.execution.stage === "succeeded") {
    return head.kind === "news" && progress.items.inOutputLane === 0
      ? t("state.noCandidates")
      : t("state.succeeded");
  }
  if (head.execution.stage === "models") {
    return t("state.modelsRunning", {
      done:
        progress.units.succeeded +
        progress.units.failed +
        progress.units.cancelled,
      total:
        progress.units.pending +
        progress.units.running +
        progress.units.succeeded +
        progress.units.failed +
        progress.units.cancelled,
    });
  }

  return t(`state.${head.execution.stage}`);
}

function RunProgress({ head }: { head: RunHeadView }) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const facts = [
    ["run.progress.fetched", head.progress.items.fetched],
    ["run.progress.admitted", head.progress.items.admitted],
    ["run.progress.output", head.progress.items.inOutputLane],
  ] as const;

  return (
    <dl className="grid grid-cols-3 border border-border text-center">
      {facts.map(([label, value]) => (
        <div
          className="grid gap-1 border-border border-e p-2 last:border-e-0"
          key={label}
        >
          <dt className="text-muted-foreground text-xs">{t(label)}</dt>
          <dd className="font-mono tabular-nums">{format.number(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function announcement(
  head: RunHeadView,
  selectedRunId: string | null,
  t: Translate,
) {
  if (selectedRunId !== null) {
    return t("run.selector.viewing");
  }

  const degraded =
    head.provenance.semanticStatus === "degraded" &&
    head.provenance.semanticReason
      ? t("semantic.degraded.reason", {
          reason: t(`semantic.reason.${head.provenance.semanticReason}`),
        })
      : null;

  return [runAnnouncement(head, t), degraded].filter(Boolean).join(" ");
}

function runAnnouncement(head: RunHeadView, t: Translate) {
  const { progress } = head;

  switch (head.lifecycle) {
    case "queued":
      return stateLabel(head, t);
    case "running":
    case "settling":
      return stateLabel(head, t);
    case "succeeded":
      if (head.kind === "news" && progress.items.inOutputLane === 0) {
        return t("state.noCandidates");
      }
      return progress.partial
        ? t("run.announce.finishedPartial", {
            n: progress.units.failed + progress.units.cancelled,
          })
        : t("run.announce.finished");
    case "failed":
      return t("run.announce.failed");
    case "cancelled":
      return t("run.announce.cancelled");
    default:
      return null;
  }
}

function elapsedClock(
  from: Date,
  to: Date,
  formatNumber: ReturnType<typeof useFormatter>["number"],
) {
  const elapsedSeconds = Math.max(
    0,
    Math.floor((to.getTime() - from.getTime()) / 1_000),
  );
  const hours = Math.floor(elapsedSeconds / 3_600);
  const minutes = Math.floor((elapsedSeconds % 3_600) / 60);
  const seconds = elapsedSeconds % 60;
  const parts = hours > 0 ? [hours, minutes, seconds] : [minutes, seconds];

  return parts
    .map((part) =>
      formatNumber(part, {
        minimumIntegerDigits: 2,
        useGrouping: false,
      }),
    )
    .join(":");
}

function stateTone(state: StateMarkState) {
  if (state === "failed") return "text-destructive text-sm";
  if (state === "succeeded") return "text-proof-text text-sm";
  if (["running", "retrying", "unknown"].includes(state)) {
    return "text-working text-sm";
  }
  return "text-sm";
}
