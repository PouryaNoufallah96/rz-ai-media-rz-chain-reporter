import { Skeleton } from "@rz-chain-reporter/ui/components/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@rz-chain-reporter/ui/components/table";

import type { DataTableLabels } from "./labels";

const DEFAULT_ROW_COUNT = 8;

interface DataTableSkeletonProps {
  columnCount: number;
  labels: Pick<DataTableLabels, "loading">;
  rowCount?: number;
}

export function DataTableSkeleton({
  columnCount,
  labels,
  rowCount = DEFAULT_ROW_COUNT,
}: DataTableSkeletonProps) {
  const columns = Array.from({ length: columnCount }, (_, index) => index);
  const rows = Array.from({ length: rowCount }, (_, index) => index);

  return (
    <div aria-busy>
      <Table aria-hidden="true">
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column}>
                <Skeleton className="h-2.5 w-16" />
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row}>
              {columns.map((column) => (
                <TableCell key={column}>
                  <Skeleton className="h-3.5 w-full" />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <span className="sr-only" role="status">
        {labels.loading}
      </span>
    </div>
  );
}
