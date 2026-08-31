import "server-only";

import { refresh } from "next/cache";

import { webLogger } from "@/lib/logger";

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
      try {
        await updateTags(...args);
        refresh();
      } catch {
        webLogger.error(
          result[0]
            ? "mutation_error_refresh_failed"
            : "post_commit_refresh_failed",
          {
            outcome: result[0] ? "mutation_failed" : "mutation_committed",
          },
        );
      }
    }

    return result;
  };
}
