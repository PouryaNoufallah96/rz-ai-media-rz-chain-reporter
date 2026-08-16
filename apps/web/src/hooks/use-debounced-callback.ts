"use client";

import { useEffect, useRef } from "react";

export function useDebouncedCallback<TArguments extends unknown[]>(
  callback: (...args: TArguments) => void,
  delayMs: number,
) {
  const latest = useRef(callback);
  const timeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => () => clearTimeout(timeout.current), []);

  const cancel = () => clearTimeout(timeout.current);

  const run = (...args: TArguments) => {
    cancel();
    timeout.current = setTimeout(() => latest.current(...args), delayMs);
  };

  return { cancel, run };
}
