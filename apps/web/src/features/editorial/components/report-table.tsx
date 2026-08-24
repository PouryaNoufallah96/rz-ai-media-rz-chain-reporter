"use client";

import { SEMANTIC_PARTICIPATIONS } from "@rz-chain-reporter/contracts";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { FileTextIcon } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { type ReactNode, useId } from "react";

import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import { useKeysetDataTable } from "@/components/data-table/use-keyset-data-table";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";
import { Link } from "@/i18n/navigation";

import { EDITORIAL_NAMESPACE } from "../constants";
import {
  REPORT_DISPOSITIONS,
  type ReportSearchPatch,
  type RunReport,
  reportSearchParsers,
} from "../schemas/report";
import type { RunHead } from "../schemas/workspace";
import { REPORT_COLUMN_CLASS_NAMES, reportColumns } from "./report-columns";

export function ReportTable({
  head,
  report,
}: {
  head: RunHead;
  report: RunReport;
}) {
  const format = useFormatter();
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const titleId = useId();
  const { isPending, setValues } = useTransitionUrlState(reportSearchParsers);
  const { brands, page, query, thresholds } = report;

  const table = useKeysetDataTable({
    columns: reportColumns({ format, head, t, thresholds }),
    data: page.rows,
    getRowId: (row) => `${row.sourceItemId}:${row.mediaBrandId ?? ""}`,
  });

  const filtered =
    query.brand !== null ||
    query.disposition !== null ||
    query.semantic !== null;

  const setFilters = (patch: ReportSearchPatch) =>
    setValues({ ...patch, cursor: null });

  const clearFilters = () =>
    setValues({
      brand: null,
      cursor: null,
      disposition: null,
      semantic: null,
    });

  return (
    <section aria-labelledby={titleId} className="mt-10">
      <h2 className="ticket-label border-b border-dashed pb-2" id={titleId}>
        {t("table.title")}
      </h2>
      <form
        aria-label={t("filters.label")}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <FilterSelect
          label={t("filters.brand")}
          onChange={(brand) => setFilters({ brand })}
          options={brands.map((brand) => ({
            label: brand.name,
            value: brand.id,
          }))}
          value={query.brand}
        />
        <FilterSelect
          label={t("filters.disposition")}
          onChange={(disposition) => setFilters({ disposition })}
          options={REPORT_DISPOSITIONS.map((value) => ({
            label: t(`disposition.${value}`),
            value,
          }))}
          value={query.disposition}
        />
        <FilterSelect
          label={t("filters.semantic")}
          onChange={(semantic) => setFilters({ semantic })}
          options={SEMANTIC_PARTICIPATIONS.map((value) => ({
            label: t(`semantic.participation.${value}`),
            value,
          }))}
          value={query.semantic}
        />
        <Button
          className="h-8"
          onClick={clearFilters}
          size="sm"
          type="button"
          variant="ghost"
        >
          {t("filters.clear")}
        </Button>
      </form>
      <span className="sr-only" role="status">
        {filtered && page.rows.length === 0 ? t("table.filtered.title") : ""}
      </span>
      {page.rows.length > 0 ? (
        <>
          <CoreDataTable
            columnClassNames={REPORT_COLUMN_CLASS_NAMES}
            isPending={isPending}
            labels={{
              caption: t("table.caption"),
              empty: t("table.filtered.title"),
              updating: t("table.updating"),
            }}
            table={table}
          />
          <KeysetPagination
            backToLatestLabel={t("table.pager.latest")}
            newerLabel={t("table.pager.newer")}
            offLatest={page.offFirst}
            olderLabel={t("table.pager.older")}
            onBackToLatest={() => setValues({ cursor: null })}
            onNewer={() => setValues({ cursor: page.previousCursor })}
            onOlder={
              page.nextCursor
                ? () => setValues({ cursor: page.nextCursor })
                : null
            }
          />
        </>
      ) : filtered ? (
        <ReportEmpty
          action={
            <Button onClick={clearFilters} size="sm" variant="outline">
              {t("filters.clear")}
            </Button>
          }
          description={t("table.filtered.hint", {
            brand:
              brands.find((brand) => brand.id === query.brand)?.name ??
              t("filters.all"),
            disposition: query.disposition
              ? t(`disposition.${query.disposition}`)
              : t("filters.all"),
            semantic: query.semantic
              ? t(`semantic.participation.${query.semantic}`)
              : t("filters.all"),
          })}
          title={t("table.filtered.title")}
        />
      ) : (
        <ReportEmpty
          action={
            <Button
              nativeButton={false}
              render={<Link href={`/dashboard?run=${head.id}`} />}
              size="sm"
              variant="outline"
            >
              {t("report.back")}
            </Button>
          }
          title={t("table.empty.title")}
        />
      )}
    </section>
  );
}

function FilterSelect<TValue extends string>({
  label,
  onChange,
  options,
  value,
}: {
  label: string;
  onChange: (value: TValue | null) => void;
  options: readonly { label: string; value: TValue }[];
  value: string | null;
}) {
  const t = useTranslations(EDITORIAL_NAMESPACE);
  const id = useId();

  return (
    <div className="grid gap-1 text-xs">
      <label className="ticket-label" htmlFor={id}>
        {label}
      </label>
      <select
        className="h-8 max-w-52 rounded-none border border-input bg-background px-2 text-xs"
        id={id}
        onChange={(event) => {
          const selected = options.find(
            (option) => option.value === event.target.value,
          );
          onChange(selected?.value ?? null);
        }}
        value={value ?? ""}
      >
        <option value="">{t("filters.all")}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ReportEmpty({
  action,
  description,
  title,
}: {
  action: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      <EmptyContent>{action}</EmptyContent>
    </Empty>
  );
}
