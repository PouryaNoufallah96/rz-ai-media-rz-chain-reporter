import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "@/lib/orpc";

function operationsListQueryOptions(enabled: boolean) {
  return orpc.operations.list.queryOptions({
    enabled,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

export const operationsListQueryKey = orpc.operations.list.queryKey();

export function useOperationsList(enabled: boolean) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      queryClient.removeQueries({ queryKey: operationsListQueryKey });
    }
  }, [enabled, queryClient]);

  return useQuery(operationsListQueryOptions(enabled));
}
