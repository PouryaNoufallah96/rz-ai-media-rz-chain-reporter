"use client";

import { type Options, type UseQueryStatesKeysMap, useQueryStates } from "nuqs";
import { useTransition } from "react";

// Tagging this transition so a filter or page change never plays a navigation
// transition needs `addTransitionType`, which stable React 19.2 does not ship.
// The tag returns with the View Transitions round.
export function useTransitionUrlState<TParsers extends UseQueryStatesKeysMap>(
  parsers: TParsers,
  options: Omit<Options, "shallow" | "startTransition"> = {},
) {
  const [isPending, startTransition] = useTransition();

  const [values, setValues] = useQueryStates(parsers, {
    history: "replace",
    ...options,
    shallow: false,
    startTransition,
  });

  return { isPending, setValues, values };
}
