"use client";

import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rz-chain-reporter/ui/components/table";
import type {
  Header,
  ReactTable,
  RowData,
  SortDirection,
  TableFeatures,
} from "@tanstack/react-table";
import type { AriaAttributes, ReactNode } from "react";

import { DataTableColumnHeader } from "./column-header";
import type { DataTableLabels } from "./labels";
import type { DataTableFeatures, DataTableInstance } from "./use-data-table";

const ARIA_SORT: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

interface CoreDataTableProps<
  TFeatures extends TableFeatures,
  TData extends RowData,
> {
  columnClassNames?: Readonly<Record<string, string>>;
  isPending: boolean;
  labels: Pick<DataTableLabels, "caption" | "empty" | "updating">;
  table: ReactTable<TFeatures, TData>;
}

type SortableDataTableProps<TData extends RowData> = Omit<
  CoreDataTableProps<DataTableFeatures, TData>,
  "labels" | "table"
> & {
  labels: Pick<
    DataTableLabels,
    "caption" | "empty" | "sortAscending" | "sortDescending" | "updating"
  >;
  table: DataTableInstance<TData>;
};

interface HeaderCell {
  ariaSort?: AriaAttributes["aria-sort"];
  content: ReactNode;
}

export function CoreDataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(props: CoreDataTableProps<TFeatures, TData>) {
  return <DataTableShell {...props} />;
}

export function DataTable<TData extends RowData>({
  labels,
  ...props
}: SortableDataTableProps<TData>) {
  return (
    <DataTableShell
      {...props}
      labels={labels}
      renderHeader={(header, content) =>
        renderSortableHeader(header, content, labels)
      }
    />
  );
}

function DataTableShell<
  TFeatures extends TableFeatures,
  TData extends RowData,
>({
  columnClassNames,
  isPending,
  labels,
  renderHeader,
  table,
}: CoreDataTableProps<TFeatures, TData> & {
  renderHeader?: (
    header: Header<TFeatures, TData>,
    content: ReactNode,
  ) => HeaderCell;
}) {
  const { rows } = table.getRowModel();

  return (
    <div
      aria-busy={isPending}
      className="transition-opacity data-pending:pointer-events-none data-pending:animate-pulse data-pending:opacity-45 motion-reduce:transition-none data-pending:motion-reduce:animate-none"
      data-pending={isPending || undefined}
    >
      <Table>
        <TableCaption className="sr-only">{labels.caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const content = header.isPlaceholder ? null : (
                  <table.FlexRender header={header} />
                );
                const headerCell: HeaderCell = renderHeader?.(
                  header,
                  content,
                ) ?? {
                  content,
                };

                return (
                  <TableHead
                    aria-sort={headerCell.ariaSort}
                    className={columnClassNames?.[header.column.id]}
                    key={header.id}
                    scope="col"
                  >
                    {headerCell.content}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                className="py-6 text-center text-muted-foreground"
                colSpan={table.getAllLeafColumns().length}
              >
                {labels.empty}
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={row.id}>
                {row.getAllCells().map((cell) => (
                  <TableCell
                    className={columnClassNames?.[cell.column.id]}
                    key={cell.id}
                  >
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <span className="sr-only" role="status">
        {isPending ? labels.updating : ""}
      </span>
    </div>
  );
}

function renderSortableHeader<TData extends RowData>(
  header: Header<DataTableFeatures, TData>,
  content: ReactNode,
  labels: SortableDataTableProps<TData>["labels"],
): HeaderCell {
  const canSort = header.column.getCanSort();
  const sorted = header.column.getIsSorted();
  const ariaSort = sorted === false ? "none" : ARIA_SORT[sorted];

  if (!canSort) return { content };

  return {
    ariaSort,
    content: (
      <DataTableColumnHeader
        onToggle={header.column.getToggleSortingHandler()}
        sortActionLabel={
          header.column.getNextSortingOrder() === "desc"
            ? labels.sortDescending
            : labels.sortAscending
        }
        sorted={sorted}
      >
        {content}
      </DataTableColumnHeader>
    ),
  };
}
