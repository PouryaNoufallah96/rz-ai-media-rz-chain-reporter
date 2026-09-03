"use client";

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle";
import { ToggleGroup as ToggleGroupPrimitive } from "@base-ui/react/toggle-group";

import { cn } from "@rz-chain-reporter/ui/lib/utils";

function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props) {
  return (
    <ToggleGroupPrimitive
      className={cn(
        "inline-flex max-w-full items-center gap-px rounded-lg border bg-muted p-0.5",
        className,
      )}
      data-slot="toggle-group"
      {...props}
    />
  );
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props) {
  return (
    <TogglePrimitive
      className={cn(
        "inline-flex min-h-8 min-w-8 touch-manipulation items-center justify-center rounded-md px-2.5 font-medium text-muted-foreground text-xs outline-none transition-colors hover:bg-accent/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-disabled:pointer-events-none data-pressed:bg-accent data-pressed:text-accent-foreground data-disabled:opacity-50 data-pressed:shadow-sm data-pressed:ring-1 data-pressed:ring-primary/20 max-sm:min-h-11 max-sm:min-w-11",
        className,
      )}
      data-slot="toggle-group-item"
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem };
