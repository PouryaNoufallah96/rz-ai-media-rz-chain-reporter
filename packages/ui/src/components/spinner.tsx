import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type { ComponentProps } from "react";

const SPIRAL_ORDER = [
  0, 1, 2, 3, 4, 15, 16, 17, 18, 5, 14, 23, 24, 19, 6, 13, 22, 21, 20, 7, 12,
  11, 10, 9, 8,
] as const;

const SPIRAL_STEP_MS = 44;

function Spinner({
  className,
  label,
  ...props
}: ComponentProps<"span"> & { label?: string }) {
  const mark = (
    <span
      data-slot="spinner"
      className={cn(
        "pointer-events-none inline-grid shrink-0 grid-cols-5 grid-rows-5 gap-px",
        className,
      )}
      {...props}
      aria-hidden="true"
    >
      {SPIRAL_ORDER.map((order, index) => (
        <span
          key={index}
          className="size-full animate-dmx-spiral rounded-full bg-current motion-reduce:animate-none motion-reduce:opacity-40"
          style={{ animationDelay: `${order * SPIRAL_STEP_MS}ms` }}
        />
      ))}
    </span>
  );

  if (!label) {
    return mark;
  }

  return (
    <span data-slot="spinner-status" role="status" className="contents">
      {mark}
      <span className="sr-only">{label}</span>
    </span>
  );
}

export { Spinner };
