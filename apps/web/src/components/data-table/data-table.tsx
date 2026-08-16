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
import type { RowData, SortDirection } from "@tanstack/react-table";

import { DataTableColumnHeader } from "./column-header";
import type { DataTableLabels } from "./labels";
import type { DataTableInstance } from "./use-data-table";

const ARIA_SORT: Record<SortDirection, "ascending" | "descending"> = {
  asc: "ascending",
  desc: "descending",
};

interface DataTableProps<TData extends RowData> {
  isPending: boolean;
  labels: Pick<
    DataTableLabels,
    "caption" | "empty" | "sortAscending" | "sortDescending" | "updating"
  >;
  table: DataTableInstance<TData>;
}

export function DataTable<TData extends RowData>({
  isPending,
  labels,
  table,
}: DataTableProps<TData>) {
  const { rows } = table.getRowModel();

  return (
    <div aria-busy={isPending} data-pending={isPending || undefined}>
      <Table>
        <TableCaption className="sr-only">{labels.caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => {
                const canSort = header.column.getCanSort();
                const sorted = header.column.getIsSorted();
                const ariaSort = sorted === false ? "none" : ARIA_SORT[sorted];
                const content = header.isPlaceholder ? null : (
                  <table.FlexRender header={header} />
                );

                return (
                  <TableHead
                    aria-sort={canSort ? ariaSort : undefined}
                    key={header.id}
                    scope="col"
                  >
                    {canSort ? (
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
                    ) : (
                      content
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody
          className="transition-opacity duration-200 data-pending:opacity-45 motion-reduce:transition-none"
          data-pending={isPending || undefined}
        >
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
                  <TableCell key={cell.id}>
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
