import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { orpc } from "@/lib/orpc";

import {
  MARKET_COMPARISON_SEARCH_LIMIT,
  normalizeMarketComparisonSearchQuery,
} from "../schemas/reads";

const FIVE_MINUTES_MS = 5 * 60_000;
const DEBOUNCE_MS = 250;

export function useMarketComparisonSearch(query: string) {
  const normalizedQuery = normalizeMarketComparisonSearchQuery(query);
  const [debouncedQuery, setDebouncedQuery] = useState(normalizedQuery);

  useEffect(() => {
    const timer = globalThis.setTimeout(
      () => setDebouncedQuery(normalizedQuery),
      DEBOUNCE_MS,
    );
    return () => globalThis.clearTimeout(timer);
  }, [normalizedQuery]);

  const search = useQuery(
    orpc.marketAnalysis.searchComparisons.queryOptions({
      input: {
        q: debouncedQuery,
        limit: MARKET_COMPARISON_SEARCH_LIMIT,
      },
      enabled: debouncedQuery.length > 0,
      refetchInterval: false,
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: FIVE_MINUTES_MS,
    }),
  );
  const debouncing = normalizedQuery !== debouncedQuery;

  return {
    active: normalizedQuery.length > 0,
    entries: debouncing ? [] : (search.data?.entries ?? []),
    failed: search.isError,
    searching:
      normalizedQuery.length > 0 &&
      (debouncing || (search.isFetching && search.data === undefined)),
  };
}
