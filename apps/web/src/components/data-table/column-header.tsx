"use client";

import type { SortDirection } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { ReactNode } from "react";

interface DataTableColumnHeaderProps {
  children: ReactNode;
  onToggle: ((event: unknown) => void) | undefined;
  sortActionLabel: string;
  sorted: SortDirection | false;
}

export function DataTableColumnHeader({
  children,
  onToggle,
  sortActionLabel,
  sorted,
}: DataTableColumnHeaderProps) {
  const SortIcon = sorted === "asc" ? ArrowUpIcon : ArrowDownIcon;

  return (
    <button onClick={onToggle} type="button">
      {children}
      <span className="sr-only">{sortActionLabel}</span>
      {sorted === false ? null : <SortIcon className="size-3" />}
    </button>
  );
}
