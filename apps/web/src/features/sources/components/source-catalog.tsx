"use client";

import type { SourceOrigin } from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { useFormatter, useTranslations } from "next-intl";
import { useId, useState } from "react";

import { StateMark, type StateMarkState } from "@/components/common/state-mark";

import { SOURCES_NAMESPACE } from "../constants";
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
    <section aria-labelledby={titleId} className="mt-10">
      <h2 className="ticket-label border-b border-dashed pb-2" id={titleId}>
        {t("catalog.title")}
      </h2>
      <p className="mt-2 text-muted-foreground text-xs">{t("catalog.hint")}</p>
      {catalog.entries.length === 0 ? (
        <p className="mt-4 text-muted-foreground text-sm">
          {t("catalog.empty")}
        </p>
      ) : (
        GROUPS.map((origin) => {
          const entries = catalog.entries.filter(
            (entry) => entry.origin === origin,
          );

          return entries.length === 0 ? null : (
            <SourceGroup
              entries={entries}
              itemCap={catalog.itemCap}
              key={origin}
              origin={origin}
            />
          );
        })
      )}
    </section>
  );
}

function SourceGroup({
  entries,
  itemCap,
  origin,
}: {
  entries: SourceCatalogEntry[];
  itemCap: number;
  origin: SourceOrigin;
}) {
  const t = useTranslations(SOURCES_NAMESPACE);
  const labelId = useId();

  return (
    <section aria-labelledby={labelId} className="mt-6">
      <h3 className="flex items-baseline gap-2" id={labelId}>
        <span className="ticket-label">{t(`catalog.kind.${origin}`)}</span>
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {t("catalog.groupCount", { n: entries.length })}
        </span>
      </h3>
      <ul className="mt-2 border-border border-t">
        {entries.map((entry) => (
          <SourceRow entry={entry} itemCap={itemCap} key={entry.id} />
        ))}
      </ul>
    </section>
  );
}

function SourceRow({
  entry,
  itemCap,
}: {
  entry: SourceCatalogEntry;
  itemCap: number;
}) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const [expanded, setExpanded] = useState(false);
  const detailId = useId();
  const retired = entry.lifecycle === "retired";

  return (
    <li className="border-border border-b border-dashed">
      <button
        aria-controls={detailId}
        aria-expanded={expanded}
        aria-label={t("catalog.expand", { name: entry.name })}
        className={`flex w-full min-w-0 items-center gap-3 py-2 text-start outline-none focus-visible:ring-1 focus-visible:ring-ring ${
          entry.lifecycle === "disabled" ? "text-muted-foreground" : ""
        }`}
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        <span className="min-w-0 flex-1 truncate text-sm">
          <Bdi>{entry.name}</Bdi>
        </span>
        <span className="ticket-label border border-dashed px-1 text-muted-foreground">
          {t(`lifecycle.${entry.lifecycle}`)}
        </span>
        {retired ? null : (
          <span className="hidden min-w-0 items-center gap-2 sm:flex">
            <ObservationCaption observation={entry.observation} />
          </span>
        )}
      </button>
      {expanded ? (
        <dl className="grid gap-1 pb-3 text-xs sm:grid-cols-2" id={detailId}>
          <Detail label={t("catalog.endpoint")}>
            <Bdi dir="ltr" className="font-mono">
              {entry.endpoint}
            </Bdi>
          </Detail>
          <Detail label={t("catalog.contentLocale")}>
            <span className="font-mono">{entry.contentLocale}</span>
          </Detail>
          <Detail label={t("catalog.itemCap")}>
            <span className="font-mono tabular-nums">
              {format.number(itemCap)}
            </span>
          </Detail>
          {retired ? (
            <Detail label={t("catalog.lastObservation")}>
              {t("catalog.retiredNote")}
            </Detail>
          ) : (
            <ObservationDetail observation={entry.observation} />
          )}
        </dl>
      ) : null}
    </li>
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
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);

  if (!observation) {
    return (
      <Detail label={t("catalog.lastObservation")}>
        {t("observation.neverFetched")}
      </Detail>
    );
  }

  return (
    <>
      <Detail label={t("catalog.fetchedCount")}>
        <span className="font-mono tabular-nums">
          {t("counts.pair", {
            admitted: observation.admittedCount,
            fetched: observation.fetchedCount,
          })}
        </span>
      </Detail>
      <Detail label={t("catalog.validators")}>
        {t(
          observation.hasValidators
            ? "catalog.validatorsPresent"
            : "catalog.validatorsAbsent",
        )}
      </Detail>
      <Detail label={t("catalog.reasonCode")}>
        <span className="font-mono">
          {observation.reason ? t(`reason.${observation.reason}`) : "—"}
        </span>
      </Detail>
      <Detail label={t("catalog.lastObservation")}>
        <time dateTime={observation.observedAt.toISOString()}>
          {format.dateTime(observation.observedAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </time>
      </Detail>
    </>
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
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}
