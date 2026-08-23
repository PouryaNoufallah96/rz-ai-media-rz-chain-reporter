"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";

import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { OPERATION_ERROR_KEYS } from "@/features/operations/lib/panel-state";

import { refreshSourceReadsAction } from "../actions/refresh-source-reads";
import { SHORT_ID_LENGTH, SOURCES_NAMESPACE } from "../constants";
import { MIX_PERCENT_FORMAT, mixPercents } from "../lib/mix-shares";
import type {
  SourceImportCard as ImportCard,
  SourceImportSourceLine,
  SourceImportsView,
} from "../schemas/imports";

const OUTCOME_MARK: Record<SourceImportSourceLine["outcome"], StateMarkState> =
  {
    pending: "queued",
    succeeded: "succeeded",
    not_modified: "succeeded",
    partial: "failed",
    skipped: "cancelled",
    rejected: "failed",
    blocked: "failed",
    timed_out: "failed",
    failed_retryable: "failed",
    failed_terminal: "failed",
  };

const REST_TALLY_KEYS = ["skipped", "failed"] as const;

export function SourceImportRuns({ imports }: { imports: SourceImportsView }) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const currentId = useId();
  const recentId = useId();
  const [current, ...older] = imports.cards;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby={currentId} className="border border-border p-4">
        <h2 className="ticket-label border-b border-dashed pb-2" id={currentId}>
          {t("import.current")}
        </h2>
        {current ? (
          <>
            <SourceImportRunCard card={current} />
            <RunFreshness
              readAt={imports.readAt}
              running={isRunning(current)}
            />
          </>
        ) : (
          <div className="mt-3">
            <p className="text-sm">{t("import.empty.title")}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {t("import.empty.hint")}
            </p>
          </div>
        )}
      </section>
      {older.length > 0 ? (
        <section
          aria-labelledby={recentId}
          className="border border-border p-4"
        >
          <h2
            className="ticket-label border-b border-dashed pb-2"
            id={recentId}
          >
            {t("import.recent.title")}
          </h2>
          <ul>
            {older.map((card) => (
              <li
                className="border-border border-b last:border-b-0"
                key={card.id}
              >
                <SourceImportRunCard card={card} />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-muted-foreground text-xs">
            {t("import.recent.hint")}
          </p>
        </section>
      ) : null}
    </div>
  );
}

function SourceImportRunCard({ card }: { card: ImportCard }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const ledgerId = useId();
  const state = cardStateOf(card);
  const shortId = card.operationId.slice(0, SHORT_ID_LENGTH);

  return (
    <div className="py-2">
      <button
        aria-controls={ledgerId}
        aria-expanded={expanded}
        aria-label={t("import.toggle", { id: shortId })}
        className="flex w-full min-w-0 items-start gap-3 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <StateMark
          dispatchExhausted={card.dispatch?.state === "exhausted"}
          state={state}
        />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="ticket-label text-muted-foreground">
            <Bdi className="font-mono">{shortId}</Bdi>
          </span>
          <span className={stateTone(state)}>
            <RunStateLabel card={card} state={state} />
          </span>
          <RunCounts card={card} />
          <RunDispatch card={card} />
          {state === "failed" && card.failureCode ? (
            <span className="text-destructive text-xs">
              <FailureText code={card.failureCode} />
            </span>
          ) : null}
        </span>
        <time
          className="shrink-0 font-mono text-muted-foreground text-xs tabular-nums"
          dateTime={card.createdAt.toISOString()}
        >
          {format.dateTime(card.createdAt, { timeStyle: "short" })}
        </time>
      </button>
      {expanded ? (
        <section
          aria-label={t("import.ledger", { id: shortId })}
          className="ms-6 mt-2 border-border border-s border-dashed ps-2"
          id={ledgerId}
        >
          <p className="ticket-label text-muted-foreground">
            {t(
              card.sources.some((line) => line.origin === "telegram_public")
                ? "import.boundsTelegram"
                : "import.bounds",
              {
                hours: card.windowHours,
                ordering: t(`import.ordering.${card.orderingMode}`),
                topN: card.topN,
              },
            )}
          </p>
          {card.orderingMode === "keywords" &&
          card.embeddingModel &&
          card.embeddingDimension ? (
            <p className="font-mono text-muted-foreground text-xs">
              {t("import.provenance", {
                dimension: card.embeddingDimension,
                fingerprint: card.templateFingerprint.slice(0, SHORT_ID_LENGTH),
                model: card.embeddingModel,
              })}
            </p>
          ) : null}
          <ul className="mt-1">
            {card.sources.map((line) => (
              <SourceLine key={line.sourceId} line={line} />
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SourceLine({ line }: { line: SourceImportSourceLine }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const exceptions =
    line.enrichment &&
    (line.enrichment.skipped > 0 ||
      line.enrichment.failed > 0 ||
      line.enrichment.unknown > 0)
      ? t("counts.enrichment", {
          enriched: line.enrichment.enriched,
          failed: line.enrichment.failed,
          skipped: line.enrichment.skipped,
          unknown: line.enrichment.unknown,
        })
      : null;
  const measures = [
    ...(line.fetchedCount > 0 || line.admittedCount > 0
      ? [
          t("counts.pair", {
            admitted: line.admittedCount,
            fetched: line.fetchedCount,
          }),
        ]
      : []),
    ...line.adapterMix.map((bucket) =>
      mixCopy(t, "count", {
        count: bucket.count,
        label: t(`adapter.${bucket.adapter}`),
        reused: bucket.reused,
      }),
    ),
    ...(exceptions ? [exceptions] : []),
  ];

  return (
    <li className="border-border border-b border-dashed py-1.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <StateMark state={OUTCOME_MARK[line.outcome]} />
        <span className="min-w-0 flex-1 truncate text-xs">
          <Bdi>{line.name}</Bdi>
        </span>
        <span
          className={`text-xs ${
            OUTCOME_MARK[line.outcome] === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {line.reason
            ? `${t(`outcome.${line.outcome}`)} — ${t(`reason.${line.reason}`)}`
            : t(`outcome.${line.outcome}`)}
        </span>
        {line.settledAt ? (
          <time
            className="font-mono text-muted-foreground text-xs tabular-nums"
            dateTime={line.settledAt.toISOString()}
          >
            {format.dateTime(line.settledAt, { timeStyle: "short" })}
          </time>
        ) : null}
      </div>
      {measures.length > 0 ? (
        <p className="ms-6 font-mono text-muted-foreground text-xs tabular-nums">
          {measures.join(" · ")}
        </p>
      ) : null}
    </li>
  );
}

function RunStateLabel({
  card,
  state,
}: {
  card: ImportCard;
  state: StateMarkState;
}) {
  const t = useTranslations(SOURCES_NAMESPACE);

  if (isRunning(card)) {
    return card.stage === "enriching"
      ? t("import.stage.enriching", {
          m: card.unitsPlanned,
          n: card.counts.enriched,
        })
      : t("import.stage.acquiring");
  }
  if (card.partial && card.lifecycle === "succeeded") {
    return t("state.partial");
  }
  return t(`state.${state === "failed" ? "failed" : card.lifecycle}`);
}

function RunCounts({ card }: { card: ImportCard }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);

  if (card.lifecycle === "queued") return null;

  const admissionBuckets = card.admissionMix.filter(
    (bucket) => bucket.count > 0,
  );
  const onlyAdmitted =
    admissionBuckets.length === 1 &&
    admissionBuckets[0]?.admission === "admitted";
  const admission = onlyAdmitted
    ? null
    : formatMix(
        admissionBuckets.map((bucket) => ({
          count: bucket.count,
          label: t(`admission.${bucket.admission}`),
        })),
        format,
        t,
      );
  const adapters = formatMix(
    card.adapterMix.map((bucket) => ({
      count: bucket.count,
      label: t(`adapter.${bucket.adapter}`),
      reused: bucket.reused,
    })),
    format,
    t,
  );
  const tallies = [
    t("import.counts.acquired", { n: card.counts.acquired }),
    ...(admission ? [admission] : []),
    ...REST_TALLY_KEYS.flatMap((key) =>
      card.counts[key] > 0
        ? [t(`import.counts.${key}`, { n: card.counts[key] })]
        : [],
    ),
  ];

  return (
    <>
      <span className="font-mono text-muted-foreground text-xs tabular-nums">
        {tallies.join(" · ")}
      </span>
      {adapters ? (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="ticket-label text-muted-foreground">
            {t("import.extract")}
          </span>
          <span className="font-mono text-muted-foreground text-xs tabular-nums">
            {adapters}
          </span>
        </span>
      ) : null}
    </>
  );
}

function formatMix(
  buckets: readonly { count: number; label: string; reused?: number }[],
  format: ReturnType<typeof useFormatter>,
  t: ReturnType<typeof useTranslations<typeof SOURCES_NAMESPACE>>,
) {
  const present = buckets.filter((bucket) => bucket.count > 0);
  const total = present.reduce((sum, bucket) => sum + bucket.count, 0);
  if (total === 0) return null;

  const percents = mixPercents(present.map((bucket) => bucket.count));

  return present
    .map((bucket, index) =>
      mixCopy(t, "bucket", {
        ...bucket,
        percent: format.number(
          (percents[index] ?? 0) / 100,
          MIX_PERCENT_FORMAT,
        ),
      }),
    )
    .join(" · ");
}

function mixCopy(
  t: ReturnType<typeof useTranslations<typeof SOURCES_NAMESPACE>>,
  kind: "bucket" | "count",
  bucket: {
    count: number;
    label: string;
    percent?: string;
    reused?: number;
  },
) {
  const reused = bucket.reused ?? 0;
  const key =
    reused <= 0
      ? (`import.mix.${kind}` as const)
      : reused === bucket.count
        ? (`import.mix.${kind}Reused` as const)
        : (`import.mix.${kind}ReusedPartial` as const);

  return t(key, {
    label: bucket.label,
    n: bucket.count,
    percent: bucket.percent ?? "",
    reused,
  });
}

function RunDispatch({ card }: { card: ImportCard }) {
  const format = useFormatter();
  const t = useTranslations(OPERATIONS_NAMESPACE);

  if (card.lifecycle !== "queued" || !card.dispatch) return null;

  if (card.dispatch.state === "undispatched") {
    return (
      <span className="text-muted-foreground text-xs">
        {t("dispatch.awaiting")}
      </span>
    );
  }
  if (card.dispatch.state === "delayed") {
    return (
      <span className="text-working text-xs">
        {t("dispatch.delayed", {
          time: format.dateTime(card.dispatch.nextAttemptAt, {
            timeStyle: "short",
          }),
        })}
      </span>
    );
  }
  if (card.dispatch.state === "exhausted") {
    return (
      <span className="text-destructive text-xs">
        {t("dispatch.exhausted")}
      </span>
    );
  }
  return null;
}

function FailureText({ code }: { code: keyof typeof OPERATION_ERROR_KEYS }) {
  const t = useTranslations(OPERATIONS_NAMESPACE);
  return t(OPERATION_ERROR_KEYS[code]);
}

function RunFreshness({ readAt, running }: { readAt: Date; running: boolean }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const [isRefreshing, startRefresh] = useTransition();

  if (!running) return null;

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span
        className="font-mono text-muted-foreground text-xs tabular-nums"
        role="status"
      >
        {t("import.asOf", {
          time: format.dateTime(readAt, { timeStyle: "medium" }),
        })}
      </span>
      <Button
        disabled={isRefreshing}
        onClick={() => startRefresh(refreshSourceReadsAction)}
        size="xs"
        type="button"
        variant="outline"
      >
        {isRefreshing ? t("import.refreshing") : t("import.refresh")}
      </Button>
    </div>
  );
}

function isRunning(card: ImportCard) {
  return card.lifecycle === "running" || card.lifecycle === "settling";
}

function cardStateOf(card: ImportCard): StateMarkState {
  if (card.lifecycle === "settling") return "running";
  if (card.lifecycle === "succeeded" && card.partial) return "failed";
  return card.lifecycle;
}

function stateTone(state: StateMarkState) {
  if (state === "failed") return "text-destructive text-sm";
  if (state === "succeeded") return "text-proof text-sm";
  if (["running", "retrying", "unknown"].includes(state)) {
    return "text-working text-sm";
  }
  return "text-sm";
}
