import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { orpc } from "@/lib/orpc";

import {
  operationsListInput,
  operationsListQueriesKey,
} from "../lib/operations-list-query";

function operationsListQueryOptions(
  enabled: boolean,
  focusedOperationId?: string,
) {
  return orpc.operations.list.queryOptions({
    enabled,
    input: operationsListInput(focusedOperationId),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });
}

export function useOperationsList(
  enabled: boolean,
  focusedOperationId?: string,
) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      queryClient.removeQueries({ queryKey: operationsListQueriesKey });
    }
  }, [enabled, queryClient]);

  return useQuery(operationsListQueryOptions(enabled, focusedOperationId));
}
