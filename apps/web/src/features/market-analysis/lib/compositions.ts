import type { MarketAnalysisOptionsProjection } from "../schemas/reads";

export function findComposition(
  options: MarketAnalysisOptionsProjection,
  familyKey: string | null,
  variantKey: string | null,
) {
  const family = options.compositions.find((item) => item.key === familyKey);
  return {
    family,
    variant: family?.variants.find((item) => item.key === variantKey),
  };
}
