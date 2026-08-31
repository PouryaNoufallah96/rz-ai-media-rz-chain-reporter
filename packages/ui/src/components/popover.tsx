"use client";

import { useDirection } from "@base-ui/react/direction-provider";
import { Popover as PopoverPrimitive } from "@base-ui/react/popover";
import { cn } from "@rz-chain-reporter/ui/lib/utils";

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;

function PopoverContent({
  className,
  align = "start",
  side = "block-end",
  sideOffset = 6,
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, "align" | "sideOffset"> & {
    side?: "block-start" | "block-end" | "inline-start" | "inline-end";
  }) {
  const direction = useDirection();
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        align={align}
        className="isolate z-50"
        collisionPadding={8}
        side={
          side === "block-start"
            ? "top"
            : side === "block-end"
              ? "bottom"
              : side
        }
        sideOffset={sideOffset}
      >
        <PopoverPrimitive.Popup
          className={cn(
            "max-h-(--available-height) max-w-(--available-width) origin-(--transform-origin) overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover text-popover-foreground shadow-lg outline-none transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-none",
            className,
          )}
          data-slot="popover-content"
          dir={direction}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger };
