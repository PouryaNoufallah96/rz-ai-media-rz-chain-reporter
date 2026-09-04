"use client";

import { MARKET_ANALYSIS_STATUSES } from "@rz-chain-reporter/contracts";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import type { TableOptions } from "@tanstack/react-table";
import { FileTextIcon } from "lucide-react";
import Image from "next/image";
import { useFormatter, useTranslations } from "next-intl";
import { debounce } from "nuqs";
import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import {
  type keysetDataTableFeatures,
  useKeysetDataTable,
} from "@/components/data-table/use-keyset-data-table";
import { LabeledInput, LabeledSelect } from "@/components/form/form-field";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";
import { MARKET_ANALYSIS_NAMESPACE } from "../constants";

import type {
  MarketAnalysisDynamicOverlay,
  MarketAnalysisHistoryBaseRow,
  MarketAnalysisHistoryPage,
} from "../schemas/reads";
import {
  type MarketAnalysisSearchPatch,
  marketAnalysisSearchParsers,
} from "../schemas/search";

const FILTER_SELECT_CONTENT = { alignItemWithTrigger: false } as const;

type HistoryPayload = {
  base: MarketAnalysisHistoryPage;
  overlay: MarketAnalysisDynamicOverlay[];
};

export function MarketAnalysisHistory({
  history,
}: {
  history: HistoryPayload;
}) {
  const t = useTranslations(MARKET_ANALYSIS_NAMESPACE);
  const format = useFormatter();
  const { isPending, setValues, values } = useTransitionUrlState(
    marketAnalysisSearchParsers,
  );
  const overlays = new Map(
    history.overlay.map((item) => [item.analysisId, item]),
  );
  const columns: TableOptions<
    typeof keysetDataTableFeatures,
    MarketAnalysisHistoryBaseRow
  >["columns"] = [
    {
      id: "analysis",
      header: t("history.columns.analysis"),
      cell: ({ row }) => {
        const item = row.original;
        const title = `${item.symbols} · ${t(`create.periods.${item.period}`)}`;
        const final = overlays
          .get(item.id)
          ?.media.find(
            (asset) =>
              asset.id === item.currentFinalMediaAssetId && asset.available,
          );
        return (
          <div className="flex min-w-0 items-center gap-3 py-1">
            {final ? (
              <Image
                alt={t("history.thumbnail", { title })}
                className="compact:block hidden size-12 shrink-0 rounded-lg border object-cover"
                height={48}
                loading="lazy"
                sizes="48px"
                src={`/api/media/${final.id}`}
                unoptimized
                width={48}
              />
            ) : null}
            <span className="grid min-w-0 gap-0.5">
              <strong className="truncate font-medium">
                <Bdi>{title}</Bdi>
              </strong>
              <span className="compact:hidden text-muted-foreground text-xs">
                {item.visualOwnerName} · {t(`steps.${item.stage}`)} ·{" "}
                {format.dateTime(item.updatedAt, {
                  dateStyle: "short",
                  timeStyle: "short",
                })}
              </span>
              <span className="text-muted-foreground text-xs">
                {t(`create.scales.${item.scale}`)}
              </span>
            </span>
          </div>
        );
      },
    },
    { accessorKey: "visualOwnerName", header: t("history.columns.brand") },
    {
      accessorKey: "stage",
      header: t("history.columns.stage"),
      cell: ({ row }) => {
        const overlay = overlays.get(row.original.id);
        const operation = overlay?.operations.at(-1);
        const final = overlay?.media.find(
          (media) => media.id === row.original.currentFinalMediaAssetId,
        );
        return (
          <span className="grid gap-0.5 text-xs">
            <span>{t(`steps.${row.original.stage}`)}</span>
            {operation ? (
              <span className="text-muted-foreground">
                {t(`history.operation.${operation.lifecycle}`)}
              </span>
            ) : null}
            {final && final.integrity !== "available" ? (
              <span className="text-caution">
                {t(`report.integrity.${final.integrity}`)}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      accessorKey: "updatedAt",
      header: t("history.columns.updated"),
      cell: ({ row }) => (
        <time
          className="text-xs"
          dateTime={(
            row.original.completedAt ?? row.original.updatedAt
          ).toISOString()}
        >
          {row.original.status === "completed"
            ? t("history.completedAt", {
                date: format.dateTime(
                  row.original.completedAt ?? row.original.updatedAt,
                  { dateStyle: "short", timeStyle: "short" },
                ),
              })
            : format.dateTime(row.original.updatedAt, {
                dateStyle: "short",
                timeStyle: "short",
              })}
        </time>
      ),
    },
    {
      id: "action",
      header: () => (
        <span className="sr-only">{t("history.columns.action")}</span>
      ),
      cell: ({ row }) => (
        <Button
          nativeButton={false}
          render={<Link href={`/market-analysis/${row.original.id}`} />}
          size="sm"
          variant="outline"
        >
          {row.original.status === "completed"
            ? t("history.open")
            : t("history.resume")}
        </Button>
      ),
    },
  ];
  const table = useKeysetDataTable({
    columns,
    data: history.base.rows,
    getRowId: (row) => row.id,
  });

  const filtered = values.q !== null || values.status !== null;

  const setFilters = (patch: MarketAnalysisSearchPatch) =>
    setValues({ ...patch, cursor: null });

  const searchTitles = (q: string) =>
    setValues(
      { q: q || null, cursor: null },
      { limitUrlUpdates: debounce(300) },
    );

  const clearFilters = () => setValues({ q: null, status: null, cursor: null });

  return (
    <>
      <form
        aria-label={t("history.filters.label")}
        className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 max-sm:**:data-[slot=input]:min-h-11 max-sm:**:data-[slot=select-trigger]:min-h-11 sm:p-4"
        onSubmit={(event) => event.preventDefault()}
      >
        <LabeledInput
          autoComplete="off"
          className="min-w-0 flex-1 sm:min-w-64"
          label={t("history.filters.search")}
          name="q"
          onChange={(event) => searchTitles(event.currentTarget.value)}
          placeholder={t("history.filters.searchPlaceholder")}
          type="search"
          value={values.q ?? ""}
        />
        <LabeledSelect
          className="min-w-0 flex-1 sm:w-fit sm:flex-none"
          contentProps={FILTER_SELECT_CONTENT}
          emptyLabel={t("history.filters.all")}
          label={t("history.filters.status")}
          onValueChange={(status) => setFilters({ status })}
          options={MARKET_ANALYSIS_STATUSES.map((value) => ({
            label: t(`history.status.${value}`),
            value,
          }))}
          value={values.status}
        />
      </form>
      <section aria-labelledby="market-analysis-history-title" className="mt-6">
        <h2
          className="mb-3 font-medium text-sm"
          id="market-analysis-history-title"
        >
          {t("history.title")}
        </h2>
        {history.base.rows.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FileTextIcon />
              </EmptyMedia>
              <EmptyTitle>{t("history.empty.title")}</EmptyTitle>
              <EmptyDescription>
                {t(filtered ? "history.empty.filtered" : "history.empty.fresh")}
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              {filtered ? (
                <Button
                  className="max-sm:min-h-11"
                  onClick={clearFilters}
                  size="sm"
                  variant="outline"
                >
                  {t("history.empty.clear")}
                </Button>
              ) : (
                <Button
                  className="max-sm:min-h-11"
                  nativeButton={false}
                  render={<Link href="/market-analysis" />}
                  size="sm"
                  variant="outline"
                >
                  {t("actions.create")}
                </Button>
              )}
            </EmptyContent>
          </Empty>
        ) : (
          <>
            <CoreDataTable
              columnClassNames={{
                visualOwnerName: "max-compact:hidden",
                stage: "max-compact:hidden",
                updatedAt: "max-compact:hidden",
                action: "w-24 max-compact:w-auto",
              }}
              isPending={isPending}
              labels={{
                caption: t("history.caption"),
                empty: t("history.empty.filtered"),
                updating: t("history.updating"),
              }}
              table={table}
            />
            <KeysetPagination
              ariaLabel={t("history.caption")}
              backToLatestLabel={t("history.latest")}
              newerLabel={t("history.newer")}
              newerCursor={history.base.newerCursor}
              offLatest={history.base.offLatest}
              olderCursor={history.base.olderCursor}
              olderLabel={t("history.older")}
              onCursor={(cursor) => setValues({ cursor })}
            />
          </>
        )}
      </section>
    </>
  );
}
