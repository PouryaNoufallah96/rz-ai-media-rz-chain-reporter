"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import { Card } from "@rz-chain-reporter/ui/components/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import { ChevronDownIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";

import {
  StateMark,
  type StateMarkState,
  stateTone,
} from "@/components/common/state-mark";
import { OPERATIONS_NAMESPACE } from "@/features/operations/constants";
import { OPERATION_ERROR_KEYS } from "@/features/operations/lib/panel-state";

import { SHORT_ID_LENGTH, SOURCES_NAMESPACE } from "../constants";
import { partialImportStateOf } from "../lib/import-outcome";
import { MIX_PERCENT_FORMAT, mixPercents } from "../lib/mix-shares";
import type {
  SourceImportCard as ImportCard,
  SourceImportSourceLine,
  SourceImportsView,
} from "../schemas/imports";
import { SourcesFreshness } from "./sources-freshness";

const OUTCOME_MARK: Record<SourceImportSourceLine["outcome"], StateMarkState> =
  {
    pending: "queued",
    succeeded: "succeeded",
    not_modified: "succeeded",
    partial: "partial",
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
    <div className="flex min-w-0 flex-col gap-4 lg:min-h-0 lg:contain-size">
      <section
        aria-labelledby={currentId}
        className="lg:flex lg:max-h-1/2 lg:min-h-0 lg:flex-col lg:only:max-h-none lg:only:flex-1"
      >
        <Card className="gap-0 border p-4 ring-0 sm:p-5 lg:min-h-0 lg:flex-1">
          <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b pb-3">
            <h2 className="ticket-label" id={currentId}>
              {t("import.current")}
            </h2>
            <SourcesFreshness readAt={imports.readAt} />
          </header>
          <div className="lg:scrollbar-gutter-stable lg:min-h-0 lg:overflow-y-auto lg:overscroll-contain lg:px-1">
            {current ? (
              <SourceImportRunCard card={current} />
            ) : (
              <div className="mt-3">
                <p className="text-sm">{t("import.empty.title")}</p>
                <p className="mt-1 text-muted-foreground text-xs">
                  {t("import.empty.hint")}
                </p>
              </div>
            )}
          </div>
        </Card>
      </section>
      {older.length > 0 ? (
        <section
          aria-labelledby={recentId}
          className="lg:flex lg:min-h-0 lg:flex-1 lg:flex-col"
        >
          <Card className="gap-0 border p-4 ring-0 sm:p-5 lg:min-h-0 lg:flex-1">
            <h2
              className="shrink-0 border-b pb-3 font-medium text-sm"
              id={recentId}
            >
              {t("import.recent.title")}
            </h2>
            <ul className="scrollbar-gutter-stable max-h-128 overflow-y-auto overscroll-contain px-1 lg:max-h-none lg:min-h-0 lg:flex-1">
              {older.map((card) => (
                <li
                  className="border-border border-b last:border-b-0"
                  key={card.id}
                >
                  <SourceImportRunCard card={card} />
                </li>
              ))}
            </ul>
            <p className="mt-3 shrink-0 text-muted-foreground text-xs/relaxed">
              {t("import.recent.hint")}
            </p>
          </Card>
        </section>
      ) : null}
    </div>
  );
}

function SourceImportRunCard({ card }: { card: ImportCard }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const state = cardStateOf(card);
  const shortId = card.operationId.slice(0, SHORT_ID_LENGTH);

  return (
    <Collapsible className="py-2">
      <CollapsibleTrigger
        render={<Button variant="ghost" />}
        aria-label={t("import.toggle", { id: shortId })}
        className="group h-auto w-full min-w-0 items-start justify-start gap-3 whitespace-normal p-2 text-start font-normal max-sm:min-h-11"
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
          className="shrink-0 text-muted-foreground text-xs tabular-nums"
          dateTime={card.createdAt.toISOString()}
        >
          {format.dateTime(card.createdAt, { timeStyle: "short" })}
        </time>
        <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <section
          aria-label={t("import.ledger", { id: shortId })}
          className="mt-2 rounded-lg border bg-muted/30 p-3"
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
            <p className="text-muted-foreground text-xs">
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
      </CollapsibleContent>
    </Collapsible>
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
    <li className="border-b py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <StateMark state={OUTCOME_MARK[line.outcome]} />
        <span className="min-w-0 flex-1 truncate text-xs">
          <Bdi>{line.name}</Bdi>
        </span>
        <span className={`text-xs ${lineTone(OUTCOME_MARK[line.outcome])}`}>
          {line.reason
            ? `${t(`outcome.${line.outcome}`)} — ${t(`reason.${line.reason}`)}`
            : t(`outcome.${line.outcome}`)}
        </span>
        {line.settledAt ? (
          <time
            className="text-muted-foreground text-xs tabular-nums"
            dateTime={line.settledAt.toISOString()}
          >
            {format.dateTime(line.settledAt, { timeStyle: "short" })}
          </time>
        ) : null}
      </div>
      {measures.length > 0 ? (
        <p className="ms-6 text-muted-foreground text-xs tabular-nums">
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
  if (state === "partial") {
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
      <span className="text-muted-foreground text-xs tabular-nums">
        {tallies.join(" · ")}
      </span>
      {adapters ? (
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="ticket-label text-muted-foreground">
            {t("import.extract")}
          </span>
          <span className="text-muted-foreground text-xs tabular-nums">
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

function isRunning(card: ImportCard) {
  return card.lifecycle === "running" || card.lifecycle === "settling";
}

function cardStateOf(card: ImportCard): StateMarkState {
  if (card.lifecycle === "settling") return "running";
  if (card.lifecycle !== "succeeded" || !card.partial) return card.lifecycle;

  return partialImportStateOf(card);
}

function lineTone(state: StateMarkState) {
  if (state === "failed") return "text-destructive";
  if (state === "partial") return "text-caution";
  return "text-muted-foreground";
}
