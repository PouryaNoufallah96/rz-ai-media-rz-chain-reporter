import { cn } from "@rz-chain-reporter/ui/lib/utils";
import type { ComponentProps } from "react";

const AURA =
  "bg-[radial-gradient(circle_farthest-side_at_0_100%,var(--proof),transparent),radial-gradient(circle_farthest-side_at_100%_0,var(--primary),transparent),radial-gradient(circle_farthest-side_at_100%_100%,var(--working),transparent),radial-gradient(circle_farthest-side_at_0_0,var(--ring),transparent)]";

function BackgroundGradient({
  children,
  className,
  containerClassName,
  ...props
}: ComponentProps<"div"> & {
  containerClassName?: string;
}) {
  return (
    <div
      data-slot="background-gradient"
      className={cn("group relative rounded-xl p-1", containerClassName)}
      {...props}
    >
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit] opacity-60 blur-xl transition-opacity duration-500 group-hover:opacity-100 motion-reduce:transition-none",
          AURA,
        )}
      />
      <div
        aria-hidden
        className={cn(
          "pointer-events-none absolute inset-0 rounded-[inherit]",
          AURA,
        )}
      />
      <div className={cn("relative rounded-[inherit] bg-card", className)}>
        {children}
      </div>
    </div>
  );
}

export { BackgroundGradient };
