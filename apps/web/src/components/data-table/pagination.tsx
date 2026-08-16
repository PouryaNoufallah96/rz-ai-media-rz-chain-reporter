"use client";

import { Button } from "@rz-chain-reporter/ui/components/button";
import type { RowData } from "@tanstack/react-table";

import type { DataTableLabels } from "./labels";
import type { DataTableInstance } from "./use-data-table";

interface DataTablePaginationProps<TData extends RowData> {
  labels: Pick<DataTableLabels, "nextPage" | "pageRange" | "previousPage">;
  table: DataTableInstance<TData>;
}

export function DataTablePagination<TData extends RowData>({
  labels,
  table,
}: DataTablePaginationProps<TData>) {
  const { pageIndex, pageSize } = table.state.pagination;
  const pageRows = table.getRowModel().rows.length;
  const from = pageRows === 0 ? 0 : pageIndex * pageSize + 1;

  return (
    <div className="mt-3 flex items-center justify-end gap-2.5">
      <span className="font-mono text-muted-foreground text-xs">
        {labels.pageRange({
          from,
          to: pageIndex * pageSize + pageRows,
          total: table.getRowCount(),
        })}
      </span>
      <Button
        disabled={!table.getCanPreviousPage()}
        onClick={() => table.previousPage()}
        size="sm"
        variant="outline"
      >
        {labels.previousPage}
      </Button>
      <Button
        disabled={!table.getCanNextPage()}
        onClick={() => table.nextPage()}
        size="sm"
        variant="outline"
      >
        {labels.nextPage}
      </Button>
    </div>
  );
}
