import {
  isOperationSettled,
  type OperationLifecycle,
} from "@rz-chain-reporter/contracts";

import { orpc } from "@/lib/orpc";

export const OPERATIONS_ACTIVE_REFETCH_INTERVAL_MS = 30_000;

export function operationsListQueryKey(
  viewerId: string,
  focusedOperationId?: string,
) {
  const baseKey = orpc.operations.list.queryKey({
    input: operationsListInput(focusedOperationId),
  });
  return [...baseKey, { viewerId }] as const;
}

export function operationsListInput(focusedOperationId?: string) {
  return focusedOperationId ? { focusedOperationId } : {};
}

export function operationsSnapshotRefetchInterval(
  operations: readonly { lifecycle: OperationLifecycle }[] | undefined,
) {
  return operations?.some(
    (operation) => !isOperationSettled(operation.lifecycle),
  )
    ? OPERATIONS_ACTIVE_REFETCH_INTERVAL_MS
    : false;
}
