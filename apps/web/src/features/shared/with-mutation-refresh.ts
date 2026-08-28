import "server-only";

import { refresh } from "next/cache";

type ActionResult = readonly [unknown, unknown];
type MutationRefreshOptions = { refreshOnError?: boolean };

export function withMutationRefresh<
  TArgs extends unknown[],
  TResult extends ActionResult,
>(
  action: (...args: TArgs) => Promise<TResult>,
  updateTags: (...args: TArgs) => void | Promise<void>,
  options?: MutationRefreshOptions,
) {
  return async (...args: TArgs): Promise<TResult> => {
    const result = await action(...args);

    if (!result[0] || options?.refreshOnError) {
      await updateTags(...args);
      refresh();
    }

    return result;
  };
}
