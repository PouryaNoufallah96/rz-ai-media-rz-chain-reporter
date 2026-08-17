import type { OperationSummary } from "../schemas/operation-summary";

const PANEL_STATES = [
  "queued",
  "running",
  "retrying",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type PanelState = (typeof PANEL_STATES)[number];

// The retry tick is a panel-row mark: §4.2 counts retrying with running.
export type ChipState = Exclude<PanelState, "retrying">;

export type Chip = { count: number; state: ChipState };

export type EdgeTone = "failed" | "running" | "queued";

const CHIP_STATES = PANEL_STATES.filter(
  (state): state is ChipState => state !== "retrying",
);

export function panelStateOf(operation: OperationSummary): PanelState {
  if (operation.lifecycle === "settling") {
    return "running";
  }

  if (
    operation.latestAttemptOutcome === "failed_retryable" &&
    (operation.lifecycle === "queued" || operation.lifecycle === "running")
  ) {
    return "retrying";
  }

  return operation.lifecycle;
}

export function edgeToneOf(
  states: readonly PanelState[],
): EdgeTone | undefined {
  if (states.includes("failed")) {
    return "failed";
  }

  if (states.includes("running") || states.includes("retrying")) {
    return "running";
  }

  if (states.includes("queued")) {
    return "queued";
  }

  return undefined;
}

export function chipsOf(states: readonly PanelState[]) {
  const counts = new Map<ChipState, number>();

  for (const state of states) {
    const chip = state === "retrying" ? "running" : state;
    counts.set(chip, (counts.get(chip) ?? 0) + 1);
  }

  const chips: Chip[] = [];

  for (const state of CHIP_STATES) {
    const count = counts.get(state);

    if (count) {
      chips.push({ count, state });
    }
  }

  return chips;
}
