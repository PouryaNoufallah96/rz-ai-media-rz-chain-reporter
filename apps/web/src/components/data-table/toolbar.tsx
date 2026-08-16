"use client";

import { Input } from "@rz-chain-reporter/ui/components/input";
import { type ChangeEvent, type ReactNode, useState } from "react";

import { useDebouncedCallback } from "@/hooks/use-debounced-callback";

import type { DataTableLabels } from "./labels";

const SEARCH_DEBOUNCE_MS = 300;

interface DataTableToolbarProps {
  children?: ReactNode;
  defaultSearch: string;
  labels: Pick<DataTableLabels, "search" | "searchPlaceholder">;
  onSearchChange: (search: string) => void;
}

export function DataTableToolbar({
  children,
  defaultSearch,
  labels,
  onSearchChange,
}: DataTableToolbarProps) {
  const [search, setSearch] = useState(defaultSearch);
  const debouncedSearch = useDebouncedCallback(
    onSearchChange,
    SEARCH_DEBOUNCE_MS,
  );

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSearch(event.target.value);
    debouncedSearch.run(event.target.value);
  };

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2.5">
      <Input
        aria-label={labels.search}
        className="max-w-80 flex-1"
        onChange={handleChange}
        placeholder={labels.searchPlaceholder}
        type="search"
        value={search}
      />
      {children}
    </div>
  );
}
