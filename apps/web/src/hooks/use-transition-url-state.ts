"use client";

import { type Options, type UseQueryStatesKeysMap, useQueryStates } from "nuqs";
import { useTransition } from "react";

// Preventing filters and pages from playing a navigation transition needs
// `addTransitionType`, which stable React 19.2 does not ship.
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
