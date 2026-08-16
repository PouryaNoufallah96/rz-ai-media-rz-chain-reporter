"use client";

import {
  type PaginationState,
  type ReactTable,
  type RowData,
  rowPaginationFeature,
  rowSortingFeature,
  type SortingState,
  type TableOptions,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";

import {
  type ListQueryConfig,
  type ListSearchPatch,
  listSearchParsers,
  normalizeListQuery,
  withPageReset,
} from "@/features/shared/lib/list-params";
import { useTransitionUrlState } from "@/hooks/use-transition-url-state";

export const dataTableFeatures = tableFeatures({
  rowPaginationFeature,
  rowSortingFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;

export type DataTableInstance<TData extends RowData> = ReactTable<
  DataTableFeatures,
  TData
>;

interface UseDataTableOptions<TColumn extends string, TData extends RowData> {
  columns: TableOptions<DataTableFeatures, TData>["columns"];
  config: ListQueryConfig<TColumn>;
  data: TData[];
  getRowId: (row: TData) => string;
  rowCount: number;
}

export function useDataTable<TColumn extends string, TData extends RowData>({
  columns,
  config,
  data,
  getRowId,
  rowCount,
}: UseDataTableOptions<TColumn, TData>) {
  const { isPending, setValues, values } =
    useTransitionUrlState(listSearchParsers);

  const query = normalizeListQuery(values, config);
  const [orderColumn, orderDirection] = query.orderBy;

  const sorting: SortingState = [
    { desc: orderDirection === "desc", id: orderColumn },
  ];
  const pagination: PaginationState = {
    pageIndex: query.page - 1,
    pageSize: query.perPage,
  };

  const setListParams = (patch: ListSearchPatch) =>
    setValues(withPageReset(patch));

  const table = useTable({
    // The URL owns the page, and `withPageReset` already decides when a change
    // resets it; letting the table reset on every refetched `data` identity
    // would make any page but the first unreachable.
    autoResetPageIndex: false,
    columns,
    data,
    defaultColumn: { enableSorting: false },
    enableMultiSort: false,
    // An empty sorting state cannot be represented: the normalizer maps a
    // missing `orderBy` back to the feature default.
    enableSortingRemoval: false,
    features: dataTableFeatures,
    getRowId,
    manualPagination: true,
    manualSorting: true,
    onPaginationChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(pagination) : updater;

      setListParams(
        next.pageSize === pagination.pageSize
          ? { page: next.pageIndex + 1 }
          : { perPage: next.pageSize },
      );
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const [column] = next;

      setListParams({
        orderBy: column ? [column.id, column.desc ? "desc" : "asc"] : null,
      });
    },
    rowCount,
    state: { pagination, sorting },
  });

  return { isPending, query, setListParams, table };
}
