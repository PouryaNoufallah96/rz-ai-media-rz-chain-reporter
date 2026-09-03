"use client";

import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { useFormatter } from "next-intl";

const PIXELS = { useGrouping: false } as const;

export function GenerationPlaceholder({
  className,
  height,
  label,
  width,
}: {
  className?: string;
  height: number;
  label: string;
  width: number;
}) {
  const format = useFormatter();

  return (
    <div
      aria-busy="true"
      className={cn(
        "relative w-full overflow-hidden rounded-lg border bg-muted",
        className,
      )}
      role="status"
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      <span
        aria-hidden="true"
        className="mask-no-repeat mask-position-[16%_20%,30%_32%] mask-size-[52%_46%,40%_40%] mask-[radial-gradient(closest-side,black_55%,transparent),radial-gradient(closest-side,black_55%,transparent)] absolute inset-0 animate-ig-morph bg-[radial-gradient(currentColor_1px,transparent_1.5px)] bg-size-[0.75rem_0.75rem] text-primary/45 motion-reduce:animate-none"
      />
      <span
        aria-hidden="true"
        className="absolute inset-0 animate-ig-breathe bg-radial from-primary/20 via-45% via-primary/5 to-75% to-transparent motion-reduce:animate-none"
      />
      <span className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-linear-to-t from-muted via-muted/80 to-transparent p-3 pt-10">
        <span className="min-w-0 animate-ig-shine bg-linear-to-r bg-size-[200%_100%] from-muted-foreground via-foreground to-muted-foreground bg-clip-text font-medium text-sm text-transparent leading-5 motion-reduce:animate-none rtl:[animation-direction:reverse]">
          {label}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 rounded-md border bg-background/70 px-2 py-0.5 font-mono text-[0.6875rem] text-muted-foreground tabular-nums leading-4"
        >
          {format.number(width, PIXELS)} × {format.number(height, PIXELS)}
        </span>
      </span>
    </div>
  );
}
