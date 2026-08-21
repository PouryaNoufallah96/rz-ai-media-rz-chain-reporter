"use client";

import {
  type RowData,
  type TableOptions,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

export const keysetDataTableFeatures = tableFeatures({});

export function useKeysetDataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
}: Pick<
  TableOptions<typeof keysetDataTableFeatures, TData>,
  "columns" | "data" | "getRowId"
>) {
  return useTable({
    columns,
    data,
    features: keysetDataTableFeatures,
    getRowId,
  });
}
