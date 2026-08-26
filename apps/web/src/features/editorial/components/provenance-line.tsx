import type { ReactNode } from "react";

export function ProvenanceLine({
  children,
  segments,
}: {
  children?: ReactNode;
  segments: readonly string[];
}) {
  return (
    <span className="wrap-anywhere line-clamp-3 block font-mono text-muted-foreground text-xs tabular-nums">
      {segments.join(" · ")}
      {children}
    </span>
  );
}

export function MutedTag({ children }: { children: ReactNode }) {
  return (
    <span className="ms-2 border border-border border-dashed px-1">
      {children}
    </span>
  );
}

// The card itself is the press target, so the slot detail is screen-reader text
// and a details-sheet row rather than a nested tooltip trigger.
export function FallbackTag({ detail, tag }: { detail: string; tag: string }) {
  return (
    <>
      <MutedTag>{tag}</MutedTag>
      <span className="sr-only">{detail}</span>
    </>
  );
}
