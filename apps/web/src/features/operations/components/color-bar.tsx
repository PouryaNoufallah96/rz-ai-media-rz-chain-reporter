import type { EdgeTone } from "../lib/panel-state";

const BAR_TONE = {
  failed: "bg-destructive",
  partial:
    "bg-[linear-gradient(to_bottom,var(--destructive)_0_50%,var(--working)_50%_100%)]",
  running: "bg-working",
  queued: "bg-muted-foreground",
  idle: "border border-border border-dashed",
  offline: "border border-border",
} satisfies Record<EdgeTone | "idle" | "offline", string>;

export function ColorBar({ tone }: { tone: keyof typeof BAR_TONE }) {
  return (
    <span
      aria-hidden="true"
      className={`h-4 w-1.5 shrink-0 ${BAR_TONE[tone]}`}
    />
  );
}
