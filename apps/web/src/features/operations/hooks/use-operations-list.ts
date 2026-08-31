import { useQuery } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc";

import {
  operationsListInput,
  operationsListQueryKey,
  operationsSnapshotRefetchInterval,
} from "../lib/operations-list-query";

function operationsListQueryOptions(
  viewerId: string,
  focusedOperationId?: string,
) {
  return orpc.operations.list.queryOptions({
    input: operationsListInput(focusedOperationId),
    queryKey: operationsListQueryKey(viewerId, focusedOperationId),
    refetchInterval: (query) =>
      operationsSnapshotRefetchInterval(query.state.data),
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    retry: false,
    staleTime: 0,
  });
}

export function useOperationsList(
  viewerId: string,
  focusedOperationId?: string,
) {
  return useQuery(operationsListQueryOptions(viewerId, focusedOperationId));
}
