import type { MarketSnapshotStatus } from "@rz-chain-reporter/contracts";
import type { MarketSeriesOutcome, RequestedSeries } from "./types";

export function classifyMarketSnapshot(
  requested: readonly RequestedSeries[],
  outcomes: readonly MarketSeriesOutcome[],
): MarketSnapshotStatus {
  const successfulPrimary = outcomes.some(
    (outcome, index) =>
      requested[index]?.role === "primary" && outcome.outcome === "succeeded",
  );
  if (!successfulPrimary) return "unverified";
  return outcomes.every((outcome) => outcome.outcome === "succeeded")
    ? "verified"
    : "partial";
}

export function ownsVerificationIntent(
  current: {
    verificationIntentId: string | null;
    verificationIntentVersion: number;
  },
  pinned: { verificationIntentId: string; verificationIntentVersion: number },
) {
  return (
    current.verificationIntentId === pinned.verificationIntentId &&
    current.verificationIntentVersion === pinned.verificationIntentVersion
  );
}
