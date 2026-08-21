"use client";

import { MODEL_BACKENDS, USAGE_STATUSES } from "@rz-chain-reporter/contracts";
import { DIRECTION } from "@rz-chain-reporter/i18n";
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
import { Input } from "@rz-chain-reporter/ui/components/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rz-chain-reporter/ui/components/table";
import type { TableOptions } from "@tanstack/react-table";
import { FileTextIcon } from "lucide-react";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import type { FormEvent } from "react";
import { StateMark } from "@/components/common/state-mark";
import { CoreDataTable } from "@/components/data-table/data-table";
import { KeysetPagination } from "@/components/data-table/keyset-pagination";
import {
  type keysetDataTableFeatures,
  useKeysetDataTable,
} from "@/components/data-table/use-keyset-data-table";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

import { USAGE_NAMESPACE, USAGE_PERIODS, USAGE_PROVIDERS } from "../constants";
import {
  type UsagePage,
  type UsageQuery,
  type UsageRow,
  type UsageSearchPatch,
  type UsageSummary,
  usageSearchParsers,
} from "../schemas/usage";

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
          className="whitespace-nowrap font-mono text-xs tabular-nums"
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
      cell: ({ row }) => t(`provider.${row.original.provider}`),
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

  const handleTextFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setFilters({
      model: textFilterValue(data.get("model")),
      task: textFilterValue(data.get("task")),
    });
  };

  return (
    <>
      <UsageFilters
        onSubmit={handleTextFilters}
        onValueChange={setFilters}
        query={query}
      />
      <UsageSummaryBlock summary={summary} />
      <section className="mt-6" aria-labelledby="usage-ledger-title">
        <h2
          className="ticket-label border-b border-dashed pb-2"
          id="usage-ledger-title"
        >
          {t("ledger.title")}
        </h2>
        {summary.installationInvocations === 0 ? (
          <UsageEmpty description={t("empty.installation")} />
        ) : page.rows.length === 0 ? (
          <UsageEmpty
            action={
              <Button onClick={clearFilters} size="sm" variant="outline">
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
              backToLatestLabel={t("pager.backToLatest")}
              newerLabel={t("pager.newer")}
              olderLabel={t("pager.older")}
              offLatest={page.offLatest}
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
    </>
  );
}

function UsageFilters({
  onSubmit,
  onValueChange,
  query,
}: {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onValueChange: (patch: UsageSearchPatch) => void;
  query: UsageQuery;
}) {
  const t = useTranslations(USAGE_NAMESPACE);

  return (
    <form
      aria-label={t("filters.label")}
      className="mt-6 flex flex-wrap items-end gap-2"
      onSubmit={onSubmit}
    >
      <FilterSelect
        label={t("filters.period")}
        onChange={(value) => onValueChange({ period: value })}
        options={USAGE_PERIODS.map((value) => ({
          label: t(`period.${value}`),
          value,
        }))}
        value={query.period}
      />
      <FilterText
        defaultValue={query.model ?? ""}
        label={t("filters.model")}
        name="model"
        placeholder={t("filters.modelPlaceholder")}
      />
      <FilterSelect
        allowAll
        label={t("filters.backend")}
        onChange={(value) => onValueChange({ backend: value })}
        options={MODEL_BACKENDS.map((value) => ({
          label: t(`backend.${value}`),
          value,
        }))}
        value={query.backend}
      />
      <FilterSelect
        allowAll
        label={t("filters.provider")}
        onChange={(value) => onValueChange({ provider: value })}
        options={USAGE_PROVIDERS.map((value) => ({
          label: t(`provider.${value}`),
          value,
        }))}
        value={query.provider}
      />
      <FilterText
        defaultValue={query.task ?? ""}
        label={t("filters.task")}
        name="task"
        placeholder={t("filters.taskPlaceholder")}
      />
      <FilterSelect
        allowAll
        label={t("filters.status")}
        onChange={(value) => onValueChange({ status: value })}
        options={USAGE_STATUSES.map((value) => ({
          label: t(`status.${value}`),
          value,
        }))}
        value={query.status}
      />
      <Button size="sm" type="submit" variant="outline">
        {t("filters.apply")}
      </Button>
    </form>
  );
}

function FilterSelect<TValue extends string>({
  allowAll = false,
  label,
  onChange,
  options,
  value,
}: {
  allowAll?: boolean;
  label: string;
  onChange: (value: TValue | null) => void;
  options: readonly { label: string; value: TValue }[];
  value: TValue | null;
}) {
  const t = useTranslations(USAGE_NAMESPACE);
  return (
    <label className="grid gap-1 text-xs">
      <span className="ticket-label">{label}</span>
      <select
        className="h-8 rounded-none border border-input bg-background px-2 text-xs"
        onChange={(event) => {
          const selected = options.find(
            (option) => option.value === event.target.value,
          );
          onChange(selected?.value ?? null);
        }}
        value={value ?? ""}
      >
        {allowAll ? <option value="">{t("filters.all")}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterText({
  defaultValue,
  label,
  name,
  placeholder,
}: {
  defaultValue: string;
  label: string;
  name: string;
  placeholder: string;
}) {
  const id = `usage-filter-${name}`;
  return (
    <div className="grid gap-1 text-xs">
      <label className="ticket-label" htmlFor={id}>
        {label}
      </label>
      <Input
        className="h-8 w-40"
        defaultValue={defaultValue}
        id={id}
        key={defaultValue}
        maxLength={200}
        name={name}
        placeholder={placeholder}
      />
    </div>
  );
}

function UsageSummaryBlock({ summary }: { summary: UsageSummary }) {
  const t = useTranslations(USAGE_NAMESPACE);
  const format = useFormatter();
  return (
    <section
      aria-labelledby="usage-summary-title"
      className="mt-6 border border-border bg-card"
    >
      <h2
        className="ticket-label border-b border-dashed p-3"
        id="usage-summary-title"
      >
        {t("summary.title")}
      </h2>
      <dl className="grid grid-cols-2 gap-3 p-3 font-mono text-xs sm:grid-cols-5">
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
                  <Bdi className="font-mono">{model.model}</Bdi>
                </TableCell>
                <TableCell>{t(`backend.${model.backend}`)}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {format.number(model.invocations)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {format.number(model.totalTokens)}
                </TableCell>
                <TableCell className="font-mono tabular-nums">
                  {format.number(Number(model.recordedCost), COST_FORMAT)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : null}
    </section>
  );
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="mt-1 tabular-nums">{value}</dd>
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
    <span className="flex max-w-56 flex-wrap items-center gap-1 font-mono text-xs">
      <Bdi>{row.requestedModel}</Bdi>
      {changed ? (
        <>
          <span aria-hidden="true">
            {DIRECTION[locale] === "rtl" ? "←" : "→"}
          </span>
          <Bdi>{row.resolvedModel}</Bdi>
        </>
      ) : null}
      {row.invocationKey === "fallback" ? (
        <span className="border border-dashed px-1">{t("slot.fallback")}</span>
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
    <span className="whitespace-nowrap font-mono text-xs tabular-nums">
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
      <span className="whitespace-nowrap font-mono tabular-nums">
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
    <details>
      <summary className="cursor-pointer select-none text-xs">
        {t("details.open")}
      </summary>
      <dl className="mt-2 grid gap-1 text-xs">
        <Detail label={t("columns.task")}>
          <Bdi>{row.taskKey}</Bdi>
        </Detail>
        <Detail label={t("columns.backend")}>
          {t(`backend.${row.backend}`)}
        </Detail>
        <Detail label={t("columns.provider")}>
          {t(`provider.${row.provider}`)}
        </Detail>
        <Detail label={t("columns.tokens")}>
          <TokenValue row={row} />
        </Detail>
      </dl>
    </details>
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
      <dd>{children}</dd>
    </div>
  );
}

function textFilterValue(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/\s+/gu, " ");
  return normalized === "" ? null : normalized;
}
