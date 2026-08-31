"use client";

import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import type { TableOptions } from "@tanstack/react-table";
import type { useFormatter, useTranslations } from "next-intl";

import type { keysetDataTableFeatures } from "@/components/data-table/use-keyset-data-table";

import type { EDITORIAL_NAMESPACE } from "../constants";
import {
  type ReportRow,
  type ReportThresholds,
  reportLaneCap,
  reportLowScoreFailures,
} from "../schemas/report";
import type { RunHead } from "../schemas/workspace";
import { ChannelPlate } from "./channel-plate";
import { MutedTag } from "./provenance-line";
import { ScoreDrawer } from "./score-drawer";

type Translate = ReturnType<typeof useTranslations<typeof EDITORIAL_NAMESPACE>>;
type Format = ReturnType<typeof useFormatter>;

export const REPORT_COLUMN_CLASS_NAMES = {
  mediaFit: "hidden workspace:table-cell",
  policy: "hidden workspace:table-cell",
  rankScore: "hidden compact:table-cell",
  semantic: "hidden compact:table-cell",
} as const;

export function reportColumns({
  format,
  head,
  t,
  thresholds,
}: {
  format: Format;
  head: RunHead;
  t: Translate;
  thresholds: ReportThresholds;
}): TableOptions<typeof keysetDataTableFeatures, ReportRow>["columns"] {
  const degraded = head.provenance.semanticStatus === "degraded";
  const hasTopics =
    head.configuration.kind === "news" && head.configuration.topics.length > 0;

  return [
    {
      accessorKey: "rankPosition",
      header: t("table.columns.rank"),
      id: "rank",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">
          {score(row.original.rankPosition, format)}
        </span>
      ),
    },
    {
      accessorKey: "title",
      header: t("table.columns.item"),
      id: "item",
      cell: ({ row, table }) => {
        const previous = table.getRowModel().rows[row.index - 1]?.original;
        const caption = rowCaption(
          row.original,
          t,
          thresholds,
          hasTopics,
          head.configuration.kind === "news"
            ? head.configuration.topN
            : thresholds.shortlistCap,
        );

        return (
          <ScoreDrawer head={head} row={row.original} thresholds={thresholds}>
            <span className="line-clamp-2 block text-sm">
              <Bdi>{row.original.title}</Bdi>
            </span>
            <span className="flex flex-wrap items-center gap-1 text-muted-foreground text-xs">
              {row.original.sourceOrigin === "telegram_public" ? (
                <ChannelPlate handle={row.original.sourceEndpoint} />
              ) : (
                <Bdi className="truncate">{row.original.sourceName}</Bdi>
              )}
              <span className="workspace:hidden tabular-nums">
                {`${t("table.folded.mediaFit")} ${score(row.original.mediaFitScore, format)} · ${t("table.folded.policy")} ${score(row.original.policyScore, format)}`}
                <span className="compact:hidden">
                  {` · ${t("table.folded.rank")} ${score(row.original.rankScore, format)}`}
                </span>
              </span>
            </span>
            {caption ? (
              <span className="block text-muted-foreground text-xs">
                <Bdi>{caption}</Bdi>
              </span>
            ) : null}
            {tiedWith(previous, row.original) ? (
              <span className="block text-muted-foreground text-xs">
                {t("table.tieBreak")}
              </span>
            ) : null}
          </ScoreDrawer>
        );
      },
    },
    {
      accessorKey: "brandName",
      header: t("table.columns.brand"),
      id: "brand",
      cell: ({ row }) => (
        <span className="text-xs">
          {row.original.brandName ? (
            <Bdi>{row.original.brandName}</Bdi>
          ) : (
            EMPTY_VALUE
          )}
        </span>
      ),
    },
    {
      accessorKey: "disposition",
      header: t("table.columns.disposition"),
      id: "disposition",
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs">
          {t(`disposition.${row.original.disposition}`)}
        </span>
      ),
    },
    {
      accessorKey: "mediaFitScore",
      header: t("table.columns.mediaFit"),
      id: "mediaFit",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">
          {score(row.original.mediaFitScore, format)}
        </span>
      ),
    },
    {
      accessorKey: "policyScore",
      header: t("table.columns.policy"),
      id: "policy",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">
          {score(row.original.policyScore, format)}
        </span>
      ),
    },
    {
      accessorKey: "rankScore",
      header: t("table.columns.rankScore"),
      id: "rankScore",
      cell: ({ row }) => (
        <span className="text-xs tabular-nums">
          {score(row.original.rankScore, format)}
        </span>
      ),
    },
    {
      accessorKey: "semanticBrandScore",
      header: t("table.columns.semantic"),
      id: "semantic",
      cell: ({ row }) => {
        if (degraded) {
          return <MutedTag>{t("semantic.degraded.tag")}</MutedTag>;
        }

        if (row.original.semanticParticipation === "outside_bound") {
          return <MutedTag>{t("semantic.outsideBound.tag")}</MutedTag>;
        }

        return (
          <span className="text-xs tabular-nums">
            {score(row.original.semanticBrandScore, format)}
          </span>
        );
      },
    },
  ];
}

const EMPTY_VALUE = "—";

function score(value: number | null, format: Format) {
  return value === null ? EMPTY_VALUE : format.number(value);
}

function rowCaption(
  row: ReportRow,
  t: Translate,
  thresholds: ReportThresholds,
  hasTopics: boolean,
  telegramLaneCap: number,
) {
  if (row.duplicateMethod && row.disposition === "duplicate") {
    const method = t(`duplicateMethod.${row.duplicateMethod}`);

    return row.duplicateOfTitle && row.duplicateOfOrigin
      ? `${method} · ${t("score.duplicate.survivor", {
          kind: t(`origin.${row.duplicateOfOrigin}`),
          title: row.duplicateOfTitle,
        })}`
      : method;
  }

  if (row.disposition === "cap_exceeded" && row.rankPosition !== null) {
    return t("score.capReached", {
      n: reportLaneCap(row, thresholds, telegramLaneCap),
      r: row.rankPosition,
    });
  }

  const lowScoreFailures = reportLowScoreFailures(row, thresholds, hasTopics);
  if (lowScoreFailures.length === 2) {
    return t("score.lowScore.policyAndTopic");
  }
  if (lowScoreFailures[0] === "policy") {
    return t("score.lowScore.policy");
  }
  if (lowScoreFailures[0] === "lexical_topic") {
    return t("score.lowScore.topicLexical");
  }

  return null;
}

function tiedWith(previous: ReportRow | undefined, row: ReportRow) {
  return (
    previous !== undefined &&
    row.rankScore !== null &&
    previous.rankScore === row.rankScore &&
    previous.mediaBrandId === row.mediaBrandId
  );
}
