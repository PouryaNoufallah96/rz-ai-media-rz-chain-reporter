import type { ReactNode } from "react";

import type { EdgeTone, PanelState } from "../lib/panel-state";

const MARK_TONE: Record<PanelState, string> = {
  queued: "text-muted-foreground",
  running: "text-working",
  retrying: "text-working",
  succeeded: "text-proof",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  unknown: "text-working",
};

const MARK_GEOMETRY: Record<PanelState, ReactNode> = {
  queued: <rect height="10" width="10" x="3" y="3" />,
  running: (
    <>
      <rect height="10" width="10" x="3" y="3" />
      <path d="M3 8h10v5H3z" fill="currentColor" stroke="none" />
    </>
  ),
  retrying: (
    <>
      <rect height="10" width="10" x="3" y="3" />
      <path d="M3 8h10v5H3z" fill="currentColor" stroke="none" />
      <path d="m5.75 6.25 2.25-2.25 2.25 2.25" />
    </>
  ),
  succeeded: <path d="m4.5 8.25 2.25 2.25 4.75-5" />,
  failed: <path d="m4.5 4.5 7 7m0-7-7 7" />,
  cancelled: <path d="M6 3h7v10H3V6z" />,
  unknown: <path d="M3 3h10v7l-2.5-2-2.5 2-2.5-2L3 10z" />,
};

export function StateMark({ state }: { state: PanelState }) {
  return (
    <svg
      aria-hidden="true"
      className={`fade-in zoom-in-95 size-4 shrink-0 animate-in motion-reduce:animate-none ${MARK_TONE[state]}`}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={1.5}
      viewBox="0 0 16 16"
    >
      {MARK_GEOMETRY[state]}
    </svg>
  );
}

const BAR_TONE = {
  failed: "bg-destructive",
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
