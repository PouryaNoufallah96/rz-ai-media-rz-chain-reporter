import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type * as React from "react";

function Spinner({
  className,
  label,
  ...props
}: React.ComponentProps<"svg"> & { label?: string }) {
  const mark = (
    <svg
      data-slot="spinner"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
      className={cn(
        "size-4 animate-spin motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <path className="opacity-40" d="M8 .75v14.5M.75 8h14.5" />
      <circle className="opacity-40" cx="8" cy="8" r="5" />
      <path d="M8 3a5 5 0 0 1 5 5" />
    </svg>
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
