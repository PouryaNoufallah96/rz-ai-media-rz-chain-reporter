"use client";

import {
  ARTICLE_FETCH_MODES,
  type SourceOrigin,
} from "@rz-chain-reporter/contracts";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { ChevronDownIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useId } from "react";

import { SectionCard } from "@/components/common/section-card";
import { SourceOriginIcon } from "@/components/common/source-origin-icon";
import { StateMark, type StateMarkState } from "@/components/common/state-mark";

import { SOURCE_LIFECYCLES, SOURCES_NAMESPACE } from "../constants";
import { MIX_PERCENT_FORMAT, mixPercents } from "../lib/mix-shares";
import type {
  SourceCatalogEntry,
  SourceCatalog as SourceCatalogView,
  SourceObservation,
} from "../schemas/catalog";

const GROUPS: readonly SourceOrigin[] = ["rss", "telegram_public"];

const OBSERVATION_MARK: Record<SourceObservation["outcome"], StateMarkState> = {
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

export function SourceCatalog({ catalog }: { catalog: SourceCatalogView }) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const titleId = useId();

  return (
    <section aria-labelledby={titleId} className="min-w-0">
      <SectionCard
        className="mt-8"
        content="grid"
        contentClassName="gap-6"
        description={t("catalog.hint")}
        title={t("catalog.title")}
        titleId={titleId}
      >
        {catalog.entries.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("catalog.empty")}</p>
        ) : (
          GROUPS.map((origin) => {
            const entries = catalog.entries.filter(
              (entry) => entry.origin === origin,
            );

            return entries.length === 0 ? null : (
              <SourceGroup entries={entries} key={origin} origin={origin} />
            );
          })
        )}
      </SectionCard>
    </section>
  );
}

function SourceGroup({
  entries,
  origin,
}: {
  entries: SourceCatalogEntry[];
  origin: SourceOrigin;
}) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const labelId = useId();
  const ordered = entries.toSorted(
    (a, b) =>
      SOURCE_LIFECYCLES.indexOf(a.lifecycle) -
      SOURCE_LIFECYCLES.indexOf(b.lifecycle),
  );

  return (
    <section aria-labelledby={labelId}>
      <h3 className="flex items-baseline gap-2" id={labelId}>
        <span className="ticket-label inline-flex items-center gap-1.5">
          <SourceOriginIcon className="size-3.5" origin={origin} />
          {t(`catalog.kind.${origin}`)}
        </span>
        <span className="text-muted-foreground text-xs tabular-nums">
          {groupMeta(origin, ordered, format, t)}
        </span>
      </h3>
      <ul className="mt-3 divide-y overflow-hidden rounded-lg border bg-muted/20">
        {ordered.map((entry) => (
          <SourceRow entry={entry} key={entry.id} />
        ))}
      </ul>
    </section>
  );
}

function SourceRow({ entry }: { entry: SourceCatalogEntry }) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const retired = entry.lifecycle === "retired";

  return (
    <Collapsible render={<li />}>
      <CollapsibleTrigger
        render={<Button variant="ghost" />}
        aria-label={t("catalog.expand", { name: entry.name })}
        className={cn(
          "group h-auto w-full min-w-0 flex-col items-start justify-start gap-2 whitespace-normal rounded-none px-3 py-3 text-start font-normal sm:flex-row sm:items-center sm:gap-3",
          entry.lifecycle === "disabled" && "text-muted-foreground",
        )}
        type="button"
      >
        <span className="flex min-w-0 flex-1 items-center gap-3">
          <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
          <span className="min-w-0 flex-1 truncate text-sm">
            <Bdi>{entry.name}</Bdi>
          </span>
          {entry.lifecycle === "enabled" ? null : (
            <Badge className="text-muted-foreground" variant="outline">
              {t(`lifecycle.${entry.lifecycle}`)}
            </Badge>
          )}
        </span>
        {retired ? null : (
          <span className="flex min-w-0 items-center gap-2">
            <ObservationCaption observation={entry.observation} />
          </span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="grid gap-3 border-t bg-muted/20 p-3 text-xs">
          <Detail label={t("catalog.endpoint")}>
            <Bdi dir="ltr" className="font-mono">
              {entry.endpoint}
            </Bdi>
          </Detail>
          <Detail label={t("catalog.contentLocale")}>
            <span className="font-mono">{entry.contentLocale}</span>
          </Detail>
          {retired ? (
            <Detail label={t("catalog.lastObservation")}>
              {t("catalog.retiredNote")}
            </Detail>
          ) : (
            <ObservationDetail observation={entry.observation} />
          )}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ObservationCaption({
  observation,
}: {
  observation: SourceObservation | null;
}) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);

  if (!observation) {
    return (
      <>
        <StateMark state="queued" />
        <span className="text-muted-foreground text-xs">
          {t("observation.neverFetched")}
        </span>
      </>
    );
  }

  const time = format.dateTime(observation.observedAt, {
    dateStyle: "short",
    timeStyle: "short",
  });
  const mark = OBSERVATION_MARK[observation.outcome];
  const retrying =
    observation.outcome === "failed_retryable" && observation.importRunning;

  return (
    <>
      <StateMark state={retrying ? "retrying" : mark} />
      <span
        className={`text-xs ${
          mark === "failed" && !retrying
            ? "text-destructive"
            : "text-muted-foreground"
        }`}
      >
        {retrying
          ? t("observation.retrying")
          : observation.outcome === "succeeded"
            ? t("observation.items", {
                n: observation.fetchedCount,
                time,
              })
            : observation.reason
              ? t("observation.withReason", {
                  outcome: t(`outcome.${observation.outcome}`),
                  reason: t(`reason.${observation.reason}`),
                  time,
                })
              : t("observation.plain", {
                  outcome: t(`outcome.${observation.outcome}`),
                  time,
                })}
      </span>
    </>
  );
}

function ObservationDetail({
  observation,
}: {
  observation: SourceObservation | null;
}) {
  const t = useTranslations(SOURCES_NAMESPACE);

  if (!observation || observation.hasValidators) return null;

  return (
    <Detail label={t("catalog.validators")}>
      {t("catalog.validatorsAbsent")}
    </Detail>
  );
}

function Detail({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere min-w-0">{children}</dd>
    </div>
  );
}

function groupMeta(
  origin: SourceOrigin,
  entries: SourceCatalogEntry[],
  format: ReturnType<typeof useFormatter>,
  t: ReturnType<typeof useTranslations<typeof SOURCES_NAMESPACE>>,
) {
  const groupCount = t("catalog.groupCount", { n: entries.length });
  if (origin !== "rss") return groupCount;

  const buckets = ARTICLE_FETCH_MODES.flatMap((mode) => {
    const n = entries.filter((entry) => entry.articleFetchMode === mode).length;
    return n > 0 ? [{ mode, n }] : [];
  });

  if (buckets.length === 0) return groupCount;

  const only = ARTICLE_FETCH_MODES.find((mode) =>
    entries.every((entry) => entry.articleFetchMode === mode),
  );
  if (only) {
    return `${groupCount} · ${t("catalog.fetchMode.all", { mode: t(`catalog.fetchMode.${only}`) })}`;
  }

  const percents = mixPercents(buckets.map((bucket) => bucket.n));

  return buckets
    .map((bucket, index) =>
      t("catalog.fetchMode.bucket", {
        n: bucket.n,
        mode: t(`catalog.fetchMode.${bucket.mode}`),
        percent: format.number(
          (percents[index] ?? 0) / 100,
          MIX_PERCENT_FORMAT,
        ),
      }),
    )
    .join(" · ");
}
