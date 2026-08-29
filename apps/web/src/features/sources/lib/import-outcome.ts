import type { SourceFetchOutcome } from "@rz-chain-reporter/contracts";

type PartialImport = {
  counts: { acquired: number; failed: number };
  sources?: readonly { outcome: SourceFetchOutcome }[];
};

const DEAD_SOURCE_OUTCOMES = new Set<SourceFetchOutcome>([
  "blocked",
  "failed_retryable",
  "failed_terminal",
  "rejected",
  "timed_out",
]);

const DANGER_FAILURE_SHARE = 0.5;

export function partialImportStateOf(
  run: PartialImport,
): "failed" | "partial" | "succeeded" {
  if (run.counts.acquired === 0) return "failed";

  const share = failureShareOf(run);

  if (share >= DANGER_FAILURE_SHARE) return "failed";
  return share > 0 ? "partial" : "succeeded";
}

function failureShareOf({ counts, sources = [] }: PartialImport) {
  const settled = sources.filter((line) => line.outcome !== "pending");
  const dead = settled.filter((line) =>
    DEAD_SOURCE_OUTCOMES.has(line.outcome),
  ).length;
  const sourceShare = settled.length > 0 ? dead / settled.length : 0;
  const items = counts.acquired + counts.failed;
  const itemShare = items > 0 ? counts.failed / items : 0;

  return Math.max(sourceShare, itemShare);
}
