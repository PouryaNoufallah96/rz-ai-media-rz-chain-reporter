import "server-only";

import { refresh } from "next/cache";

type ActionResult = readonly [unknown, unknown];

export function withMutationRefresh<
  TArgs extends unknown[],
  TResult extends ActionResult,
>(
  action: (...args: TArgs) => Promise<TResult>,
  updateTags: (...args: TArgs) => void,
) {
  return async (...args: TArgs): Promise<TResult> => {
    const result = await action(...args);

    if (!result[0]) {
      updateTags(...args);
      refresh();
    }

    return result;
  };
}
