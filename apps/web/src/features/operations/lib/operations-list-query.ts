import { orpc } from "@/lib/orpc";

export const operationsListQueriesKey = orpc.operations.list.key({
  type: "query",
});

export function operationsListQueryKey(focusedOperationId?: string) {
  return orpc.operations.list.queryKey({
    input: operationsListInput(focusedOperationId),
  });
}

export function operationsListInput(focusedOperationId?: string) {
  return focusedOperationId ? { focusedOperationId } : {};
}
