import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

import { POLL_INTERVAL_MS } from "../constants";

export function operationsListQueryOptions(enabled: boolean) {
  return orpc.operations.list.queryOptions({
    enabled,
    refetchInterval: POLL_INTERVAL_MS,
    retry: false,
    staleTime: 0,
  });
}

export function useOperationsList(enabled: boolean) {
  return useQuery(operationsListQueryOptions(enabled));
}
