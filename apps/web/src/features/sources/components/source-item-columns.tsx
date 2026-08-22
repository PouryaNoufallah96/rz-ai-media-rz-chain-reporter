"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import type { TableOptions } from "@tanstack/react-table";
import type { useFormatter, useTranslations } from "next-intl";

import { StateMark } from "@/components/common/state-mark";
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
          className="whitespace-nowrap font-mono text-xs tabular-nums"
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
          <Bdi className="truncate text-xs">{row.original.sourceName}</Bdi>
          <time
            className="font-mono text-[11px] text-muted-foreground tabular-nums sm:hidden"
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
          className="text-sm underline-offset-4 hover:underline"
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
        <span className="font-mono text-xs tabular-nums">
          {format.number(row.original.revisionCount)}
        </span>
      ),
    },
    {
      accessorKey: "enrichment",
      header: t("stream.columns.enrichment"),
      id: "enrichment",
      cell: ({ row }) => (
        <span className="flex items-center gap-1 text-xs">
          {row.original.enrichment === null ? null : (
            <StateMark
              state={
                row.original.enrichment === "succeeded"
                  ? "succeeded"
                  : row.original.enrichment === "pending"
                    ? "running"
                    : row.original.enrichment === "skipped"
                      ? "cancelled"
                      : row.original.enrichment === "unknown"
                        ? "unknown"
                        : "failed"
              }
            />
          )}
          {t(`enrichment.${row.original.enrichment ?? "none"}`)}
        </span>
      ),
    },
    ...(showOccurrence
      ? [
          {
            accessorKey: "rank",
            header: t("stream.columns.rank"),
            id: "rank",
            cell: ({ row }: { row: { original: SourceItemRow } }) => (
              <span className="font-mono text-xs tabular-nums">
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
              <span className="font-mono text-xs tabular-nums">
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
