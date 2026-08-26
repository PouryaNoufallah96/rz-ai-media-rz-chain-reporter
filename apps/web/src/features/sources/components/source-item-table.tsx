"use client";

import { ADMISSION_OUTCOMES } from "@rz-chain-reporter/contracts";
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
import { useId } from "react";

import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import { useKeysetDataTable } from "@/components/data-table/use-keyset-data-table";
import { LabeledSelect } from "@/components/form/form-field";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { SHORT_ID_LENGTH, SOURCES_NAMESPACE } from "../constants";
import {
  type SourceItemStream,
  type StreamSearchPatch,
  streamSearchParsers,
} from "../schemas/stream";
import {
  SOURCE_ITEM_COLUMN_CLASS_NAMES,
  sourceItemColumns,
} from "./source-item-columns";

export function SourceItemTable({ stream }: { stream: SourceItemStream }) {
  const format = useFormatter();
  const t = useTranslations(SOURCES_NAMESPACE);
  const titleId = useId();
  const { isPending, setValues } = useTransitionUrlState(streamSearchParsers);
  const { page, query } = stream;

  const table = useKeysetDataTable({
    columns: sourceItemColumns({
      format,
      showOccurrence: query.import !== null,
      t,
    }),
    data: page.rows,
    getRowId: (row) => row.id,
  });

  const setFilters = (patch: StreamSearchPatch) =>
    setValues({ ...patch, cursor: null });

  const clearFilters = () =>
    setValues({ admission: null, cursor: null, import: null, source: null });

  return (
    <section aria-labelledby={titleId} className="mt-10">
      <h2 className="ticket-label border-b border-dashed pb-2" id={titleId}>
        {t("stream.title")}
      </h2>
      <form
        aria-label={t("stream.filters.label")}
        className="mt-3 flex flex-wrap items-end gap-2"
      >
        <LabeledSelect
          className="w-fit"
          emptyLabel={t("stream.filters.all")}
          label={t("stream.filters.source")}
          onValueChange={(value) => setFilters({ source: value })}
          options={stream.sourceOptions.map((option) => ({
            label: option.name,
            value: option.id,
          }))}
          triggerClassName="max-w-52"
          value={query.source}
        />
        <LabeledSelect
          className="w-fit"
          emptyLabel={t("stream.filters.all")}
          label={t("stream.filters.admission")}
          onValueChange={(value) => setFilters({ admission: value })}
          options={ADMISSION_OUTCOMES.map((value) => ({
            label: t(`admission.${value}`),
            value,
          }))}
          triggerClassName="max-w-52"
          value={query.admission}
        />
        <LabeledSelect
          className="w-fit"
          emptyLabel={t("stream.filters.all")}
          label={t("stream.filters.import")}
          onValueChange={(value) => setFilters({ import: value })}
          options={stream.importOptions.map((option) => ({
            label: t("stream.importGroup", {
              id: option.id.slice(0, SHORT_ID_LENGTH),
            }),
            value: option.id,
          }))}
          triggerClassName="max-w-52"
          value={query.import}
        />
      </form>
      {!stream.hasAnyItem ? (
        <StreamEmpty
          description={t("stream.empty.hint")}
          title={t("stream.empty.title")}
        />
      ) : page.rows.length === 0 ? (
        <StreamEmpty
          action={
            <Button onClick={clearFilters} size="sm" variant="outline">
              {t("stream.filtered.clear")}
            </Button>
          }
          description={t("stream.filtered.hint")}
          title={t("stream.filtered.title")}
        />
      ) : (
        <>
          <CoreDataTable
            columnClassNames={SOURCE_ITEM_COLUMN_CLASS_NAMES}
            isPending={isPending}
            labels={{
              caption: t("stream.caption"),
              empty: t("stream.filtered.title"),
              updating: t("stream.updating"),
            }}
            table={table}
          />
          <KeysetPagination
            backToLatestLabel={t("stream.pager.backToLatest")}
            newerLabel={t("stream.pager.newer")}
            offLatest={page.offLatest}
            olderLabel={t("stream.pager.older")}
            onBackToLatest={() => setValues({ cursor: null })}
            onNewer={() => setValues({ cursor: page.newerCursor })}
            onOlder={
              page.olderCursor
                ? () => setValues({ cursor: page.olderCursor })
                : null
            }
          />
        </>
      )}
    </section>
  );
}

function StreamEmpty({
  action,
  description,
  title,
}: {
  action?: React.ReactNode;
  description: string;
  title: string;
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
