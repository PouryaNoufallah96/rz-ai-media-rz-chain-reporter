"use client";

import { useState } from "react";

import { mergeComparisons } from "../lib/market-request";
import type { MarketComparisonProjection } from "../schemas/reads";

export function useRememberedComparisons(
  seed: readonly MarketComparisonProjection[],
) {
  const [remembered, setRemembered] = useState<MarketComparisonProjection[]>(
    [],
  );
  const remember = (entry: MarketComparisonProjection) =>
    setRemembered((current) =>
      current.some(
        (candidate) => candidate.canonicalIdentity === entry.canonicalIdentity,
      )
        ? current
        : [...current, entry],
    );
  return { comparisons: mergeComparisons(seed, remembered), remember };
}
