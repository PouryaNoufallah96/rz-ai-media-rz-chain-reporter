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
import type { ReactTable, RowData, TableFeatures } from "@tanstack/react-table";

import type { DataTableLabels } from "./labels";

interface CoreDataTableProps<
  TFeatures extends TableFeatures,
  TData extends RowData,
> {
  columnClassNames?: Readonly<Record<string, string>>;
  isPending: boolean;
  labels: Pick<DataTableLabels, "caption" | "empty" | "updating">;
  table: ReactTable<TFeatures, TData>;
}

export function CoreDataTable<
  TFeatures extends TableFeatures,
  TData extends RowData,
>({
  columnClassNames,
  isPending,
  labels,
  table,
}: CoreDataTableProps<TFeatures, TData>) {
  const { rows } = table.getRowModel();

  return (
    <div
      aria-busy={isPending}
      className="overflow-hidden rounded-lg border bg-card data-pending:pointer-events-none data-pending:animate-pulse motion-reduce:animate-none"
      data-pending={isPending || undefined}
    >
      <Table>
        <TableCaption className="sr-only">{labels.caption}</TableCaption>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead
                  className={columnClassNames?.[header.column.id]}
                  key={header.id}
                  scope="col"
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </TableHead>
              ))}
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
