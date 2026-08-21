import type { ReactNode } from "react";

export const STATE_MARKS = [
  "queued",
  "running",
  "retrying",
  "waiting",
  "succeeded",
  "failed",
  "cancelled",
  "unknown",
] as const;

export type StateMarkState = (typeof STATE_MARKS)[number];

const MARK_TONE: Record<StateMarkState, string> = {
  queued: "text-muted-foreground",
  running: "text-working",
  retrying: "text-working",
  waiting: "text-muted-foreground",
  succeeded: "text-proof",
  failed: "text-destructive",
  cancelled: "text-muted-foreground",
  unknown: "text-working",
};

const MARK_GEOMETRY: Record<StateMarkState, ReactNode> = {
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
  waiting: (
    <>
      <circle cx="8" cy="8" r="5" />
      <path d="M8 5v3l2 1" />
    </>
  ),
  succeeded: <path d="m4.5 8.25 2.25 2.25 4.75-5" />,
  failed: <path d="m4.5 4.5 7 7m0-7-7 7" />,
  cancelled: <path d="M6 3h7v10H3V6z" />,
  unknown: <path d="M3 3h10v7l-2.5-2-2.5 2-2.5-2L3 10z" />,
};

export function StateMark({
  dispatchExhausted = false,
  state,
}: {
  dispatchExhausted?: boolean;
  state: StateMarkState;
}) {
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
      {dispatchExhausted ? (
        <path className="text-destructive" d="m10.5 2.5 3 3m0-3-3 3" />
      ) : null}
    </svg>
  );
}
