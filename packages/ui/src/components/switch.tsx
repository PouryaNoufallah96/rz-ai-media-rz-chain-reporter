"use client";

import { Switch as SwitchPrimitive } from "@base-ui/react/switch";
import { cn } from "@rz-chain-reporter/ui/lib/utils";

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer relative inline-flex h-5 w-9 shrink-0 touch-manipulation items-center rounded-full border border-transparent bg-input outline-none transition-colors duration-150 after:absolute after:-inset-3 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive data-disabled:pointer-events-none data-checked:bg-primary data-disabled:opacity-50",
        className,
      )}
      data-slot="switch"
      {...props}
    >
      <SwitchPrimitive.Thumb
        className="pointer-events-none size-4 rounded-full bg-primary-foreground shadow-sm transition-transform duration-150 data-checked:translate-x-4 rtl:data-checked:-translate-x-4"
        data-slot="switch-thumb"
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
