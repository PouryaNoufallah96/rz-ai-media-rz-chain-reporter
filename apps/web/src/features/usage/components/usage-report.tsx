"use client";

import {
  MODEL_BACKENDS,
  modelVendor,
  USAGE_STATUSES,
} from "@rz-chain-reporter/contracts";
import { DIRECTION } from "@rz-chain-reporter/i18n";
import { Badge } from "@rz-chain-reporter/ui/components/badge";
import { Bdi } from "@rz-chain-reporter/ui/components/bdi";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@rz-chain-reporter/ui/components/collapsible";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@rz-chain-reporter/ui/components/empty";
import { SimpleIconsOllama } from "@rz-chain-reporter/ui/components/icons/simple-icons/ollama";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rz-chain-reporter/ui/components/table";
import type { TableOptions } from "@tanstack/react-table";
import { ChevronDownIcon, FileTextIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { SubmitEventHandler } from "react";
import { ModelIcon } from "@/components/common/model-icon";
import { SectionCard } from "@/components/common/section-card";
import { StateMark } from "@/components/common/state-mark";
import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import {
  type keysetDataTableFeatures,
  useKeysetDataTable,
} from "@/components/data-table/use-keyset-data-table";
import { LabeledInput, LabeledSelect } from "@/components/form/form-field";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { USAGE_NAMESPACE, USAGE_PERIODS, USAGE_PROVIDERS } from "../constants";

const FILTER_SELECT_CONTENT = { alignItemWithTrigger: false } as const;

import {
  type UsagePage,
  type UsageQuery,
  type UsageRow,
  type UsageSearchPatch,
  type UsageSummary,
  usageSearchParsers,
} from "../schemas/usage";
import { UsageFreshness } from "./usage-freshness";

const COLUMN_CLASS_NAMES = {
  task: "hidden md:table-cell",
  backend: "hidden md:table-cell",
  provider: "hidden md:table-cell",
  tokens: "hidden md:table-cell",
  detail: "md:hidden",
} as const;

const USAGE_STATUS_MARK = {
  pending: "running",
  succeeded: "succeeded",
  failed: "failed",
  cancelled: "cancelled",
  unknown: "unknown",
} as const;

const COST_FORMAT = {
  style: "currency",
  currency: "USD",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 10,
} as const;

interface UsageReportProps {
  page: UsagePage;
  query: UsageQuery;
  summary: UsageSummary;
}

export function UsageReport({ page, query, summary }: UsageReportProps) {
  const t = useTranslations(USAGE_NAMESPACE);
  const format = useFormatter();
  const { isPending, setValues } = useTransitionUrlState(usageSearchParsers);
  const columns: TableOptions<
    typeof keysetDataTableFeatures,
    UsageRow
  >["columns"] = [
    {
      accessorKey: "occurredAt",
      header: t("columns.time"),
      cell: ({ row }) => (
        <time
          className="whitespace-nowrap text-xs tabular-nums"
          dateTime={row.original.occurredAt.toISOString()}
        >
          {format.dateTime(row.original.occurredAt, {
            dateStyle: "short",
            timeStyle: "short",
          })}
        </time>
      ),
    },
    {
      accessorKey: "taskKey",
      header: t("columns.task"),
      id: "task",
      cell: ({ row }) => (
        <Bdi className="font-mono text-xs">{row.original.taskKey}</Bdi>
      ),
    },
    {
      accessorKey: "requestedModel",
      header: t("columns.model"),
      id: "model",
      cell: ({ row }) => <ModelValue row={row.original} />,
    },
    {
      accessorKey: "backend",
      header: t("columns.backend"),
      id: "backend",
      cell: ({ row }) => t(`backend.${row.original.backend}`),
    },
    {
      accessorKey: "provider",
      header: t("columns.provider"),
      id: "provider",
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          {row.original.provider === "ollama" ? (
            <SimpleIconsOllama className="size-3.5 shrink-0" aria-hidden />
          ) : null}
          {t(`provider.${row.original.provider}`)}
        </span>
      ),
    },
    {
      accessorKey: "totalTokens",
      header: t("columns.tokens"),
      id: "tokens",
      cell: ({ row }) => <TokenValue row={row.original} />,
    },
    {
      accessorKey: "cost",
      header: t("columns.cost"),
      id: "cost",
      cell: ({ row }) => <CostValue row={row.original} />,
    },
    {
      accessorKey: "status",
      header: t("columns.status"),
      id: "status",
      cell: ({ row }) => (
        <span
          data-status={row.original.status}
          className="flex items-center gap-1 font-medium text-xs"
        >
          <StateMark state={USAGE_STATUS_MARK[row.original.status]} />
          {t(`status.${row.original.status}`)}
        </span>
      ),
    },
    {
      header: () => <span className="sr-only">{t("details.title")}</span>,
      id: "detail",
      cell: ({ row }) => <UsageDetails row={row.original} />,
    },
  ];
  const table = useKeysetDataTable({
    columns,
    data: page.rows,
    getRowId: (row) => row.id,
  });

  const setFilters = (patch: UsageSearchPatch) =>
    setValues({ ...patch, cursor: null });

  const clearFilters = () =>
    setValues({
      period: "all",
      model: null,
      backend: null,
      provider: null,
      task: null,
      status: null,
      cursor: null,
    });

  const handleTextFilters: SubmitEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFilters({
      model: textFilterValue(data.get("model")),
      task: textFilterValue(data.get("task")),
    });
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap items-end gap-3 rounded-xl border bg-card p-3 max-sm:**:data-[slot=input]:min-h-11 max-sm:**:data-[slot=select-trigger]:min-h-11 sm:p-4">
        <UsageFilters
          onSubmit={handleTextFilters}
          onValueChange={setFilters}
          query={query}
        />
        <div className="ms-auto flex flex-wrap items-end gap-2">
          <Button
            className="max-sm:min-h-11"
            form="usage-filters"
            size="sm"
            type="submit"
            variant="outline"
          >
            {t("filters.apply")}
          </Button>
          <UsageFreshness />
        </div>
      </div>
      <UsageSummaryBlock summary={summary} />
      <section className="mt-6" aria-labelledby="usage-ledger-title">
        <h2 className="mb-3 font-medium text-sm" id="usage-ledger-title">
          {t("ledger.title")}
        </h2>
        {summary.recordedInvocations === 0 ? (
          <UsageEmpty description={t("empty.recorded")} />
        ) : page.rows.length === 0 ? (
          <UsageEmpty
            action={
              <Button
                className="max-sm:min-h-11"
                onClick={clearFilters}
                size="sm"
                variant="outline"
              >
                {t("empty.clearFilters")}
              </Button>
            }
            description={t("empty.filtered")}
          />
        ) : (
          <>
            <CoreDataTable
              columnClassNames={COLUMN_CLASS_NAMES}
              isPending={isPending}
              labels={{
                caption: t("ledger.caption"),
                empty: t("empty.filtered"),
                updating: t("table.updating"),
              }}
              table={table}
            />
            <KeysetPagination
              ariaLabel={t("ledger.caption")}
              backToLatestLabel={t("pager.backToLatest")}
              newerLabel={t("pager.newer")}
              olderLabel={t("pager.older")}
              offLatest={page.offLatest}
              newerCursor={page.newerCursor}
              olderCursor={page.olderCursor}
              onCursor={(cursor) => setValues({ cursor })}
            />
          </>
        )}
      </section>
    </>
  );
}

function UsageFilters({
  onSubmit,
  onValueChange,
  query,
}: {
  onSubmit: SubmitEventHandler<HTMLFormElement>;
  onValueChange: (patch: UsageSearchPatch) => void;
  query: UsageQuery;
}) {
  const t = useTranslations(USAGE_NAMESPACE);

  return (
    <form
      aria-label={t("filters.label")}
      className="flex min-w-0 flex-1 flex-wrap items-end gap-3"
      id="usage-filters"
      onSubmit={onSubmit}
    >
      <LabeledSelect
        className="min-w-0 flex-1 sm:w-fit sm:flex-none"
        contentProps={FILTER_SELECT_CONTENT}
        label={t("filters.period")}
        onValueChange={(value) => {
          if (value) onValueChange({ period: value });
        }}
        options={USAGE_PERIODS.map((value) => ({
          label: t(`period.${value}`),
          value,
        }))}
        value={query.period}
      />
      <LabeledInput
        className="min-w-0 flex-1 sm:w-fit sm:flex-none"
        defaultValue={query.model ?? ""}
        inputClassName="w-full sm:w-40"
        key={`model:${query.model ?? ""}`}
        label={t("filters.model")}
        maxLength={200}
        name="model"
        placeholder={t("filters.modelPlaceholder")}
      />
      <LabeledSelect
        className="min-w-0 flex-1 sm:w-fit sm:flex-none"
        contentProps={FILTER_SELECT_CONTENT}
        emptyLabel={t("filters.all")}
        label={t("filters.backend")}
        onValueChange={(value) => onValueChange({ backend: value })}
        options={MODEL_BACKENDS.map((value) => ({
          label: t(`backend.${value}`),
          value,
        }))}
        value={query.backend}
      />
      <LabeledSelect
        className="min-w-0 flex-1 sm:w-fit sm:flex-none"
        contentProps={FILTER_SELECT_CONTENT}
        emptyLabel={t("filters.all")}
        label={t("filters.provider")}
        onValueChange={(value) => onValueChange({ provider: value })}
        options={USAGE_PROVIDERS.map((value) => ({
          label: t(`provider.${value}`),
          value,
        }))}
        value={query.provider}
      />
      <LabeledInput
        className="min-w-0 flex-1 sm:w-fit sm:flex-none"
        defaultValue={query.task ?? ""}
        inputClassName="w-full sm:w-40"
        key={`task:${query.task ?? ""}`}
        label={t("filters.task")}
        maxLength={200}
        name="task"
        placeholder={t("filters.taskPlaceholder")}
      />
      <LabeledSelect
        className="min-w-0 flex-1 sm:w-fit sm:flex-none"
        contentProps={FILTER_SELECT_CONTENT}
        emptyLabel={t("filters.all")}
        label={t("filters.status")}
        onValueChange={(value) => onValueChange({ status: value })}
        options={USAGE_STATUSES.map((value) => ({
          label: t(`status.${value}`),
          value,
        }))}
        value={query.status}
      />
    </form>
  );
}

function UsageSummaryBlock({ summary }: { summary: UsageSummary }) {
  const t = useTranslations(USAGE_NAMESPACE);
  const format = useFormatter();
  return (
    <section aria-labelledby="usage-summary-title" className="mt-6">
      <SectionCard
        content="flush"
        title={t("summary.title")}
        titleId="usage-summary-title"
      >
        <dl className="grid grid-cols-2 gap-4 border-b p-4 text-xs sm:grid-cols-3 sm:p-5 lg:grid-cols-5">
          <SummaryFact
            label={t("summary.invocations")}
            value={format.number(summary.invocations)}
          />
          <SummaryFact
            label={t("summary.tokens")}
            value={format.number(summary.totalTokens)}
          />
          <SummaryFact
            label={t("summary.recordedCost")}
            value={format.number(Number(summary.recordedCost), COST_FORMAT)}
          />
          <SummaryFact
            label={t("summary.pending")}
            value={format.number(summary.pendingCount)}
          />
          <SummaryFact
            label={t("summary.unknown")}
            value={format.number(summary.unknownCount)}
          />
        </dl>
        {summary.models.length > 0 ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.model")}</TableHead>
                <TableHead>{t("columns.backend")}</TableHead>
                <TableHead>{t("summary.invocations")}</TableHead>
                <TableHead>{t("summary.tokens")}</TableHead>
                <TableHead>{t("summary.recordedCost")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.models.map((model) => (
                <TableRow key={`${model.backend}:${model.model}`}>
                  <TableCell>
                    <span className="flex items-center gap-2">
                      {model.backend === "local" ? (
                        <SimpleIconsOllama
                          className="size-4 shrink-0"
                          aria-hidden
                        />
                      ) : (
                        <ModelIcon
                          className="size-4 shrink-0"
                          vendor={modelVendor(model.model)}
                        />
                      )}
                      <Bdi className="font-mono">{model.model}</Bdi>
                    </span>
                  </TableCell>
                  <TableCell>{t(`backend.${model.backend}`)}</TableCell>
                  <TableCell className="tabular-nums">
                    {format.number(model.invocations)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {format.number(model.totalTokens)}
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {format.number(Number(model.recordedCost), COST_FORMAT)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : null}
      </SectionCard>
    </section>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="wrap-anywhere mt-2 font-medium text-lg tabular-nums">
        {value}
      </dd>
    </div>
  );
}

function UsageEmpty({
  action,
  description,
}: {
  action?: React.ReactNode;
  description: string;
}) {
  const t = useTranslations(USAGE_NAMESPACE);
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FileTextIcon />
        </EmptyMedia>
        <EmptyTitle>{t("empty.title")}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}

function ModelValue({ row }: { row: UsageRow }) {
  const t = useTranslations(USAGE_NAMESPACE);
  const locale = useLocale();
  const changed = row.resolvedModel && row.resolvedModel !== row.requestedModel;
  return (
    <span className="flex max-w-56 flex-wrap items-center gap-1 text-xs">
      <span className="inline-flex items-center gap-1">
        {row.backend === "local" ? (
          <SimpleIconsOllama className="size-4 shrink-0" aria-hidden />
        ) : (
          <ModelIcon
            className="size-4 shrink-0"
            vendor={modelVendor(row.requestedModel)}
          />
        )}
        <Bdi className="font-mono">{row.requestedModel}</Bdi>
      </span>
      {changed ? (
        <>
          <span aria-hidden="true">
            {DIRECTION[locale] === "rtl" ? "←" : "→"}
          </span>
          <Bdi className="font-mono">{row.resolvedModel}</Bdi>
        </>
      ) : null}
      {row.invocationKey === "fallback" ? (
        <Badge variant="outline">{t("slot.fallback")}</Badge>
      ) : null}
    </span>
  );
}

function TokenValue({ row }: { row: UsageRow }) {
  const t = useTranslations(USAGE_NAMESPACE);
  const format = useFormatter();
  if (row.promptTokens === null && row.completionTokens === null)
    return <span>—</span>;
  return (
    <span className="whitespace-nowrap text-xs tabular-nums">
      {row.promptTokens === null ? "—" : format.number(row.promptTokens)}{" "}
      {t("tokens.input")} ·{" "}
      {row.completionTokens === null
        ? "—"
        : format.number(row.completionTokens)}{" "}
      {t("tokens.output")}
    </span>
  );
}

function CostValue({ row }: { row: UsageRow }) {
  const t = useTranslations(USAGE_NAMESPACE);
  const format = useFormatter();
  if (row.costAuthority === "local")
    return <span className="text-muted-foreground">{t("cost.local")}</span>;
  if (row.cost !== null)
    return (
      <span className="whitespace-nowrap tabular-nums">
        {format.number(Number(row.cost), COST_FORMAT)}
      </span>
    );
  return (
    <span
      className={
        row.status === "pending" ? "text-working" : "text-muted-foreground"
      }
    >
      {t(row.status === "pending" ? "cost.pending" : "cost.unknown")}
    </span>
  );
}

function UsageDetails({ row }: { row: UsageRow }) {
  const t = useTranslations(USAGE_NAMESPACE);
  return (
    <Collapsible>
      <CollapsibleTrigger
        render={
          <Button className="group max-sm:min-h-11" size="xs" variant="ghost" />
        }
      >
        <ChevronDownIcon className="transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
        {t("details.open")}
      </CollapsibleTrigger>
      <CollapsibleContent keepMounted className="data-closed:hidden">
        <dl className="mt-2 grid min-w-56 gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <Detail label={t("columns.task")}>
            <Bdi>{row.taskKey}</Bdi>
          </Detail>
          <Detail label={t("columns.backend")}>
            {t(`backend.${row.backend}`)}
          </Detail>
          <Detail label={t("columns.provider")}>
            <span className="inline-flex items-center gap-1.5">
              {row.provider === "ollama" ? (
                <SimpleIconsOllama className="size-3.5 shrink-0" aria-hidden />
              ) : null}
              {t(`provider.${row.provider}`)}
            </span>
          </Detail>
          <Detail label={t("columns.tokens")}>
            <TokenValue row={row} />
          </Detail>
        </dl>
      </CollapsibleContent>
    </Collapsible>
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

function textFilterValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized === "" ? null : normalized;
}
