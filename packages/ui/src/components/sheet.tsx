"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import {
  type TextDirection,
  useDirection,
} from "@base-ui/react/direction-provider";
import { Button } from "@rz-chain-reporter/ui/components/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
  DialogViewport,
} from "@rz-chain-reporter/ui/components/dialog";
import { cn } from "@rz-chain-reporter/ui/lib/utils";
import { XIcon } from "lucide-react";
import type * as React from "react";

type SheetSide = "block-end" | "block-start" | "inline-end" | "inline-start";

const VIEWPORT_ALIGNMENT: Record<SheetSide, string> = {
  "block-end": "items-end",
  "block-start": "items-start",
  "inline-end": "items-stretch justify-end",
  "inline-start": "items-stretch justify-start",
};

const POPUP_GEOMETRY: Record<SheetSide, string> = {
  "block-end": "max-h-[85dvh] w-full border-t",
  "block-start": "max-h-[85dvh] w-full border-b",
  "inline-end": "h-full w-[min(400px,95vw)] border-s",
  "inline-start": "h-full w-[min(400px,95vw)] border-e",
};

const POPUP_SAFE_AREA_PADDING: Record<SheetSide, string> = {
  "block-end": "pb-[calc(var(--sheet-padding)+env(safe-area-inset-bottom))]",
  "block-start": "pt-[calc(var(--sheet-padding)+env(safe-area-inset-top))]",
  "inline-end":
    "ltr:pr-[calc(var(--sheet-padding)+env(safe-area-inset-right))] rtl:pl-[calc(var(--sheet-padding)+env(safe-area-inset-left))]",
  "inline-start":
    "ltr:pl-[calc(var(--sheet-padding)+env(safe-area-inset-left))] rtl:pr-[calc(var(--sheet-padding)+env(safe-area-inset-right))]",
};

const CLOSE_SAFE_AREA_POSITION =
  "top-[calc(--spacing(4)+env(safe-area-inset-top))] ltr:right-[calc(--spacing(4)+env(safe-area-inset-right))] rtl:left-[calc(--spacing(4)+env(safe-area-inset-left))]";

// CSS has no logical translate, so the inline-axis sign is resolved here from
// the caller's direction instead of a direction-scoped class override.
function slideOffset(side: SheetSide, direction: TextDirection) {
  switch (side) {
    case "block-start":
      return "0 -100%";
    case "block-end":
      return "0 100%";
    case "inline-start":
      return direction === "rtl" ? "100% 0" : "-100% 0";
    default:
      return direction === "rtl" ? "-100% 0" : "100% 0";
  }
}

function SheetViewport({
  className,
  side = "inline-end",
  ...props
}: SheetPrimitive.Viewport.Props & { side?: SheetSide }) {
  return (
    <DialogViewport
      data-slot="sheet-viewport"
      className={cn("p-0", VIEWPORT_ALIGNMENT[side], className)}
      {...props}
    />
  );
}

function SheetPopup({
  children,
  className,
  closeLabel,
  direction,
  side = "inline-end",
  style,
  ...props
}: SheetPrimitive.Popup.Props & {
  closeLabel?: string;
  direction?: TextDirection;
  side?: SheetSide;
}) {
  const providerDirection = useDirection();

  return (
    <SheetPrimitive.Popup
      data-slot="sheet-popup"
      className={cn(
        "relative flex flex-col gap-4 overflow-y-auto overscroll-contain bg-popover bg-clip-padding p-(--sheet-padding) text-popover-foreground text-xs/relaxed shadow-lg outline-none transition-[translate] duration-200 ease-out [--sheet-padding:--spacing(4)] data-ending-style:duration-150 motion-reduce:transition-none data-ending-style:[translate:var(--sheet-slide)] data-starting-style:[translate:var(--sheet-slide)]",
        POPUP_GEOMETRY[side],
        className,
        POPUP_SAFE_AREA_PADDING[side],
      )}
      style={
        {
          ...style,
          "--sheet-slide": slideOffset(side, direction ?? providerDirection),
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
      {closeLabel ? (
        <SheetPrimitive.Close
          data-slot="sheet-close"
          render={
            <Button
              className={cn(
                "absolute max-compact:size-11",
                CLOSE_SAFE_AREA_POSITION,
              )}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <XIcon aria-hidden="true" />
          <span className="sr-only">{closeLabel}</span>
        </SheetPrimitive.Close>
      ) : null}
    </SheetPrimitive.Popup>
  );
}

function SheetContent({
  side = "inline-end",
  ...props
}: React.ComponentProps<typeof SheetPopup>) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <SheetViewport side={side}>
        <SheetPopup data-slot="sheet-content" side={side} {...props} />
      </SheetViewport>
    </DialogPortal>
  );
}

export {
  Dialog as Sheet,
  DialogClose as SheetClose,
  DialogDescription as SheetDescription,
  DialogFooter as SheetFooter,
  DialogHeader as SheetHeader,
  DialogOverlay as SheetOverlay,
  DialogPortal as SheetPortal,
  DialogTitle as SheetTitle,
  DialogTrigger as SheetTrigger,
  SheetContent,
  SheetPopup,
  SheetViewport,
};
