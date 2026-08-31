import { cn } from "@rz-chain-reporter/ui/lib/utils";

const PACE_CLASS_NAME = {
  default: "animation-duration-[1.4s]",
  live: "animation-duration-[1s]",
} as const;

function Skeleton({
  pace = "default",
  className,
  ...props
}: React.ComponentProps<"div"> & {
  pace?: keyof typeof PACE_CLASS_NAME;
}) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-pulse rounded-md bg-muted motion-reduce:animate-none",
        PACE_CLASS_NAME[pace],
        className,
      )}
      {...props}
    />
  );
}

export { Skeleton };
