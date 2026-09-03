import type { PlatformDraftExactCard } from "@/features/editorial/schemas/drafts";

export function hasThreeReadyCaptions(
  card: Pick<PlatformDraftExactCard, "candidates" | "generation">,
) {
  return (
    card.generation?.lifecycle === "succeeded" && card.candidates.length === 3
  );
}
