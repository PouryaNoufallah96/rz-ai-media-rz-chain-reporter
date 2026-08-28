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
import { LabeledSelect } from "@/components/form/form-field";
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
    <section aria-labelledby={titleId} className="mt-8 grid gap-3">
      <h2 className="font-semibold text-base" id={titleId}>
        {t("table.title")}
      </h2>
      <form
        aria-label={t("filters.label")}
        className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 [&_button]:max-sm:min-h-11"
      >
        <LabeledSelect
          className="w-fit"
          emptyLabel={t("filters.all")}
          label={t("filters.brand")}
          onValueChange={(brand) => setFilters({ brand })}
          options={brands.map((brand) => ({
            label: brand.name,
            value: brand.id,
          }))}
          triggerClassName="max-w-52"
          value={query.brand}
        />
        <LabeledSelect
          className="w-fit"
          emptyLabel={t("filters.all")}
          label={t("filters.disposition")}
          onValueChange={(disposition) => setFilters({ disposition })}
          options={REPORT_DISPOSITIONS.map((value) => ({
            label: t(`disposition.${value}`),
            value,
          }))}
          triggerClassName="max-w-52"
          value={query.disposition}
        />
        <LabeledSelect
          className="w-fit"
          emptyLabel={t("filters.all")}
          label={t("filters.semantic")}
          onValueChange={(semantic) => setFilters({ semantic })}
          options={SEMANTIC_PARTICIPATIONS.map((value) => ({
            label: t(`semantic.participation.${value}`),
            value,
          }))}
          triggerClassName="max-w-52"
          value={query.semantic}
        />
        <Button
          className="h-8 max-sm:min-h-11"
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
    <Empty className="rounded-xl border border-border bg-card py-10">
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
