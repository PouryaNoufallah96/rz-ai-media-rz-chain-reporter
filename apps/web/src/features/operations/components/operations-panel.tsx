"use client";

import {
  type AttemptOutcome,
  type ErrorCode,
  type OperationCommandKind,
  operationCommandKind,
} from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
} from "@rz-chain-reporter/ui/components/empty";
import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import { Check, Copy } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { StateMark } from "@/components/common/state-mark";

import { OPERATIONS_NAMESPACE } from "../constants";
import {
  OPERATION_ERROR_KEYS,
  type PanelState,
  panelStateOf,
} from "../lib/panel-state";
import type { OperationSummary } from "../schemas/operation-summary";

const KIND_KEYS = {
  "generation-probe": "kind.generationProbe",
  "media-verification": "kind.mediaVerification",
  other: "kind.operation",
  "scheduled-effect-probe": "kind.scheduledEffect",
  "source-import": "kind.sourceImport",
} as const satisfies Record<OperationCommandKind, string>;

type TimelineEntry = OperationSummary["timeline"][number];

export function OperationsPanel({
  isError,
  isFetching,
  operations,
}: {
  isError: boolean;
  isFetching: boolean;
  operations: OperationSummary[];
}) {
  const t = useTranslations(OPERATIONS_NAMESPACE);

  return (
    <div className="flex flex-col gap-3">
      {operations.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyDescription>
              {isError ? t("errors.internalServerError") : t("panel.empty")}
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul
          aria-busy={isFetching}
          className="flex flex-col transition-opacity aria-busy:opacity-70 motion-reduce:transition-none"
          data-pending={isFetching || undefined}
        >
          {operations.map((operation) => (
            <OperationRow key={operation.id} operation={operation} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OperationRow({ operation }: { operation: OperationSummary }) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const recordId = useId();
  const state = panelStateOf(operation);
  const kind = t(operationKindKey(operation.commandType));
  const exhausted = operation.dispatch?.state === "exhausted";

  return (
    <li className="border-border border-b py-2 last:border-b-0">
      <div className="flex items-start gap-1">
        <button
          aria-controls={recordId}
          aria-expanded={expanded}
          aria-label={t("panel.toggleTimeline", { id: operation.id, kind })}
          className="group flex min-w-0 flex-1 items-start gap-3 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onClick={() => setExpanded((value) => !value)}
          type="button"
        >
          <StateMark dispatchExhausted={exhausted} state={state} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="ticket-label text-muted-foreground">
              {kind} · <Bdi className="font-mono">{shortId(operation.id)}</Bdi>
            </span>
            <span className={stateTone(state)}>
              <OperationStateLabel operation={operation} state={state} />
            </span>
            {state === "failed" ? (
              <FailureMessage code={operation.failureCode} />
            ) : null}
            {state === "unknown" ? (
              <span className="text-muted-foreground text-xs">
                {t("state.unknownExplanation")}
              </span>
            ) : null}
          </span>
          <time
            className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums"
            dateTime={operation.createdAt.toISOString()}
          >
            {format.dateTime(operation.createdAt, { timeStyle: "short" })}
          </time>
          <FoldPointer expanded={expanded} />
        </button>
        {exhausted ? <CopyOperationId id={operation.id} /> : null}
      </div>
      <DispatchCaption operation={operation} />
      {expanded ? (
        <TravelRecord
          id={recordId}
          kind={kind}
          operation={operation}
          state={state}
        />
      ) : null}
    </li>
  );
}

function DispatchCaption({ operation }: { operation: OperationSummary }) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const dispatch = operation.dispatch;

  if (operation.lifecycle !== "queued" || !dispatch) {
    return null;
  }

  if (dispatch.state === "undispatched") {
    return (
      <p className="ps-7 text-muted-foreground text-xs">
        {t("dispatch.awaiting")}
      </p>
    );
  }
  if (dispatch.state === "delayed") {
    return (
      <p className="ps-7 text-working text-xs">
        {t("dispatch.delayed", {
          time: format.dateTime(dispatch.nextAttemptAt, { timeStyle: "short" }),
        })}
      </p>
    );
  }
  if (dispatch.state === "exhausted") {
    return (
      <p className="ps-7 text-destructive text-xs">
        {t("dispatch.exhausted")} ·{" "}
        <Bdi className="font-mono">{operation.id}</Bdi>
      </p>
    );
  }
  return null;
}

function TravelRecord({
  id,
  kind,
  operation,
  state,
}: {
  id: string;
  kind: string;
  operation: OperationSummary;
  state: PanelState;
}) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);

  return (
    <section
      aria-label={t("panel.timelineLabel", { id: operation.id, kind })}
      className="ms-6 mt-2 border-border border-s border-dashed ps-2"
      id={id}
    >
      <ol>
        {operation.timeline.map((entry) => (
          <li
            className="flex items-center gap-2 border-border border-b border-dashed py-1.5 last:border-b-0"
            key={`${entry.sourceId}:${entry.kind}`}
          >
            <StateMark state={timelineStateOf(entry, state)} />
            <span className="min-w-0 flex-1 text-xs">
              <TimelineLabel entry={entry} operation={operation} />
            </span>
            <time
              className="font-mono text-muted-foreground text-xs tabular-nums"
              dateTime={entry.at.toISOString()}
            >
              {format.dateTime(entry.at, { timeStyle: "short" })}
            </time>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CopyOperationId({ id }: { id: string }) {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Button
      aria-label={t("dispatch.copyId")}
      onClick={copy}
      size="icon-xs"
      title={t("dispatch.copyId")}
      type="button"
      variant="ghost"
    >
      {copied ? <Check /> : <Copy />}
      <span aria-live="polite" className="sr-only">
        {copied ? t("dispatch.copied") : null}
      </span>
    </Button>
  );
}

function FoldPointer({ expanded }: { expanded: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className={`size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${
        expanded ? "rotate-90" : ""
      }`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 16 16"
    >
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

function FailureMessage({ code }: { code: ErrorCode | null }) {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  if (!code) return null;

  return (
    <span className="text-destructive text-xs">
      {t(OPERATION_ERROR_KEYS[code])}
    </span>
  );
}

function OperationStateLabel({
  operation,
  state,
}: {
  operation: OperationSummary;
  state: PanelState;
}) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);

  if (state === "retrying") {
    return t("state.retrying", { n: operation.attemptCount });
  }
  if (state === "waiting") {
    return t("state.waiting", {
      time: format.dateTime(operation.effectiveAt, { timeStyle: "short" }),
    });
  }
  if (operation.sourceImport && operation.lifecycle === "running") {
    return operation.sourceImport.stage === "enriching"
      ? t("stage.enriching", {
          m: format.number(operation.sourceImport.unitsPlanned),
          n: format.number(operation.sourceImport.counts.enriched),
        })
      : t("stage.acquiring");
  }
  if (operation.sourceImport?.partial && operation.lifecycle === "succeeded") {
    return t("state.partial");
  }
  return t(`state.${state}`);
}

function TimelineLabel({
  entry,
  operation,
}: {
  entry: TimelineEntry;
  operation: OperationSummary;
}) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);

  if (entry.kind === "modelCall") {
    return t("timeline.modelCall", {
      slot: t(`timeline.slot.${entry.slot ?? "primary"}`),
    });
  }
  if (entry.kind === "settled" && operation.sourceImport) {
    const { counts } = operation.sourceImport;
    return t("timeline.settledCounts", {
      acquired: format.number(counts.acquired),
      enriched: format.number(counts.enriched),
      failed: format.number(counts.failed),
      ordered: format.number(counts.ordered),
      skipped: format.number(counts.skipped),
    });
  }
  return t(`timeline.${entry.kind}`);
}

function timelineStateOf(
  entry: TimelineEntry,
  settledState: PanelState,
): PanelState {
  if (entry.kind === "received" || entry.kind === "dispatched") {
    return "queued";
  }
  if (entry.kind === "waiting") {
    return "waiting";
  }
  if (entry.kind === "settled") {
    return settledState;
  }
  return outcomeStateOf(entry.outcome) ?? "running";
}

function outcomeStateOf(outcome: AttemptOutcome | null): PanelState | null {
  if (outcome === "succeeded") {
    return "succeeded";
  }
  if (outcome === "ambiguous") {
    return "unknown";
  }
  if (outcome) {
    return "failed";
  }
  return null;
}

function operationKindKey(commandType: string) {
  return KIND_KEYS[operationCommandKind(commandType)];
}

function stateTone(state: PanelState) {
  if (state === "failed") {
    return "text-destructive text-sm";
  }
  if (state === "succeeded") {
    return "text-proof text-sm";
  }
  if (["running", "retrying", "unknown"].includes(state)) {
    return "text-working text-sm";
  }
  return "text-sm";
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export function OperationsPanelSkeleton() {
  return (
    <div aria-busy="true" className="flex flex-col gap-2">
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
      <Skeleton className="h-10 w-full motion-reduce:animate-none" />
    </div>
  );
}
