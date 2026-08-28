"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import type { TableOptions } from "@tanstack/react-table";
import type { useFormatter, useTranslations } from "next-intl";

import { StateMark, type StateMarkState } from "@/components/common/state-mark";
import type { keysetDataTableFeatures } from "@/components/data-table/use-keyset-data-table";

import type { SOURCES_NAMESPACE } from "../constants";
import type { SourceItemRow } from "../schemas/stream";
import { SourceItemDetail } from "./source-item-detail";

type Translate = ReturnType<typeof useTranslations<typeof SOURCES_NAMESPACE>>;
type Format = ReturnType<typeof useFormatter>;

export const SOURCE_ITEM_COLUMN_CLASS_NAMES = {
  time: "hidden sm:table-cell",
  revisions: "hidden md:table-cell",
} as const;

export function sourceItemColumns({
  format,
  showOccurrence,
  t,
}: {
  format: Format;
  showOccurrence: boolean;
  t: Translate;
}): TableOptions<typeof keysetDataTableFeatures, SourceItemRow>["columns"] {
  return [
    {
      accessorKey: "createdAt",
      header: t("stream.columns.time"),
      id: "time",
      cell: ({ row }) => (
        <time
          className="whitespace-nowrap text-xs tabular-nums"
          dateTime={row.original.createdAt.toISOString()}
        >
          {format.dateTime(row.original.createdAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </time>
      ),
    },
    {
      accessorKey: "sourceName",
      header: t("stream.columns.source"),
      id: "source",
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs">
            <Bdi>{row.original.sourceName}</Bdi>
          </span>
          <time
            className="text-muted-foreground text-xs tabular-nums sm:hidden"
            dateTime={row.original.createdAt.toISOString()}
          >
            {format.dateTime(row.original.createdAt, { timeStyle: "short" })}
          </time>
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: t("stream.columns.title"),
      id: "title",
      cell: ({ row }) => (
        <a
          className="wrap-anywhere rounded-sm text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          href={row.original.canonicalUrl}
          rel="noreferrer noopener"
          target="_blank"
        >
          <Bdi>{row.original.title}</Bdi>
        </a>
      ),
    },
    {
      accessorKey: "revisionCount",
      header: t("stream.columns.revisions"),
      id: "revisions",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">
          {format.number(row.original.revisionCount)}
        </span>
      ),
    },
    {
      header: t("stream.columns.path"),
      id: "path",
      cell: ({ row }) => {
        const mark = pathMark(row.original);

        return (
          <span className="flex min-w-32 items-center gap-2 text-xs/relaxed">
            {mark ? <StateMark state={mark} /> : null}
            {itemPath(row.original, t)}
          </span>
        );
      },
    },
    ...(showOccurrence
      ? [
          {
            accessorKey: "rank",
            header: t("stream.columns.rank"),
            id: "rank",
            cell: ({ row }: { row: { original: SourceItemRow } }) => (
              <span className="text-xs tabular-nums">
                {row.original.rank === null
                  ? "—"
                  : format.number(row.original.rank)}
              </span>
            ),
          },
          {
            accessorKey: "keywordScore",
            header: t("stream.columns.score"),
            id: "score",
            cell: ({ row }: { row: { original: SourceItemRow } }) => (
              <span className="text-xs tabular-nums">
                {row.original.keywordScore === null
                  ? "—"
                  : format.number(row.original.keywordScore, {
                      maximumFractionDigits: 3,
                    })}
              </span>
            ),
          },
        ]
      : []),
    {
      header: () => <span className="sr-only">{t("detail.brief")}</span>,
      id: "detail",
      cell: ({ row }) => <SourceItemDetail row={row.original} />,
    },
  ];
}

function itemPath(row: SourceItemRow, t: Translate) {
  if (row.admission !== null && row.admission !== "admitted") {
    return t(`admission.${row.admission}`);
  }

  const admitted =
    row.admission === "admitted" ? t("admission.admitted") : null;

  if (row.enrichment === "pending") {
    return joinPath(admitted, t("path.enriching"));
  }

  if (row.enrichment === "failed") {
    return joinPath(
      admitted,
      row.enrichmentReason
        ? t("path.failed", { reason: t(`reason.${row.enrichmentReason}`) })
        : t("enrichment.failed"),
    );
  }

  if (row.adapter) {
    return joinPath(
      admitted,
      row.adapter === "firecrawl" && row.fallbackReason
        ? t("adapter.directThenFirecrawl")
        : t(`adapter.${row.adapter}`),
    );
  }

  if (row.enrichment && row.enrichment !== "succeeded") {
    return joinPath(admitted, t(`enrichment.${row.enrichment}`));
  }

  return admitted ?? t("enrichment.none");
}

function joinPath(head: string | null, tail: string) {
  return head ? `${head} · ${tail}` : tail;
}

function pathMark(row: SourceItemRow): StateMarkState | null {
  if (row.admission !== null && row.admission !== "admitted") {
    return "cancelled";
  }
  if (row.enrichment === "pending") return "running";
  if (row.enrichment === "failed") return "failed";
  if (row.enrichment === "unknown") return "unknown";
  if (row.enrichment === "skipped") return "cancelled";
  return null;
}
